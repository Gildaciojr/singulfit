import { BadRequestException } from '@nestjs/common';
import { MediaType, MessageType, SubscriptionStatus } from '@prisma/client';
import { EventBusService } from '../event-bus/event-bus.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { MediaService } from '../storage/media.service';
import { UsersService } from '../users/users.service';
import { ConversationsService } from '../whatsapp/conversations.service';
import { MessagesService } from '../whatsapp/messages.service';
import { EvolutionGateway } from './evolution.gateway';
import { EvolutionWebhookService } from './evolution-webhook.service';
import { PrismaService } from '../prisma/prisma.service';

describe('EvolutionWebhookService', () => {
  function createSubject(options?: {
    userFound?: boolean;
    duplicated?: boolean;
    subscriptionStatus?: SubscriptionStatus;
    remoteConversationFound?: boolean;
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
    const conversationsService = {
      findActiveByRemoteJid: jest.fn().mockResolvedValue(
        options?.remoteConversationFound
          ? {
              id: 'conversation-id',
              phoneNumber: '+5511999999999',
              user: {
                id: 'user-id',
                phone: '11999999999',
                phoneE164: '+5511999999999',
              },
            }
          : null,
      ),
      linkRemoteJid: jest.fn().mockResolvedValue(undefined),
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
      conversationsService as unknown as ConversationsService,
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
      conversationsService,
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

  it('preserves the explicit WhatsApp reply id for proactive correlation', async () => {
    const subject = createSubject();

    await process(subject.service, {
      extendedTextMessage: {
        text: 'Consegui fazer tudo',
        contextInfo: { stanzaId: 'proactive-outbound-wa-id' },
      },
    });

    expect(subject.messagesService.createInbound).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'Consegui fazer tudo',
        replyToExternalMessageId: 'proactive-outbound-wa-id',
      }),
    );
  });

  it.each([
    { root: ' quote-id ', nested: undefined, expected: 'quote-id' },
    { root: ' quote-id ', nested: 'quote-id', expected: 'quote-id' },
    { root: 'quote-id', nested: 'other-id', expected: undefined },
    { root: ' ', nested: undefined, expected: undefined },
  ])(
    'resolves unique quote evidence and rejects conflicts: $root / $nested',
    async ({ root, nested, expected }) => {
      const subject = createSubject();
      const entry = {
        ...webhook({
          extendedTextMessage: {
            text: 'Pode.',
            contextInfo: { stanzaId: nested },
          },
        }).data,
        contextInfo: { stanzaId: root },
      };
      await subject.service.processQueuedEntry('singulfit', entry);
      expect(subject.messagesService.createInbound).toHaveBeenCalledWith(
        expect.objectContaining({ replyToExternalMessageId: expected }),
      );
    },
  );

  it('preserves the root contextInfo in the production-shaped LID fixture', async () => {
    const subject = createSubject({ remoteConversationFound: true });
    await subject.service.processQueuedEntry('singulfit', {
      key: {
        id: '2A5E02FB54CD7378280A',
        fromMe: false,
        remoteJid: 'fictional@lid',
        remoteJidAlt: '5511999999999@s.whatsapp.net',
        addressingMode: 'lid',
      },
      message: {
        conversation: 'Pode. Eu não tenho nenhuma alergia alimentar',
        messageContextInfo: {},
      },
      contextInfo: {
        stanzaId: '3EB0B10F3B298E1BB42633',
        quotedType: 0,
        participant: 'fictional@s.whatsapp.net',
        quotedMessage: {
          conversation: 'Só para confirmar: Não.. Posso salvar assim?',
        },
      },
      messageType: 'conversation',
      messageTimestamp: 1788720833,
    });
    expect(subject.messagesService.createInbound).toHaveBeenCalledWith(
      expect.objectContaining({
        replyToExternalMessageId: '3EB0B10F3B298E1BB42633',
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
          contextInfo: { stanzaId: ' media-quote-id ' },
        },
      });

      expect(subject.messagesService.createInbound).toHaveBeenCalledWith(
        expect.objectContaining({
          type,
          content: fallback,
          mediaUrl: 'https://media.example.com/file.enc',
          mimeType,
          fileSize: 4096,
          replyToExternalMessageId: 'media-quote-id',
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

  it.each([
    'ephemeralMessage',
    'viewOnceMessage',
    'viewOnceMessageV2',
    'documentWithCaptionMessage',
  ])(
    'preserves quote evidence through supported wrapper %s',
    async (wrapper) => {
      const subject = createSubject();
      await process(subject.service, {
        [wrapper]: {
          message: {
            extendedTextMessage: {
              text: 'Pode.',
              contextInfo: { stanzaId: ' wrapped-quote ' },
            },
          },
        },
      });
      expect(subject.messagesService.createInbound).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageType.TEXT,
          content: 'Pode.',
          replyToExternalMessageId: 'wrapped-quote',
        }),
      );
    },
  );

  it.each([
    undefined,
    {},
    { stanzaId: ' ' },
    { stanzaId: 123 },
    {
      quotedMessage: {
        conversation: 'Só para confirmar: Não.. Posso salvar assim?',
      },
    },
  ])(
    'does not invent quote identity from absent or invalid context %#',
    async (contextInfo) => {
      const subject = createSubject();
      await subject.service.processQueuedEntry('singulfit', {
        ...webhook({ conversation: 'Pode.' }).data,
        contextInfo,
      });
      expect(subject.messagesService.createInbound).toHaveBeenCalledWith(
        expect.objectContaining({ replyToExternalMessageId: undefined }),
      );
      expect(subject.messagesService.createInbound).toHaveBeenCalledTimes(1);
      expect(
        subject.conversationsService.findActiveByRemoteJid,
      ).toHaveBeenCalledTimes(1);
      expect(subject.usersService.findByWhatsAppPhone).toHaveBeenCalledTimes(1);
      expect(
        subject.subscriptionsService.getMessagingSubscription,
      ).toHaveBeenCalledTimes(1);
    },
  );

  it('fails closed on conflicting quote identities within nested sources', async () => {
    const subject = createSubject();
    await process(subject.service, {
      extendedTextMessage: {
        text: 'Pode.',
        contextInfo: { stanzaId: 'text-quote' },
      },
      imageMessage: { contextInfo: { stanzaId: 'image-quote' } },
    });
    expect(subject.messagesService.createInbound).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MessageType.TEXT,
        content: 'Pode.',
        replyToExternalMessageId: undefined,
      }),
    );
    expect(subject.mediaService.storeRemoteMedia).not.toHaveBeenCalled();
  });

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

  it('links an inbound LID-style remote JID through the saved conversation', async () => {
    const subject = createSubject({
      remoteConversationFound: true,
      userFound: false,
    });
    const payload = webhook({
      conversation: 'Oi',
    });
    payload.data.key.remoteJid = '556296552178@s.whatsapp.net';
    payload.data.addressingMode = 'lid';

    const result = await subject.service.processQueuedEntry(
      'singulfit',
      payload.data,
    );

    expect(result).toEqual(
      expect.objectContaining({
        received: true,
        processed: true,
        messageId: 'message-id',
        userId: 'user-id',
      }),
    );
    expect(subject.usersService.findByWhatsAppPhone).not.toHaveBeenCalled();
    expect(subject.messagesService.createInbound).toHaveBeenCalledWith(
      expect.objectContaining({
        phoneNumber: '+5511999999999',
        remoteJid: '556296552178@s.whatsapp.net',
      }),
    );
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
