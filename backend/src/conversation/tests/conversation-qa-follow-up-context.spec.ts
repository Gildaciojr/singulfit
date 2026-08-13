import {
  AIJobStatus,
  AIJobType,
  MessageDirection,
  MessageType,
  ScheduledMessageStatus,
} from '@prisma/client';
import { ConversationQAFollowUpContextService } from '../runtime/conversation-qa-follow-up-context.service';
import { ConversationPublicAnswerBoundaryService } from '../runtime/conversation-public-answer-boundary.service';

describe('ConversationQAFollowUpContextService', () => {
  const previousTimestamp = new Date('2026-08-13T12:00:00.000Z');
  const currentTimestamp = new Date('2026-08-13T12:01:00.000Z');
  const previousAnswer =
    '🍚 No almoço, seu plano tem *arroz branco cozido: 3 xícaras cozidas*.';
  const previousFollowUpQuestion = 'Quer que eu converta isso para gramas?';
  const officialContent = `${previousAnswer}\n\n${previousFollowUpQuestion}`;
  const input = {
    userId: 'user-id',
    conversationId: 'conversation-id',
    messageId: 'current-message-id',
  };

  function subject(
    options: {
      current?: { timestamp: Date } | null;
      tiedInbound?: { id: string } | null;
      previous?: { id: string; timestamp: Date } | null;
      jobFound?: boolean;
      jobResult?: unknown;
      coachContent?: string | null;
      sent?: boolean;
    } = {},
  ) {
    const message = {
      findFirst: jest
        .fn()
        .mockResolvedValueOnce(
          options.current === undefined
            ? { timestamp: currentTimestamp }
            : options.current,
        )
        .mockResolvedValueOnce(
          options.tiedInbound === undefined ? null : options.tiedInbound,
        )
        .mockResolvedValueOnce(
          options.previous === undefined
            ? { id: 'previous-message-id', timestamp: previousTimestamp }
            : options.previous,
        ),
    };
    const prisma = {
      message,
      aIJob: {
        findFirst: jest.fn().mockResolvedValue(
          options.jobFound === false
            ? null
            : {
                result:
                  options.jobResult === undefined
                    ? {
                        answer: previousAnswer,
                        followUpQuestion: previousFollowUpQuestion,
                      }
                    : options.jobResult,
              },
        ),
      },
      coachMessage: {
        findUnique: jest
          .fn()
          .mockResolvedValue(
            options.coachContent === null
              ? null
              : { content: options.coachContent ?? officialContent },
          ),
      },
      scheduledMessage: {
        findFirst: jest
          .fn()
          .mockResolvedValue(options.sent === false ? null : { id: 'sent-id' }),
      },
    };
    return {
      service: new ConversationQAFollowUpContextService(
        prisma as never,
        new ConversationPublicAnswerBoundaryService(),
      ),
      prisma,
    };
  }

  it('recovers the immediately previous officially sent Q&A without an OUTBOUND Message', async () => {
    const target = subject();

    await expect(target.service.findPending(input)).resolves.toEqual({
      sourceMessageId: 'previous-message-id',
      previousAnswer,
      previousFollowUpQuestion,
    });
    expect(target.prisma.message.findFirst).toHaveBeenNthCalledWith(1, {
      where: {
        id: 'current-message-id',
        conversationId: 'conversation-id',
        conversation: { userId: 'user-id' },
        direction: MessageDirection.INBOUND,
        type: MessageType.TEXT,
      },
      select: { timestamp: true },
    });
    expect(target.prisma.message.findFirst).toHaveBeenNthCalledWith(2, {
      where: {
        id: { not: 'current-message-id' },
        conversationId: 'conversation-id',
        conversation: { userId: 'user-id' },
        direction: MessageDirection.INBOUND,
        type: MessageType.TEXT,
        timestamp: currentTimestamp,
      },
      select: { id: true },
    });
    expect(target.prisma.message.findFirst).toHaveBeenNthCalledWith(3, {
      where: {
        conversationId: 'conversation-id',
        conversation: { userId: 'user-id' },
        direction: MessageDirection.INBOUND,
        type: MessageType.TEXT,
        timestamp: { lt: currentTimestamp },
      },
      select: { id: true, timestamp: true },
      orderBy: [{ timestamp: 'desc' }, { createdAt: 'desc' }],
    });
    expect(target.prisma.aIJob.findFirst).toHaveBeenCalledWith({
      where: {
        userId: 'user-id',
        conversationId: 'conversation-id',
        messageId: 'previous-message-id',
        type: AIJobType.TEXT,
        status: AIJobStatus.COMPLETED,
        completedAt: { lt: currentTimestamp },
        promptVersion: { name: 'coach_conversational_qa_v1', version: 2 },
      },
      select: { result: true },
      orderBy: [{ completedAt: 'desc' }, { createdAt: 'desc' }],
    });
    expect(target.prisma.coachMessage.findUnique).toHaveBeenCalledWith({
      where: {
        idempotencyKey: 'user-id:WHATSAPP_COACH_COMMAND:previous-message-id',
      },
      select: { content: true },
    });
    expect(target.prisma.scheduledMessage.findFirst).toHaveBeenCalledWith({
      where: {
        userId: 'user-id',
        status: ScheduledMessageStatus.SENT,
        content: officialContent,
        scheduledFor: { gte: previousTimestamp, lt: currentTimestamp },
      },
      select: { id: true },
      orderBy: [{ scheduledFor: 'desc' }, { createdAt: 'desc' }],
    });
  });

  it.each([
    [
      'balanced bold',
      '🍚 **Arroz branco**: 3 xícaras',
      '🍚 *Arroz branco*: 3 xícaras',
    ],
    ['heading', '## Arroz branco: 3 xícaras', 'Arroz branco: 3 xícaras'],
    [
      'Markdown link',
      '[Arroz branco](https://example.com): 3 xícaras',
      'Arroz branco: 3 xícaras',
    ],
  ] as const)(
    'matches materialized CoachMessage through shared %s projection',
    async (_label, rawAnswer, projectedAnswer) => {
      const target = subject({
        jobResult: {
          answer: rawAnswer,
          followUpQuestion: previousFollowUpQuestion,
        },
        coachContent: `${projectedAnswer}\n\n${previousFollowUpQuestion}`,
      });

      await expect(target.service.findPending(input)).resolves.toEqual({
        sourceMessageId: 'previous-message-id',
        previousAnswer: projectedAnswer,
        previousFollowUpQuestion,
      });
    },
  );

  it.each([
    [
      'unsafe answer',
      {
        answer: 'Orientação canônica: arroz = 3 xícaras.',
        followUpQuestion: previousFollowUpQuestion,
      },
    ],
    [
      'unsafe follow-up',
      {
        answer: previousAnswer,
        followUpQuestion: 'Quer ver o grounding interno?',
      },
    ],
  ] as const)('fails closed for %s', async (_label, jobResult) => {
    const target = subject({ jobResult });

    await expect(target.service.findPending(input)).resolves.toBeNull();
    expect(target.prisma.scheduledMessage.findFirst).not.toHaveBeenCalled();
  });

  it('fails closed when another inbound has the current timestamp', async () => {
    const target = subject({ tiedInbound: { id: 'ambiguous-message-id' } });

    await expect(target.service.findPending(input)).resolves.toBeNull();
    expect(target.prisma.aIJob.findFirst).not.toHaveBeenCalled();
  });

  it.each([
    ['other user', { ...input, userId: 'other-user' }],
    ['other conversation', { ...input, conversationId: 'other-conversation' }],
  ] as const)('scopes lookup to the %s', async (_label, scopedInput) => {
    const target = subject({ current: null });

    await expect(target.service.findPending(scopedInput)).resolves.toBeNull();
    expect(target.prisma.aIJob.findFirst).not.toHaveBeenCalled();
  });

  it('cannot use a current or later Q&A job', async () => {
    const target = subject({ jobFound: false });

    await expect(target.service.findPending(input)).resolves.toBeNull();
    expect(target.prisma.coachMessage.findUnique).not.toHaveBeenCalled();
  });

  it('rejects a stale follow-up when an intermediate inbound has no Q&A job', async () => {
    const target = subject({ jobResult: null });

    await expect(target.service.findPending(input)).resolves.toBeNull();
    expect(target.prisma.coachMessage.findUnique).not.toHaveBeenCalled();
  });

  it.each([null, {}, { followUpQuestion: null }, { followUpQuestion: '' }])(
    'rejects an invalid prompt/job result: %p',
    async (jobResult) => {
      const target = subject({ jobResult });

      await expect(target.service.findPending(input)).resolves.toBeNull();
    },
  );

  it.each([
    ['missing CoachMessage', { coachContent: null }],
    ['mismatched official content', { coachContent: 'Outra resposta.' }],
    ['unsent ScheduledMessage', { sent: false }],
  ] as const)(
    'requires real official materialization: %s',
    async (_label, options) => {
      await expect(
        subject(options).service.findPending(input),
      ).resolves.toBeNull();
    },
  );
});
