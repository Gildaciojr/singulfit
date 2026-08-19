import { CoachProactiveWorkoutOutcome } from '@prisma/client';
import type { EventBusService } from '../event-bus/event-bus.service';
import type { PrismaService } from '../prisma/prisma.service';
import { CoachProactiveResponseService } from './coach-proactive-response.service';

describe('CoachProactiveResponseService', () => {
  function createSubject(options?: {
    replyId?: string | null;
    content?: string;
    intervention?: boolean;
    expired?: boolean;
    consumed?: boolean;
  }) {
    const timestamp = new Date('2026-08-19T22:15:00.000Z');
    const message = {
      id: 'inbound-message-id',
      conversationId: 'conversation-id',
      content: options?.content ?? 'fiz tudo',
      timestamp,
      replyToExternalMessageId:
        options?.replyId === undefined ? 'outbound-wa-id' : options.replyId,
    };
    const intervention = {
      id: 'intervention-id',
      responseExpiresAt: options?.expired
        ? new Date('2026-08-19T22:14:00.000Z')
        : new Date('2026-08-20T22:00:00.000Z'),
      responseMessageId: options?.consumed ? 'previous-message-id' : null,
      context: {
        source: 'COACH_PROACTIVE_V1',
        intent: 'WORKOUT_CHECK',
        slotKey: 'WORKOUT',
        workoutPlanId: 'plan-id',
        workoutSessionSequence: 2,
      },
    };
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([{ locked: true }]),
      scheduledMessage: {
        findUnique: jest.fn().mockResolvedValue(intervention),
        update: jest.fn().mockResolvedValue({}),
        upsert: jest.fn().mockResolvedValue({ id: 'response-scheduled-id' }),
      },
      conversationMemory: {
        upsert: jest.fn().mockResolvedValue({ id: 'memory-id' }),
      },
      coachMessage: {
        upsert: jest.fn().mockResolvedValue({ id: 'coach-message-id' }),
      },
      automationRule: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'daily-coach-rule-id',
          enabled: true,
        }),
      },
    };
    const prisma = {
      message: { findFirst: jest.fn().mockResolvedValue(message) },
      scheduledMessage: {
        findFirst: jest
          .fn()
          .mockResolvedValue(
            options?.intervention === false ? null : intervention,
          ),
      },
      $transaction: jest.fn(
        (operation: (client: typeof transaction) => unknown) =>
          operation(transaction),
      ),
    };
    const eventBus = {
      publish: jest.fn().mockResolvedValue({ id: 'outbox-id' }),
    };
    return {
      service: new CoachProactiveResponseService(
        prisma as unknown as PrismaService,
        eventBus as unknown as EventBusService,
      ),
      prisma,
      transaction,
      eventBus,
    };
  }

  it.each([
    ['fiz tudo', CoachProactiveWorkoutOutcome.COMPLETED],
    ['fiz só metade', CoachProactiveWorkoutOutcome.PARTIAL],
    ['não consegui treinar', CoachProactiveWorkoutOutcome.SKIPPED],
    ['vou fazer mais tarde', CoachProactiveWorkoutOutcome.DEFERRED],
    ['meu joelho doeu bastante', CoachProactiveWorkoutOutcome.ISSUE_REPORTED],
    ['sim', CoachProactiveWorkoutOutcome.UNKNOWN],
  ] as const)('persists %s as %s exactly once', async (content, outcome) => {
    const subject = createSubject({ content });

    await expect(
      subject.service.capture({
        userId: 'ordinary-user-id',
        messageId: 'inbound-message-id',
      }),
    ).resolves.toEqual({ handled: true, duplicated: false, outcome });
    expect(subject.transaction.$queryRaw).toHaveBeenCalledTimes(1);
    expect(subject.transaction.scheduledMessage.update).toHaveBeenCalledWith({
      where: { id: 'intervention-id' },
      data: {
        responseMessageId: 'inbound-message-id',
        responseOutcome: outcome,
        respondedAt: new Date('2026-08-19T22:15:00.000Z'),
      },
    });
    expect(subject.transaction.conversationMemory.upsert).toHaveBeenCalledTimes(
      1,
    );
    expect(subject.transaction.coachMessage.upsert).toHaveBeenCalledTimes(1);
    expect(subject.transaction.scheduledMessage.upsert).toHaveBeenCalledTimes(
      1,
    );
    expect(subject.eventBus.publish).toHaveBeenCalledTimes(1);
  });

  it('records an issue as safety context without diagnosing or completing', async () => {
    const subject = createSubject({ content: 'meu joelho doeu bastante' });

    await subject.service.capture({
      userId: 'ordinary-user-id',
      messageId: 'inbound-message-id',
    });

    const memory =
      subject.transaction.conversationMemory.upsert.mock.calls[0][0];
    expect(memory.create.content).toEqual(
      expect.objectContaining({
        outcome: CoachProactiveWorkoutOutcome.ISSUE_REPORTED,
        safetyIssue: true,
      }),
    );
    const response = subject.transaction.coachMessage.upsert.mock.calls[0][0]
      .create.content as string;
    expect(response).toContain('Evite movimentos');
    expect(response).not.toMatch(/diagn[oó]stico|les[aã]o confirmada/iu);
  });

  it.each([
    [
      '"sim" without an explicit proactive reply',
      { replyId: null, content: 'sim' },
    ],
    ['no matching intervention', { intervention: false }],
    ['expired intervention', { expired: true }],
    ['independent workout command', { content: 'troque o agachamento' }],
  ] as const)('does not steal %s', async (_name, options) => {
    const subject = createSubject(options);

    await expect(
      subject.service.capture({
        userId: 'ordinary-user-id',
        messageId: 'inbound-message-id',
      }),
    ).resolves.toEqual({ handled: false, duplicated: false, outcome: null });
    expect(subject.transaction.scheduledMessage.update).not.toHaveBeenCalled();
    expect(subject.eventBus.publish).not.toHaveBeenCalled();
  });

  it('fences a duplicate or concurrent consumption', async () => {
    const subject = createSubject({ consumed: true });

    await expect(
      subject.service.capture({
        userId: 'ordinary-user-id',
        messageId: 'inbound-message-id',
      }),
    ).resolves.toEqual({
      handled: true,
      duplicated: true,
      outcome: CoachProactiveWorkoutOutcome.COMPLETED,
    });
    expect(subject.transaction.scheduledMessage.update).not.toHaveBeenCalled();
    expect(
      subject.transaction.conversationMemory.upsert,
    ).not.toHaveBeenCalled();
    expect(subject.eventBus.publish).not.toHaveBeenCalled();
  });

  it('requires matching user and conversation in the intervention query', async () => {
    const subject = createSubject();

    await subject.service.capture({
      userId: 'ordinary-user-id',
      messageId: 'inbound-message-id',
    });

    expect(subject.prisma.scheduledMessage.findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({
        userId: 'ordinary-user-id',
        conversationId: 'conversation-id',
        externalMessageId: 'outbound-wa-id',
      }),
      select: expect.any(Object),
    });
  });
});
