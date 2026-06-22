import { MessageDirection, MessageType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ConversationsService } from './conversations.service';
import { MessagesService } from './messages.service';

describe('MessagesService', () => {
  it('persists a message and updates the conversation timestamp atomically', async () => {
    const createdAt = new Date('2026-06-06T20:00:00.000Z');
    const message = {
      id: 'message-id',
      conversationId: 'conversation-id',
      direction: MessageDirection.OUTBOUND,
      type: MessageType.SYSTEM,
      content: 'Assinatura ativada.',
      externalMessageId: 'internal-message-id',
      deliveredAt: null,
      readAt: null,
      createdAt,
    };
    const transaction = {
      message: {
        create: jest.fn().mockResolvedValue(message),
      },
      conversation: {
        update: jest.fn().mockResolvedValue(undefined),
      },
    };
    const prisma = {
      message: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      $transaction: jest.fn(
        (operation: (currentTransaction: typeof transaction) => unknown) =>
          operation(transaction),
      ),
    };
    const conversationsService = {
      getOrCreateActive: jest.fn().mockResolvedValue({
        id: 'conversation-id',
        startedAt: new Date('2026-06-06T20:30:00.000Z'),
      }),
    };
    const service = new MessagesService(
      prisma as unknown as PrismaService,
      conversationsService as unknown as ConversationsService,
    );

    const result = await service.createInternal({
      userId: '8bfd40c8-6c80-4e37-a450-d1b22cf0c401',
      direction: MessageDirection.OUTBOUND,
      type: MessageType.SYSTEM,
      content: ' Assinatura ativada. ',
      externalMessageId: 'internal-message-id',
    });

    expect(result).toBe(message);
    expect(transaction.message.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        conversationId: 'conversation-id',
        content: 'Assinatura ativada.',
      }),
    });
    expect(transaction.conversation.update).toHaveBeenCalledWith({
      where: {
        id: 'conversation-id',
      },
      data: {
        lastMessageAt: createdAt,
      },
    });
  });

  it('returns an existing message for an idempotent external ID', async () => {
    const existingMessage = {
      id: 'message-id',
      conversationId: 'conversation-id',
      direction: MessageDirection.INBOUND,
      type: MessageType.TEXT,
      content: 'Olá',
    };
    const prisma = {
      message: {
        findUnique: jest.fn().mockResolvedValue(existingMessage),
      },
      $transaction: jest.fn(),
    };
    const conversationsService = {
      getOrCreateActive: jest.fn().mockResolvedValue({
        id: 'conversation-id',
        startedAt: new Date('2026-06-06T20:30:00.000Z'),
      }),
    };
    const service = new MessagesService(
      prisma as unknown as PrismaService,
      conversationsService as unknown as ConversationsService,
    );

    const result = await service.createInternal({
      userId: '8bfd40c8-6c80-4e37-a450-d1b22cf0c401',
      direction: MessageDirection.INBOUND,
      type: MessageType.TEXT,
      content: 'Olá',
      externalMessageId: 'external-message-id',
    });

    expect(result).toBe(existingMessage);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('persists inbound media metadata and updates the conversation timestamp', async () => {
    const timestamp = new Date('2026-06-06T21:00:00.000Z');
    const message = {
      id: 'evolution-message-id',
      conversationId: 'conversation-id',
      direction: MessageDirection.INBOUND,
      type: MessageType.IMAGE,
      content: 'Meu almoço',
      instanceName: 'singulfit',
      externalMessageId: 'wamid-image',
      remoteJid: '5511999999999@s.whatsapp.net',
      timestamp,
      mediaUrl: 'https://media.example.com/image.enc',
      mimeType: 'image/jpeg',
      fileSize: 2048,
      deliveredAt: null,
      readAt: null,
      createdAt: timestamp,
    };
    const transaction = {
      message: {
        create: jest.fn().mockResolvedValue(message),
      },
      conversation: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const prisma = {
      message: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      $transaction: jest.fn(
        (operation: (currentTransaction: typeof transaction) => unknown) =>
          operation(transaction),
      ),
    };
    const conversationsService = {
      getOrCreateActive: jest.fn().mockResolvedValue({
        id: 'conversation-id',
        startedAt: new Date('2026-06-06T20:30:00.000Z'),
      }),
    };
    const service = new MessagesService(
      prisma as unknown as PrismaService,
      conversationsService as unknown as ConversationsService,
    );

    const result = await service.createInbound({
      userId: 'user-id',
      subscriptionId: 'subscription-id',
      phoneNumber: '+5511999999999',
      instanceName: 'singulfit',
      externalMessageId: 'wamid-image',
      type: MessageType.IMAGE,
      content: 'Meu almoço',
      remoteJid: '5511999999999@s.whatsapp.net',
      timestamp,
      mediaUrl: 'https://media.example.com/image.enc',
      mimeType: 'image/jpeg',
      fileSize: 2048,
    });

    expect(result).toEqual({
      message,
      duplicated: false,
    });
    expect(transaction.message.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        instanceName: 'singulfit',
        externalMessageId: 'wamid-image',
        mediaUrl: 'https://media.example.com/image.enc',
        mimeType: 'image/jpeg',
        fileSize: 2048,
      }),
    });
    expect(transaction.conversation.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'conversation-id',
        OR: [{ lastMessageAt: null }, { lastMessageAt: { lt: timestamp } }],
      },
      data: {
        lastMessageAt: timestamp,
      },
    });
  });
});
