import { BadRequestException, Injectable } from '@nestjs/common';
import {
  MediaType,
  MessageType,
  Prisma,
  SubscriptionStatus,
  WebhookStatus,
} from '@prisma/client';
import { phoneFromRemoteJid } from '../common/phone-number.util';
import { EventBusService } from '../event-bus/event-bus.service';
import { INTERNAL_EVENT } from '../event-bus/event-bus.constants';
import { MediaService } from '../storage/media.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { UsersService } from '../users/users.service';
import { MessagesService } from '../whatsapp/messages.service';
import { EvolutionGateway } from './evolution.gateway';
import { PrismaService } from '../prisma/prisma.service';
import {
  EvolutionInboundMessage,
  EvolutionWebhookResult,
} from './interfaces/evolution-api.interface';

@Injectable()
export class EvolutionWebhookService {
  constructor(
    private readonly evolutionGateway: EvolutionGateway,
    private readonly usersService: UsersService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly messagesService: MessagesService,
    private readonly mediaService: MediaService,
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBusService,
  ) {}

  async handle(
    payload: unknown,
    webhookSecret: string | undefined,
  ): Promise<EvolutionWebhookResult | EvolutionWebhookResult[]> {
    this.evolutionGateway.validateWebhookSecret(webhookSecret);

    if (!this.isRecord(payload)) {
      throw new BadRequestException('Evento Evolution inválido');
    }

    const event = this.normalizeEvent(payload.event);

    if (event !== 'MESSAGES_UPSERT') {
      return {
        received: true,
        processed: false,
        reason: 'EVENT_IGNORED',
      };
    }

    const instanceName =
      typeof payload.instance === 'string' ? payload.instance.trim() : '';

    if (instanceName !== this.evolutionGateway.getInstanceName()) {
      return {
        received: true,
        processed: false,
        reason: 'INSTANCE_MISMATCH',
      };
    }

    const entries = Array.isArray(payload.data) ? payload.data : [payload.data];

    if (entries.length === 0) {
      throw new BadRequestException('Evento Evolution sem mensagens');
    }

    const results = await Promise.all(
      entries.map((entry) => this.enqueueEntry(instanceName, entry)),
    );

    return results.length === 1 ? results[0] : results;
  }

  processQueuedEntry(
    instanceName: string,
    entry: unknown,
  ): Promise<EvolutionWebhookResult> {
    return this.processEntry(instanceName, entry);
  }

  async processQueuedEvent(eventId: string): Promise<EvolutionWebhookResult> {
    const event = await this.prisma.evolutionInboundEvent.findUnique({
      where: {
        id: eventId,
      },
    });

    if (!event) {
      throw new BadRequestException('Evento Evolution persistido não existe');
    }

    if (event.status === WebhookStatus.PROCESSED) {
      return {
        received: true,
        processed: true,
        duplicated: true,
      };
    }

    await this.prisma.evolutionInboundEvent.update({
      where: {
        id: event.id,
      },
      data: {
        status: WebhookStatus.PROCESSING,
        attempts: {
          increment: 1,
        },
        claimedAt: new Date(),
        lastError: null,
      },
    });

    try {
      const result = await this.processEntry(event.instanceName, event.payload);

      await this.prisma.evolutionInboundEvent.update({
        where: {
          id: event.id,
        },
        data: {
          status: WebhookStatus.PROCESSED,
          processedAt: new Date(),
          leaseExpiresAt: null,
          lastError: null,
        },
      });

      return result;
    } catch (error: unknown) {
      await this.prisma.evolutionInboundEvent.update({
        where: {
          id: event.id,
        },
        data: {
          status: WebhookStatus.FAILED,
          leaseExpiresAt: null,
          lastError: this.safeError(error),
        },
      });
      throw error;
    }
  }

  private async enqueueEntry(
    instanceName: string,
    entry: unknown,
  ): Promise<EvolutionWebhookResult> {
    if (!this.isRecord(entry) || !this.isRecord(entry.key)) {
      throw new BadRequestException('Mensagem Evolution inválida');
    }

    const externalMessageId =
      typeof entry.key.id === 'string' ? entry.key.id.trim() : '';

    if (!externalMessageId) {
      throw new BadRequestException('Mensagem Evolution sem identificador');
    }

    return this.prisma.$transaction(async (transaction) => {
      const existing = await transaction.evolutionInboundEvent.findUnique({
        where: {
          instanceName_externalMessageId: {
            instanceName,
            externalMessageId,
          },
        },
      });
      const event = await transaction.evolutionInboundEvent.upsert({
        where: {
          instanceName_externalMessageId: {
            instanceName,
            externalMessageId,
          },
        },
        update: {},
        create: {
          instanceName,
          externalMessageId,
          payload: entry as Prisma.InputJsonValue,
        },
      });

      await this.eventBus.publish(
        {
          eventType: INTERNAL_EVENT.WHATSAPP_MESSAGE_RECEIVED,
          aggregateType: 'EVOLUTION_INBOUND_EVENT',
          aggregateId: event.id,
          payload: {
            evolutionInboundEventId: event.id,
          },
        },
        transaction,
      );

      return {
        received: true,
        processed: false,
        duplicated: existing !== null,
        reason: 'QUEUED',
      };
    });
  }

