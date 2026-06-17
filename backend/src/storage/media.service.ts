import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  MediaType,
  MessageType,
  Prisma,
  StorageProvider,
  UserRole,
} from '@prisma/client';
import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { PrismaService } from '../prisma/prisma.service';
import {
  DownloadedMedia,
  StoreRemoteMediaInput,
} from './interfaces/media.interface';
import { LOCAL_STORAGE_PROVIDER } from './interfaces/storage-provider.interface';
import type { StorageProviderAdapter } from './interfaces/storage-provider.interface';
import { SecureMediaDownloader } from './secure-media-downloader';

const ALLOWED_MIME_TYPES: Record<MediaType, ReadonlySet<string>> = {
  [MediaType.IMAGE]: new Set([
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
  ]),
  [MediaType.AUDIO]: new Set([
    'audio/ogg',
    'audio/mpeg',
    'audio/wav',
    'audio/x-wav',
    'audio/mp4',
  ]),
  [MediaType.DOCUMENT]: new Set([
    'application/pdf',
    'text/plain',
    'application/msword',
    'application/vnd.ms-excel',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ]),
};

const FILE_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/mp4': 'm4a',
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'application/msword': 'doc',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation':
    'pptx',
};

@Injectable()
export class MediaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly downloader: SecureMediaDownloader,
    @Inject(LOCAL_STORAGE_PROVIDER)
    private readonly storageProvider: StorageProviderAdapter,
  ) {}

  async storeRemoteMedia(input: StoreRemoteMediaInput) {
    const existing = await this.prisma.mediaFile.findUnique({
      where: {
        messageId: input.messageId,
      },
    });

    if (existing) {
      return {
        mediaFile: existing,
        deduplicated: true,
      };
    }

    const message = await this.prisma.message.findUnique({
      where: {
        id: input.messageId,
      },
      include: {
        conversation: {
          select: {
            id: true,
            userId: true,
          },
        },
      },
    });

    if (!message) {
      throw new NotFoundException('Mensagem de mídia não encontrada');
    }

    if (
      message.conversationId !== input.conversationId ||
      message.conversation.userId !== input.userId
    ) {
      throw new BadRequestException(
        'Mensagem, conversa e usuário não correspondem',
      );
    }

    this.assertCompatibleMediaType(input.mediaType, message.type);
    const maxBytes = this.getMaximumSize(input.mediaType);

    if (
      input.declaredFileSize !== undefined &&
      input.declaredFileSize > maxBytes
    ) {
      throw new PayloadTooLargeException(
        'A mídia excede o tamanho máximo permitido',
      );
    }

    const downloaded = await this.loadMedia(input, maxBytes);

    if (
      downloaded.content.length === 0 ||
      downloaded.content.length > maxBytes
    ) {
      throw new PayloadTooLargeException('A mídia possui tamanho inválido');
    }

    const mimeType = this.validateMimeType(
      input.mediaType,
      input.declaredMimeType ?? downloaded.contentType,
      downloaded.content,
    );
    const checksum = createHash('sha256')
      .update(downloaded.content)
      .digest('hex');
    const storedObject = await this.storageProvider.store({
      checksum,
      content: downloaded.content,
    });
    const originalFileName = this.normalizeFileName(
      input.originalFileName ?? downloaded.originalFileName,
      input.messageId,
      mimeType,
    );

    try {
      const mediaFile = await this.prisma.mediaFile.create({
        data: {
          userId: input.userId,
          conversationId: input.conversationId,
          messageId: input.messageId,
          mediaType: input.mediaType,
          storageProvider: StorageProvider.LOCAL,
          originalFileName,
          mimeType,
          fileSize: downloaded.content.length,
          checksum,
          storagePath: storedObject.storagePath,
          publicUrl: null,
        },
      });

      return {
        mediaFile,
        deduplicated: storedObject.deduplicated,
      };
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const concurrentMediaFile = await this.prisma.mediaFile.findUnique({
          where: {
            messageId: input.messageId,
          },
        });

        if (concurrentMediaFile) {
          return {
            mediaFile: concurrentMediaFile,
            deduplicated: true,
          };
        }
      }

      throw error;
    }
  }

  async openForDownload(
    mediaFileId: string,
    requester: {
      userId: string;
      role: UserRole;
    },
  ) {
    const mediaFile = await this.prisma.mediaFile.findUnique({
      where: {
        id: mediaFileId,
      },
    });

    if (!mediaFile) {
      throw new NotFoundException('Mídia não encontrada');
    }

    if (
      requester.role !== UserRole.ADMIN &&
      mediaFile.userId !== requester.userId
    ) {
      throw new ForbiddenException('Acesso à mídia não autorizado');
    }

    if (mediaFile.storageProvider !== StorageProvider.LOCAL) {
      throw new ServiceUnavailableException(
        'Provider de armazenamento ainda não disponível',
      );
    }

    const openedObject = await this.storageProvider.open(mediaFile.storagePath);

    if (openedObject.fileSize !== mediaFile.fileSize) {
      throw new ServiceUnavailableException(
        'Tamanho do arquivo armazenado não corresponde ao registro',
      );
    }

    return {
      mediaFile,
      stream: openedObject.stream,
    };
  }

  async getImageDataUrl(mediaFileId: string) {
    const mediaFile = await this.prisma.mediaFile.findUnique({
      where: {
        id: mediaFileId,
      },
    });

    if (!mediaFile) {
      throw new NotFoundException('Mídia não encontrada');
    }

    if (mediaFile.mediaType !== MediaType.IMAGE) {
      throw new BadRequestException('A mídia informada não é uma imagem');
    }

    if (mediaFile.storageProvider !== StorageProvider.LOCAL) {
      throw new ServiceUnavailableException(
        'Provider de armazenamento ainda não disponível',
      );
    }

    const openedObject = await this.storageProvider.open(mediaFile.storagePath);

    if (openedObject.fileSize !== mediaFile.fileSize) {
      throw new ServiceUnavailableException(
        'Tamanho do arquivo armazenado não corresponde ao registro',
      );
    }

    const chunks: Buffer[] = [];
    let receivedBytes = 0;

    for await (const chunk of openedObject.stream) {
      const buffer = Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(chunk as Uint8Array);
      receivedBytes += buffer.length;

      if (receivedBytes > mediaFile.fileSize) {
        throw new ServiceUnavailableException(
          'Conteúdo armazenado excede o tamanho registrado',
        );
      }

      chunks.push(buffer);
    }

    if (receivedBytes !== mediaFile.fileSize) {
      throw new ServiceUnavailableException(
        'Conteúdo armazenado está incompleto',
      );
    }

    const content = Buffer.concat(chunks);
    const checksum = createHash('sha256').update(content).digest('hex');

    if (checksum !== mediaFile.checksum) {
      throw new ServiceUnavailableException(
        'Integridade da mídia armazenada inválida',
      );
    }

    return {
      mediaFile,
      dataUrl: `data:${mediaFile.mimeType};base64,${content.toString('base64')}`,
    };
  }

  private async loadMedia(
    input: StoreRemoteMediaInput,
    maxBytes: number,
  ): Promise<DownloadedMedia> {
    if (input.base64Data) {
      return {
        content: this.decodeBase64(input.base64Data, maxBytes),
        contentType: input.declaredMimeType,
        originalFileName: input.originalFileName,
      };
    }

    if (!input.sourceUrl) {
      throw new BadRequestException(
        'A mídia não possui URL ou conteúdo para armazenamento',
      );
    }

    return this.downloader.download(input.sourceUrl, maxBytes);
  }

  private decodeBase64(value: string, maxBytes: number): Buffer {
    const match = /^(?:data:([^;,]+);base64,)?([A-Za-z0-9+/=\s]+)$/.exec(
      value.trim(),
    );

    if (!match?.[2]) {
      throw new BadRequestException('Conteúdo base64 da mídia inválido');
    }

    const encoded = match[2].replace(/\s/g, '');
    const estimatedBytes = Math.floor((encoded.length * 3) / 4);

    if (estimatedBytes > maxBytes) {
      throw new PayloadTooLargeException(
        'A mídia excede o tamanho máximo permitido',
      );
    }

    const content = Buffer.from(encoded, 'base64');
    const normalizedInput = encoded.replace(/=+$/, '');
    const normalizedOutput = content.toString('base64').replace(/=+$/, '');

    if (normalizedInput !== normalizedOutput) {
      throw new BadRequestException('Conteúdo base64 da mídia inválido');
    }

    return content;
  }

  private validateMimeType(
    mediaType: MediaType,
    declaredMimeType: string | undefined,
    content: Buffer,
  ): string {
    const mimeType = this.normalizeMimeType(declaredMimeType);

    if (!mimeType || !ALLOWED_MIME_TYPES[mediaType].has(mimeType)) {
      throw new BadRequestException('Tipo MIME da mídia não permitido');
    }

    if (!this.matchesSignature(mimeType, content)) {
      throw new BadRequestException(
        'Conteúdo da mídia não corresponde ao tipo MIME informado',
      );
    }

    return mimeType;
  }

  private matchesSignature(mimeType: string, content: Buffer): boolean {
    if (mimeType === 'image/jpeg') {
      return content.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
    }

    if (mimeType === 'image/png') {
      return content
        .subarray(0, 8)
        .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    }

    if (mimeType === 'image/webp') {
      return (
        content.subarray(0, 4).toString('ascii') === 'RIFF' &&
        content.subarray(8, 12).toString('ascii') === 'WEBP'
      );
    }

    if (mimeType === 'image/gif') {
      const signature = content.subarray(0, 6).toString('ascii');
      return signature === 'GIF87a' || signature === 'GIF89a';
    }

    if (mimeType === 'audio/ogg') {
      return content.subarray(0, 4).toString('ascii') === 'OggS';
    }

    if (mimeType === 'audio/mpeg') {
      return (
        content.subarray(0, 3).toString('ascii') === 'ID3' ||
        (content[0] === 0xff && (content[1] & 0xe0) === 0xe0)
      );
    }

    if (mimeType === 'audio/wav' || mimeType === 'audio/x-wav') {
      return (
        content.subarray(0, 4).toString('ascii') === 'RIFF' &&
        content.subarray(8, 12).toString('ascii') === 'WAVE'
      );
    }

    if (mimeType === 'audio/mp4') {
      return content.subarray(4, 8).toString('ascii') === 'ftyp';
    }

    if (mimeType === 'application/pdf') {
      return content.subarray(0, 5).toString('ascii') === '%PDF-';
    }

    if (mimeType === 'text/plain') {
      return !content.subarray(0, 8_192).includes(0);
    }

    if (mimeType.includes('openxmlformats-officedocument')) {
      return content.subarray(0, 2).toString('ascii') === 'PK';
    }

    if (
      mimeType === 'application/msword' ||
      mimeType === 'application/vnd.ms-excel' ||
      mimeType === 'application/vnd.ms-powerpoint'
    ) {
      return content
        .subarray(0, 8)
        .equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
    }

    return false;
  }

  private normalizeMimeType(value: string | undefined): string | undefined {
    if (!value) {
      return undefined;
    }

    const normalized = value.split(';', 1)[0].trim().toLowerCase();
    return normalized === 'image/jpg' ? 'image/jpeg' : normalized;
  }

  private getMaximumSize(mediaType: MediaType): number {
    const key: Record<MediaType, string> = {
      [MediaType.IMAGE]: 'MAX_IMAGE_SIZE_MB',
      [MediaType.AUDIO]: 'MAX_AUDIO_SIZE_MB',
      [MediaType.DOCUMENT]: 'MAX_DOCUMENT_SIZE_MB',
    };
    const configured = this.configService.get<string>(key[mediaType]);
    const megabytes = Number(configured);

    if (!Number.isFinite(megabytes) || megabytes <= 0 || megabytes > 500) {
      throw new ServiceUnavailableException(
        `Configuração de tamanho inválida: ${key[mediaType]}`,
      );
    }

    return Math.floor(megabytes * 1024 * 1024);
  }

  private assertCompatibleMediaType(
    mediaType: MediaType,
    messageType: MessageType,
  ): void {
    const expectedMessageType: Record<MediaType, MessageType> = {
      [MediaType.IMAGE]: MessageType.IMAGE,
      [MediaType.AUDIO]: MessageType.AUDIO,
      [MediaType.DOCUMENT]: MessageType.DOCUMENT,
    };

    if (messageType !== expectedMessageType[mediaType]) {
      throw new BadRequestException(
        'O tipo da mídia não corresponde ao tipo da mensagem',
      );
    }
  }

  private normalizeFileName(
    value: string | undefined,
    messageId: string,
    mimeType: string,
  ): string {
    const extension = FILE_EXTENSIONS[mimeType] ?? 'bin';
    const fallback = `media-${messageId}.${extension}`;

    if (!value?.trim()) {
      return fallback;
    }

    const printableName = Array.from(basename(value.trim()))
      .filter((character) => {
        const codePoint = character.codePointAt(0) ?? 0;
        return codePoint >= 32 && codePoint !== 127;
      })
      .join('');
    const normalized = printableName
      .replace(/[<>:"/\\|?*]/g, '_')
      .slice(0, 255);

    return normalized || fallback;
  }
}
