import {
  BadRequestException,
  ForbiddenException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  MediaType,
  MessageType,
  StorageProvider,
  UserRole,
} from '@prisma/client';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import type { StorageProviderAdapter } from './interfaces/storage-provider.interface';
import { MediaService } from './media.service';
import { SecureMediaDownloader } from './secure-media-downloader';

describe('MediaService', () => {
  function createSubject(options?: {
    existingMedia?: object | null;
    messageType?: MessageType;
    storedContent?: Buffer;
  }) {
    const storedContent = options?.storedContent ?? Buffer.from('content');
    const mediaFile = {
      id: 'media-file-id',
      userId: 'user-id',
      conversationId: 'conversation-id',
      messageId: 'message-id',
      mediaType: MediaType.IMAGE,
      storageProvider: StorageProvider.LOCAL,
      originalFileName: 'meal.jpg',
      mimeType: 'image/jpeg',
      fileSize: storedContent.length,
      checksum: createHash('sha256').update(storedContent).digest('hex'),
      storagePath: 'sha256/path',
      publicUrl: null,
      createdAt: new Date(),
    };
    const prisma = {
      mediaFile: {
        findUnique: jest.fn().mockResolvedValue(options?.existingMedia ?? null),
        create: jest.fn().mockResolvedValue(mediaFile),
      },
      message: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'message-id',
          type: options?.messageType ?? MessageType.IMAGE,
          conversationId: 'conversation-id',
          conversation: {
            id: 'conversation-id',
            userId: 'user-id',
          },
        }),
      },
    };
    const configService = {
      get: jest.fn((key: string) => {
        const values: Record<string, string> = {
          MAX_IMAGE_SIZE_MB: '10',
          MAX_AUDIO_SIZE_MB: '25',
          MAX_DOCUMENT_SIZE_MB: '25',
        };

        return values[key];
      }),
    };
    const downloader = {
      download: jest.fn(),
    };
    const storageStoreMock = jest.fn().mockResolvedValue({
      storagePath: 'sha256/path',
      deduplicated: false,
    });
    const storageProvider: StorageProviderAdapter = {
      store: storageStoreMock,
      open: jest.fn().mockResolvedValue({
        stream: Readable.from(storedContent),
        fileSize: storedContent.length,
      }),
    };
    const service = new MediaService(
      prisma as unknown as PrismaService,
      configService as unknown as ConfigService,
      downloader as unknown as SecureMediaDownloader,
      storageProvider,
    );

    return {
      service,
      prisma,
      downloader,
      storageProvider,
      storageStoreMock,
      mediaFile,
    };
  }

  it('validates a JPEG signature, stores it and persists metadata', async () => {
    const subject = createSubject();
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01, 0x02, 0x03]);
    subject.downloader.download.mockResolvedValue({
      content: jpeg,
      contentType: 'image/jpeg',
      originalFileName: 'meal.jpg',
    });

    const result = await subject.service.storeRemoteMedia({
      userId: 'user-id',
      conversationId: 'conversation-id',
      messageId: 'message-id',
      mediaType: MediaType.IMAGE,
      sourceUrl: 'https://media.example.com/meal.jpg',
      declaredMimeType: 'image/jpeg',
      declaredFileSize: jpeg.length,
    });

    expect(result.mediaFile).toBe(subject.mediaFile);
    expect(subject.storageStoreMock).toHaveBeenCalledWith({
      checksum: expect.stringMatching(/^[a-f0-9]{64}$/),
      content: jpeg,
    });
    expect(subject.prisma.mediaFile.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        messageId: 'message-id',
        mediaType: MediaType.IMAGE,
        mimeType: 'image/jpeg',
        fileSize: jpeg.length,
        storageProvider: StorageProvider.LOCAL,
        publicUrl: null,
      }),
    });
  });

  it('returns the existing media without downloading it again', async () => {
    const existingMedia = {
      id: 'existing-media-id',
    };
    const subject = createSubject({
      existingMedia,
    });

    const result = await subject.service.storeRemoteMedia({
      userId: 'user-id',
      conversationId: 'conversation-id',
      messageId: 'message-id',
      mediaType: MediaType.IMAGE,
      sourceUrl: 'https://media.example.com/meal.jpg',
    });

    expect(result).toEqual({
      mediaFile: existingMedia,
      deduplicated: true,
    });
    expect(subject.downloader.download).not.toHaveBeenCalled();
  });

  it('rejects content whose signature does not match the MIME type', async () => {
    const subject = createSubject();
    subject.downloader.download.mockResolvedValue({
      content: Buffer.from('not-an-image'),
      contentType: 'image/jpeg',
    });

    await expect(
      subject.service.storeRemoteMedia({
        userId: 'user-id',
        conversationId: 'conversation-id',
        messageId: 'message-id',
        mediaType: MediaType.IMAGE,
        sourceUrl: 'https://media.example.com/meal.jpg',
        declaredMimeType: 'image/jpeg',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(subject.storageStoreMock).not.toHaveBeenCalled();
  });

  it('rejects declared media larger than the configured limit', async () => {
    const subject = createSubject();

    await expect(
      subject.service.storeRemoteMedia({
        userId: 'user-id',
        conversationId: 'conversation-id',
        messageId: 'message-id',
        mediaType: MediaType.IMAGE,
        sourceUrl: 'https://media.example.com/meal.jpg',
        declaredFileSize: 11 * 1024 * 1024,
      }),
    ).rejects.toBeInstanceOf(PayloadTooLargeException);
  });

  it('allows only the owner or an administrator to download media', async () => {
    const subject = createSubject({
      existingMedia: null,
    });
    subject.prisma.mediaFile.findUnique.mockResolvedValue(subject.mediaFile);

    await expect(
      subject.service.openForDownload('media-file-id', {
        userId: 'another-user-id',
        role: UserRole.USER,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    await expect(
      subject.service.openForDownload('media-file-id', {
        userId: 'admin-id',
        role: UserRole.ADMIN,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        mediaFile: subject.mediaFile,
      }),
    );
  });

  it('returns an integrity-checked data URL for internal image processing', async () => {
    const storedContent = Buffer.from('private-image');
    const subject = createSubject({
      storedContent,
    });
    subject.prisma.mediaFile.findUnique.mockResolvedValue(subject.mediaFile);

    await expect(
      subject.service.getImageDataUrl('media-file-id'),
    ).resolves.toEqual({
      mediaFile: subject.mediaFile,
      dataUrl: `data:image/jpeg;base64,${storedContent.toString('base64')}`,
    });
  });

  it('rejects internally stored media whose checksum is inconsistent', async () => {
    const subject = createSubject({
      storedContent: Buffer.from('private-image'),
    });
    subject.prisma.mediaFile.findUnique.mockResolvedValue({
      ...subject.mediaFile,
      checksum: '0'.repeat(64),
    });

    await expect(
      subject.service.getImageDataUrl('media-file-id'),
    ).rejects.toThrow('Integridade da mídia armazenada inválida');
  });
});