  private async processEntry(
    instanceName: string,
    entry: unknown,
  ): Promise<EvolutionWebhookResult> {
    const inboundMessage = this.parseInboundMessage(instanceName, entry);

    if (
      !inboundMessage ||
      inboundMessage.fromMe ||
      inboundMessage.remoteJid.endsWith('@g.us')
    ) {
      return {
        received: true,
        processed: false,
        reason: 'MESSAGE_IGNORED',
      };
    }

    const phoneNumber = phoneFromRemoteJid(inboundMessage.remoteJid);

    if (!phoneNumber) {
      return {
        received: true,
        processed: false,
        reason: 'MESSAGE_IGNORED',
      };
    }

    const user = await this.usersService.findByWhatsAppPhone(phoneNumber);

    if (!user) {
      return {
        received: true,
        processed: false,
        reason: 'USER_NOT_FOUND',
      };
    }

    const subscription =
      await this.subscriptionsService.getMessagingSubscription(user.id);
    const persisted = await this.messagesService.createInbound({
      userId: user.id,
      subscriptionId: subscription?.id,
      phoneNumber,
      instanceName: inboundMessage.instanceName,
      externalMessageId: inboundMessage.externalMessageId,
      type: MessageType[inboundMessage.messageType],
      content: inboundMessage.content,
      remoteJid: inboundMessage.remoteJid,
      timestamp: inboundMessage.messageTimestamp,
      mediaUrl: inboundMessage.mediaUrl,
      mimeType: inboundMessage.mimeType,
      fileSize: inboundMessage.fileSize,
    });
    const mediaFile = await this.storeMediaIfPresent(
      user.id,
      persisted.message.conversationId,
      persisted.message.id,
      inboundMessage,
    );

    if (mediaFile) {
      await this.eventBus.publish({
        eventType: INTERNAL_EVENT.MEDIA_RECEIVED,
        aggregateType: 'MEDIA_FILE',
        aggregateId: mediaFile.mediaFile.id,
        payload: {
          mediaFileId: mediaFile.mediaFile.id,
          messageId: persisted.message.id,
          mediaType: mediaFile.mediaFile.mediaType,
          userId: user.id,
        },
      });
    }

    await this.eventBus.publish({
      eventType: INTERNAL_EVENT.USER_CONTEXT_REFRESH_REQUESTED,
      aggregateType: 'MESSAGE',
      aggregateId: persisted.message.id,
      payload: {
        userId: user.id,
        messageId: persisted.message.id,
      },
    });

    return {
      received: true,
      processed: true,
      duplicated: persisted.duplicated,
      messageId: persisted.message.id,
      mediaFileId: mediaFile?.mediaFile.id,
      userId: user.id,
      subscriptionStatus: this.toTrackableStatus(subscription?.status),
    };
  }

  private parseInboundMessage(
    instanceName: string,
    entry: unknown,
  ): EvolutionInboundMessage | null {
    if (!this.isRecord(entry) || !this.isRecord(entry.key)) {
      throw new BadRequestException('Mensagem Evolution inválida');
    }

    const remoteJid =
      typeof entry.key.remoteJid === 'string' ? entry.key.remoteJid.trim() : '';
    const externalMessageId =
      typeof entry.key.id === 'string' ? entry.key.id.trim() : '';

    if (!remoteJid || !externalMessageId) {
      throw new BadRequestException(
        'Mensagem Evolution sem identificadores obrigatórios',
      );
    }

    const message = this.unwrapMessage(entry.message);

    if (!message) {
      return null;
    }

    const parsedContent = this.parseMessageContent(message);

    if (!parsedContent) {
      return null;
    }

    return {
      instanceName,
      externalMessageId,
      remoteJid,
      fromMe: entry.key.fromMe === true,
      messageTimestamp: this.parseTimestamp(entry.messageTimestamp),
      ...parsedContent,
    };
  }

  private parseMessageContent(
    message: Record<string, unknown>,
  ): Pick<
    EvolutionInboundMessage,
    | 'messageType'
    | 'content'
    | 'mediaUrl'
    | 'mimeType'
    | 'fileSize'
    | 'mediaBase64'
    | 'originalFileName'
  > | null {
    if (typeof message.conversation === 'string') {
      return {
        messageType: 'TEXT',
        content: this.requireContent(message.conversation, 'Mensagem'),
      };
    }

    const extendedText = this.asRecord(message.extendedTextMessage);

    if (extendedText && typeof extendedText.text === 'string') {
      return {
        messageType: 'TEXT',
        content: this.requireContent(extendedText.text, 'Mensagem'),
      };
    }

    const image = this.asRecord(message.imageMessage);

    if (image) {
      return this.parseMedia('IMAGE', image, '[Imagem]');
    }

    const audio = this.asRecord(message.audioMessage);

    if (audio) {
      return this.parseMedia('AUDIO', audio, '[Áudio]');
    }

    const document = this.asRecord(message.documentMessage);

    if (document) {
      const fallback =
        typeof document.fileName === 'string' && document.fileName.trim()
          ? `[Documento] ${document.fileName.trim()}`
          : '[Documento]';
      return this.parseMedia('DOCUMENT', document, fallback);
    }

    return null;
  }

