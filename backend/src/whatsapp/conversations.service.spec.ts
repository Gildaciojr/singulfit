import { ConversationStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ConversationsService } from './conversations.service';

describe('ConversationsService', () => {
  it('creates an active conversation with an E.164 phone number', async () => {
    const createdConversation = {
      id: 'conversation-id',
      userId: 'user-id',
      phoneNumber: '+5511999999999',
      status: ConversationStatus.ACTIVE,
    };
    const prisma = {
      conversation: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(createdConversation),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'user-id',
          phone: '(11) 99999-9999',
        }),
      },
    };
    const service = new ConversationsService(
      prisma as unknown as PrismaService,
    );

    const conversation = await service.getOrCreateActive('user-id');

    expect(conversation).toBe(createdConversation);
    expect(prisma.conversation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          userId: 'user-id',
          subscriptionId: undefined,
          phoneNumber: '+5511999999999',
          remoteJid: undefined,
        },
      }),
    );
  });
});
