import { BadRequestException } from '@nestjs/common';
import { MediaType, MessageType, SubscriptionStatus } from '@prisma/client';
import { EventBusService } from '../event-bus/event-bus.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { MediaService } from '../storage/media.service';
import { UsersService } from '../users/users.service';
import { MessagesService } from '../whatsapp/messages.service';
import { EvolutionGateway } from './evolution.gateway';
import { EvolutionWebhookService } from './evolution-webhook.service';
import { PrismaService } from '../prisma/prisma.service';

describe('EvolutionWebhookService', () => {
  function createSubject(options?: {
    userFound?: boolean;
    duplicated?: boolean;
    subscriptionStatus?: SubscriptionStatus;
  }) {
    const evolutionGateway = {
      validateWebhookSecret: jest.fn(),
      getInstanceName: jest.fn().mockReturnValue('singulfit'),
    };
    const usersService = {
      findByWhatsAppPhone: jest.fn().mockResolvedValue(
        options?.userFound === false
          ? null
          : {
              id: 'user-id',
              phoneE164: '+5511999999999',
            },
      ),
    };
    const subscriptionsService = {
      getMessagingSubscription: jest.fn().mockResolvedValue({
        id: 'subscription-id',
        status: options?.subscriptionStatus ?? SubscriptionStatus.ACTIVE,
      }),
    };
    const messagesService = {
      createInbound: jest.fn().mockResolvedValue({
        message: {
          id: 'message-id',
          conversationId: 'conversation-id',
        },
        duplicated: options?.duplicated ?? false,
      }),
    };
    const mediaService = {
      storeRemoteMedia: jest.fn().mockResolvedValue({
        mediaFile: {
          id: 'media-file-id',
          mediaType: MediaType.IMAGE,
        },
        deduplicated: false,
      }),
    };
    const transaction = {
      evolutionInboundEvent: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({
          id: 'inbound-event-id',
        }),
      },
    };
    const prisma = {
      $transaction: jest.fn(
        (operation: (client: typeof transaction) => unknown) =>
          operation(transaction),
      ),
    };
    const eventBus = {
      publish: jest.fn().mockResolvedValue({
        id: 'outbox-id',
      }),
    };
    const service = new EvolutionWebhookService(
      evolutionGateway as unknown as EvolutionGateway,
      usersService as unknown as UsersService,
      subscriptionsService as unknown as SubscriptionsService,
      messagesService as unknown as MessagesService,
      mediaService as unknown as MediaService,
      prisma as unknown as PrismaService,
      eventBus as unknown as EventBusService,
    );

    return {
      service,
      evolutionGateway,
      usersService,
      subscriptionsService,
      messagesService,
      mediaService,
      eventBus,
      transaction,
    };
  }

  function webhook(message: Record<string, unknown>) {
    return {
      event: 'messages.upsert',
      instance: 'singulfit',
      data: {
        key: {
          id: 'wamid-test',
          remoteJid: '5511999999999@s.whatsapp.net',
          fromMe: false,
        },
        messageTimestamp: 1_780_778_400,
        message,
      },
    };
  }

  function process(
    service: EvolutionWebhookService,
    message: Record<string, unknown>,
  ) {
    return service.processQueuedEntry('singulfit', webhook(message).data);
  }

  it('links an inbound text message to the user and active subscription', async () => {
    const subject = createSubject();

    const result = await process(subject.service, {
      conversation: 'Olá, Lucy',
    });

    expect(result).toEqual({
      received: true,
      processed: true,
      duplicated: false,
      messageId: 'message-id',
      userId: 'user-id',
      subscriptionStatus: SubscriptionStatus.ACTIVE,
    });
    expect(subject.usersService.findByWhatsAppPhone).toHaveBeenCalledWith(
      '+5511999999999',
    );
    expect(subject.messagesService.createInbound).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-id',
        subscriptionId: 'subscription-id',
        type: MessageType.TEXT,
        content: 'Olá, Lucy',
      }),
    );
    expect(subject.eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'COACH_ONBOARDING_TEXT_RECEIVED',
        aggregateType: 'MESSAGE',
        aggregateId: 'message-id',
        payload: {
          userId: 'user-id',
          messageId: 'message-id',
        },
      }),
    );
    expect(subject.eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'USER_CONTEXT_REFRESH_REQUESTED',
        aggregateType: 'MESSAGE',
        aggregateId: 'message-id',
        payload: {
          userId: 'user-id',
          messageId: 'message-id',
        },
      }),
    );
  });

  it.each([
    {
      label: 'image',
      field: 'imageMessage',
      type: MessageType.IMAGE,
      fallback: '[Imagem]',
      mimeType: 'image/jpeg',
    },
    {
      label: 'audio',
      field: 'audioMessage',
      type: MessageType.AUDIO,
      fallback: '[Áudio]',
      mimeType: 'audio/ogg',
    },
    {
      label: 'document',
      field: 'documentMessage',
      type: MessageType.DOCUMENT,
      fallback: '[Documento]',
      mimeType: 'application/pdf',
    },
  ])(
    'persists $label media metadata',
    async ({ field, type, fallback, mimeType }) => {
      const subject = createSubject({
        subscriptionStatus: SubscriptionStatus.PAST_DUE,
      });

      await process(subject.service, {
        [field]: {
          url: 'https://media.example.com/file.enc',
          base64: 'dGVzdA==',
          mimetype: mimeType,
          fileLength: '4096',
        },
      });

      expect(subject.messagesService.createInbound).toHaveBeenCalledWith(
        expect.objectContaining({
          type,
          content: fallback,
          mediaUrl: 'https://media.example.com/file.enc',
          mimeType,
          fileSize: 4096,
        }),
      );
      expect(subject.mediaService.storeRemoteMedia).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-id',
          conversationId: 'conversation-id',
          messageId: 'message-id',
          sourceUrl: 'https://media.example.com/file.enc',
          base64Data: 'dGVzdA==',
          declaredMimeType: mimeType,
          declaredFileSize: 4096,
        }),
      );
    },
  );

  it('returns the same message safely when Evolution retries the event', async () => {
    const subject = createSubject({
      duplicated: true,
    });

    const result = await process(subject.service, {
      extendedTextMessage: {
        text: 'Mensagem repetida',
      },
    });

    expect(result).toEqual(
      expect.objectContaining({
        received: true,
        processed: true,
        duplicated: true,
        messageId: 'message-id',
      }),
    );
  });

  it('publishes media processing instead of running nutrition inline', async () => {
    const subject = createSubject();

    const result = await process(subject.service, {
      imageMessage: {
        base64: 'dGVzdA==',
        mimetype: 'image/jpeg',
      },
    });

    expect(subject.eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'MEDIA_RECEIVED',
        aggregateId: 'media-file-id',
      }),
    );
    expect(subject.eventBus.publish).not.toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'COACH_ONBOARDING_TEXT_RECEIVED',
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        mediaFileId: 'media-file-id',
        processed: true,
      }),
    );
  });

  it('does not persist a message from an unknown phone number', async () => {
    const subject = createSubject({
      userFound: false,
    });

    const result = await process(subject.service, {
      conversation: 'Olá',
    });

    expect(result).toEqual({
      received: true,
      processed: false,
      reason: 'USER_NOT_FOUND',
    });
    expect(subject.messagesService.createInbound).not.toHaveBeenCalled();
  });

  it('rejects a malformed message event', async () => {
    const subject = createSubject();

    await expect(
      subject.service.handle(
        {
          event: 'messages.upsert',
          instance: 'singulfit',
          data: {
            message: {
              conversation: 'Sem chave',
            },
          },
        },
        'evolution-webhook-secret',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('ignores messages sent by the connected instance', async () => {
    const subject = createSubject();
    const payload = webhook({
      conversation: 'Mensagem enviada',
    });
    payload.data.key.fromMe = true;

    const result = await subject.service.processQueuedEntry(
      'singulfit',
      payload.data,
    );

    expect(result).toEqual({
      received: true,
      processed: false,
      reason: 'MESSAGE_IGNORED',
    });
    expect(subject.usersService.findByWhatsAppPhone).not.toHaveBeenCalled();
  });
});