  private parseMedia(
    messageType: 'IMAGE' | 'AUDIO' | 'DOCUMENT',
    media: Record<string, unknown>,
    fallbackContent: string,
  ): Pick<
    EvolutionInboundMessage,
    | 'messageType'
    | 'content'
    | 'mediaUrl'
    | 'mimeType'
    | 'fileSize'
    | 'mediaBase64'
    | 'originalFileName'
  > {
    const caption =
      typeof media.caption === 'string' && media.caption.trim()
        ? media.caption.trim()
        : fallbackContent;
    const mediaUrl =
      typeof media.url === 'string' && media.url.trim()
        ? media.url.trim()
        : undefined;
    const mimeType =
      typeof media.mimetype === 'string' && media.mimetype.trim()
        ? media.mimetype.trim()
        : undefined;
    const mediaBase64 =
      typeof media.base64 === 'string' && media.base64.trim()
        ? media.base64.trim()
        : undefined;
    const originalFileName =
      typeof media.fileName === 'string' && media.fileName.trim()
        ? media.fileName.trim()
        : undefined;

    return {
      messageType,
      content: caption.slice(0, 10_000),
      mediaUrl,
      mediaBase64,
      mimeType,
      fileSize: this.parseFileSize(media.fileLength),
      originalFileName,
    };
  }

  private async storeMediaIfPresent(
    userId: string,
    conversationId: string,
    messageId: string,
    inboundMessage: EvolutionInboundMessage,
  ) {
    if (inboundMessage.messageType === 'TEXT') {
      return null;
    }

    const mediaType: Record<
      Exclude<EvolutionInboundMessage['messageType'], 'TEXT'>,
      MediaType
    > = {
      IMAGE: MediaType.IMAGE,
      AUDIO: MediaType.AUDIO,
      DOCUMENT: MediaType.DOCUMENT,
    };

    return this.mediaService.storeRemoteMedia({
      userId,
      conversationId,
      messageId,
      mediaType: mediaType[inboundMessage.messageType],
      sourceUrl: inboundMessage.mediaUrl,
      base64Data: inboundMessage.mediaBase64,
      originalFileName: inboundMessage.originalFileName,
      declaredMimeType: inboundMessage.mimeType,
      declaredFileSize: inboundMessage.fileSize,
    });
  }

  private unwrapMessage(value: unknown): Record<string, unknown> | null {
    let message = this.asRecord(value);

    for (let depth = 0; message && depth < 4; depth += 1) {
      const wrapper =
        this.asRecord(message.ephemeralMessage) ??
        this.asRecord(message.viewOnceMessage) ??
        this.asRecord(message.viewOnceMessageV2) ??
        this.asRecord(message.documentWithCaptionMessage);
      const nestedMessage = wrapper
        ? this.asRecord(wrapper.message)
        : undefined;

      if (!nestedMessage) {
        return message;
      }

      message = nestedMessage;
    }

    return message ?? null;
  }

  private parseTimestamp(value: unknown): Date {
    const numericValue =
      typeof value === 'number'
        ? value
        : typeof value === 'string'
          ? Number(value)
          : Number.NaN;

    if (!Number.isFinite(numericValue) || numericValue <= 0) {
      return new Date();
    }

    const milliseconds =
      numericValue < 10_000_000_000 ? numericValue * 1_000 : numericValue;
    const timestamp = new Date(milliseconds);

    return Number.isNaN(timestamp.getTime()) ? new Date() : timestamp;
  }

  private parseFileSize(value: unknown): number | undefined {
    const parsedValue =
      typeof value === 'number'
        ? value
        : typeof value === 'string'
          ? Number(value)
          : Number.NaN;

    if (
      !Number.isInteger(parsedValue) ||
      parsedValue < 0 ||
      parsedValue > 2_147_483_647
    ) {
      return undefined;
    }

    return parsedValue;
  }

  private requireContent(value: string, label: string): string {
    const content = value.trim();

    if (!content) {
      throw new BadRequestException(`${label} Evolution vazia`);
    }

    return content.slice(0, 10_000);
  }

  private normalizeEvent(value: unknown): string {
    return typeof value === 'string'
      ? value.trim().toUpperCase().replace(/[.-]/g, '_')
      : '';
  }

  private toTrackableStatus(
    status: SubscriptionStatus | undefined,
  ): 'ACTIVE' | 'PAST_DUE' | 'EXPIRED' | undefined {
    if (
      status === SubscriptionStatus.ACTIVE ||
      status === SubscriptionStatus.PAST_DUE ||
      status === SubscriptionStatus.EXPIRED
    ) {
      return status;
    }

    return undefined;
  }

  private asRecord(value: unknown): Record<string, unknown> | undefined {
    return this.isRecord(value) ? value : undefined;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private safeError(error: unknown): string {
    if (error instanceof Error && error.message.trim()) {
      return error.message.trim().slice(0, 2_000);
    }

    return 'Falha não identificada no processamento Evolution';
  }
}
