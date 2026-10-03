import { PrismaService } from '../../prisma/prisma.service';
import { ConversationPlanReferenceService } from '../understanding/conversation-plan-reference.service';

describe('ConversationPlanReferenceService', () => {
  const at = new Date('2026-08-24T15:00:00Z');
  function setup() {
    const inbound = {
      id: 'message',
      timestamp: at,
      replyToExternalMessageId: null,
      conversation: { id: 'conversation', userId: 'user' },
    };
    const previous = {
      content: 'Pernas: Agachamento livre; Leg press',
      timestamp: new Date(at.getTime() - 1000),
      externalMessageId: 'previous',
      conversation: inbound.conversation,
    };
    const prisma = {
      message: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(inbound)
          .mockResolvedValueOnce(previous),
      },
      scheduledMessage: { findFirst: jest.fn().mockResolvedValue(null) },
      outboundMessage: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    return {
      inbound,
      previous,
      prisma,
      service: new ConversationPlanReferenceService(
        prisma as unknown as PrismaService,
      ),
      input: {
        userId: 'user',
        conversationId: 'conversation',
        messageId: 'message',
        referenceDate: at,
      },
    };
  }
  it('uses only the most recent assistant turn across canonical delivery stores', async () => {
    const s = setup();
    s.prisma.outboundMessage.findFirst.mockResolvedValue({
      userId: 'user',
      conversationId: 'conversation',
      content: 'Uma explicação geral sobre proteína',
      sentAt: new Date(at.getTime() - 500),
      externalMessageId: 'newer',
    });
    await expect(s.service.recentAssistant(s.input)).resolves.toBe(
      'Uma explicação geral sobre proteína',
    );
  });
  it('resolves a quoted delivered turn only by its exact external id', async () => {
    const s = setup();
    s.prisma.message.findFirst
      .mockReset()
      .mockResolvedValueOnce({
        ...s.inbound,
        replyToExternalMessageId: 'previous',
      })
      .mockResolvedValueOnce(s.previous);
    await expect(s.service.recentAssistant(s.input)).resolves.toBe(
      s.previous.content,
    );
    expect(s.prisma.outboundMessage.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 'user',
          conversationId: 'conversation',
          externalMessageId: 'previous',
        }),
      }),
    );
  });
  it.each(['foreign', 'future', 'stale', 'quote-mismatch'])(
    'rejects %s assistant references returned by mocks',
    async (failure) => {
      const s = setup();
      const row = {
        ...s.previous,
        ...(failure === 'foreign'
          ? { conversation: { id: 'conversation', userId: 'other' } }
          : {}),
        ...(failure === 'future'
          ? { timestamp: new Date(at.getTime() + 1) }
          : {}),
        ...(failure === 'stale'
          ? { timestamp: new Date(at.getTime() - 86400001) }
          : {}),
      };
      s.prisma.message.findFirst
        .mockReset()
        .mockResolvedValueOnce({
          ...s.inbound,
          ...(failure === 'quote-mismatch'
            ? { replyToExternalMessageId: 'different' }
            : {}),
        })
        .mockResolvedValueOnce(row);
      await expect(s.service.recentAssistant(s.input)).resolves.toBeNull();
    },
  );
  it('rejects conflicting turns at an identical timestamp', async () => {
    const s = setup();
    s.prisma.scheduledMessage.findFirst.mockResolvedValue({
      userId: 'user',
      conversationId: 'conversation',
      content: 'Outro treino',
      sentAt: s.previous.timestamp,
      externalMessageId: 'different',
    });
    await expect(s.service.recentAssistant(s.input)).resolves.toBeNull();
  });
  it('ignores assistant turns that precede the declaration being confirmed', async () => {
    const s = setup();
    await expect(
      s.service.recentAssistant({
        ...s.input,
        afterDate: new Date(at.getTime() - 1),
      }),
    ).resolves.toBeNull();
  });
  it('rejects foreign inbound ownership before reading history', async () => {
    const s = setup();
    s.prisma.message.findFirst.mockReset().mockResolvedValue({
      ...s.inbound,
      conversation: { id: 'conversation', userId: 'other' },
    });
    await expect(s.service.recentAssistant(s.input)).resolves.toBeNull();
    expect(s.prisma.outboundMessage.findFirst).not.toHaveBeenCalled();
  });
});
