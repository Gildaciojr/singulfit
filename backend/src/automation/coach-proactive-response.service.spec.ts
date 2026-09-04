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
    consumedByCurrent?: boolean;
    intent?: string;
    activeProfileAskedAt?: Date | null;
    name?: string | null;
  }) {
    const timestamp = new Date('2026-08-19T22:15:00.000Z');
    const message = {
      id: 'inbound-message-id',
      conversationId: 'conversation-id',
      content: options?.content ?? 'fiz tudo',
      timestamp,
      replyToExternalMessageId:
        options?.replyId === undefined ? 'outbound-wa-id' : options.replyId,
      conversation: {
        user: { name: options?.name === undefined ? null : options.name },
      },
    };
    const intervention = {
      id: 'intervention-id',
      scheduledFor: new Date('2026-08-19T22:00:00.000Z'),
      sentAt: new Date('2026-08-19T22:00:01.000Z'),
      responseExpiresAt: options?.expired
        ? new Date('2026-08-19T22:14:00.000Z')
        : new Date('2026-08-20T22:00:00.000Z'),
      responseMessageId: options?.consumedByCurrent
        ? 'inbound-message-id'
        : options?.consumed
          ? 'previous-message-id'
          : null,
      context: {
        source: 'COACH_PROACTIVE_V1',
        intent: options?.intent ?? 'WORKOUT_CHECK',
        slotKey: options?.intent ?? 'WORKOUT',
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
      coachProfileAcquisitionCycle: {
        findFirst: jest
          .fn()
          .mockResolvedValue(
            options?.activeProfileAskedAt
              ? { askedAt: options.activeProfileAskedAt }
              : null,
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
    ['sim', CoachProactiveWorkoutOutcome.COMPLETED],
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
    ['no matching intervention', { intervention: false }],
    ['expired intervention', { expired: true }],
    ['independent workout command', { content: 'troque o agachamento' }],
    ['unrelated numeric answer', { replyId: null, content: '1' }],
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

  it.each([
    ['HYDRATION_CHECK', 'já bati a meta', 'hidratação concluída'],
    ['HYDRATION_CHECK', 'ainda não', 'alguns goles'],
    ['HYDRATION_CHECK', 'bebi pouco hoje', 'pequenos goles'],
    ['LUNCH_CHECK', 'já almocei', 'almoço feito'],
    ['LUNCH_CHECK', 'sim', 'almoço feito'],
    ['LUNCH_CHECK', 'ainda não', 'priorize seu almoço'],
    ['DINNER_CHECK', 'já', 'jantar feito'],
    ['DINNER_CHECK', 'sim, jantei', 'jantar feito'],
    ['DINNER_CHECK', 'não jantei ainda', 'priorize seu jantar'],
    ['WORKOUT_CHECK', 'foi ótimo', 'Treino concluído'],
    ['WORKOUT_CHECK', 'não consegui treinar hoje', 'Sem culpa'],
    ['DAILY_CHECK_IN', 'estou bem', 'Que bom'],
    ['DAILY_CHECK_IN', 'estou cansado', 'respeitar seu ritmo'],
    ['GOOD_MORNING', 'bom dia', 'Que bom'],
    ['GOOD_MORNING', 'estou bem', 'Que bom'],
  ] as const)(
    'answers %s / %s with deterministic contextual language',
    async (intent, content, expected) => {
      const subject = createSubject({ replyId: null, intent, content });

      await subject.service.capture({
        userId: 'ordinary-user-id',
        messageId: 'inbound-message-id',
      });

      expect(
        subject.transaction.coachMessage.upsert.mock.calls[0][0].create.content,
      ).toContain(expected);
    },
  );

  it('does not infer a completed hydration goal from a generic confirmation', async () => {
    const subject = createSubject({
      replyId: null,
      intent: 'HYDRATION_CHECK',
      content: 'sim',
      name: 'Gildacio Junior',
    });

    await subject.service.capture({
      userId: 'ordinary-user-id',
      messageId: 'inbound-message-id',
    });

    const response = subject.transaction.coachMessage.upsert.mock.calls[0][0]
      .create.content as string;
    expect(response).toContain('Boa, Gildacio!');
    expect(response).toContain('hidratação distribuída');
    expect(response).not.toMatch(
      /meta (?:de hidratação )?concluída|bateu a meta/iu,
    );
    const memory =
      subject.transaction.conversationMemory.upsert.mock.calls[0][0].create;
    expect(memory.content.hydrationEvidence).toBe('WATER_CONSUMED');
    expect(memory.summary).toContain('sem confirmar');
    expect(memory.summary).not.toMatch(/meta .*concluída/iu);
    expect(
      subject.transaction.coachMessage.upsert.mock.calls[0][0].create.context,
    ).toEqual(expect.objectContaining({ hydrationEvidence: 'WATER_CONSUMED' }));
    expect(
      subject.transaction.scheduledMessage.upsert.mock.calls[0][0].create
        .context,
    ).toEqual(expect.objectContaining({ hydrationEvidence: 'WATER_CONSUMED' }));
    expect(subject.eventBus.publish.mock.calls[0][0].payload).toEqual(
      expect.objectContaining({ hydrationEvidence: 'WATER_CONSUMED' }),
    );
  });

  it('states hydration goal completion only from explicit goal evidence', async () => {
    const subject = createSubject({
      intent: 'HYDRATION_CHECK',
      content: 'já bati a meta',
    });

    await subject.service.capture({
      userId: 'ordinary-user-id',
      messageId: 'inbound-message-id',
    });

    expect(
      subject.transaction.coachMessage.upsert.mock.calls[0][0].create.content,
    ).toContain('Meta de hidratação concluída');
    expect(
      subject.transaction.conversationMemory.upsert.mock.calls[0][0].create
        .content,
    ).toEqual(expect.objectContaining({ hydrationEvidence: 'GOAL_COMPLETED' }));
    expect(
      subject.transaction.conversationMemory.upsert.mock.calls[0][0].create
        .summary,
    ).toContain('confirmou explicitamente');
  });

  it.each([
    ['bebi pouco hoje', CoachProactiveWorkoutOutcome.PARTIAL, 'pequenos goles'],
    ['ainda não', CoachProactiveWorkoutOutcome.SKIPPED, 'alguns goles'],
  ] as const)(
    'keeps hydration evidence %s distinct',
    async (content, outcome, expected) => {
      const subject = createSubject({
        intent: 'HYDRATION_CHECK',
        content,
        name: '   ',
      });

      await expect(
        subject.service.capture({
          userId: 'ordinary-user-id',
          messageId: 'inbound-message-id',
        }),
      ).resolves.toMatchObject({ outcome });
      expect(
        subject.transaction.coachMessage.upsert.mock.calls[0][0].create.content,
      ).toContain(expected);
    },
  );

  it.each(['sim', 'ainda não'])(
    'keeps MEAL_PLAN_CHECK general for %s',
    async (content) => {
      const subject = createSubject({
        intent: 'MEAL_PLAN_CHECK',
        content,
      });

      await subject.service.capture({
        userId: 'ordinary-user-id',
        messageId: 'inbound-message-id',
      });

      const response = subject.transaction.coachMessage.upsert.mock.calls[0][0]
        .create.content as string;
      expect(response).toContain('plano');
      expect(response).not.toMatch(/almoço feito|jantar feito/iu);
    },
  );

  it.each([
    ['MEAL_PLAN_CHECK', 'sim'],
    ['LUNCH_CHECK', 'sim'],
    ['DINNER_CHECK', 'sim'],
    ['WORKOUT_CHECK', 'sim'],
  ] as const)(
    'does not add hydration evidence to %s',
    async (intent, content) => {
      const subject = createSubject({ intent, content });

      await subject.service.capture({
        userId: 'ordinary-user-id',
        messageId: 'inbound-message-id',
      });

      expect(
        subject.transaction.conversationMemory.upsert.mock.calls[0][0].create
          .content,
      ).not.toHaveProperty('hydrationEvidence');
      expect(
        subject.transaction.coachMessage.upsert.mock.calls[0][0].create.context,
      ).not.toHaveProperty('hydrationEvidence');
      expect(
        subject.transaction.scheduledMessage.upsert.mock.calls[0][0].create
          .context,
      ).not.toHaveProperty('hydrationEvidence');
      expect(
        subject.eventBus.publish.mock.calls[0][0].payload,
      ).not.toHaveProperty('hydrationEvidence');
    },
  );

  it('lets a newer active profile question keep precedence over an unquoted proactive context', async () => {
    const subject = createSubject({
      replyId: null,
      content: 'sim',
      activeProfileAskedAt: new Date('2026-08-19T22:05:00.000Z'),
    });

    await expect(
      subject.service.capture({
        userId: 'ordinary-user-id',
        messageId: 'inbound-message-id',
      }),
    ).resolves.toEqual({ handled: false, duplicated: false, outcome: null });
  });

  it('gives an explicit quote precedence over a newer profile question', async () => {
    const subject = createSubject({
      content: 'sim',
      activeProfileAskedAt: new Date('2026-08-19T22:05:00.000Z'),
    });

    await expect(
      subject.service.capture({
        userId: 'ordinary-user-id',
        messageId: 'inbound-message-id',
      }),
    ).resolves.toMatchObject({ handled: true });
    expect(
      subject.prisma.coachProfileAcquisitionCycle.findFirst,
    ).not.toHaveBeenCalled();
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

  it('recognizes an unquoted replay as the same already-consumed response', async () => {
    const subject = createSubject({
      replyId: null,
      content: 'sim',
      consumedByCurrent: true,
    });

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
    expect(subject.transaction.coachMessage.upsert).not.toHaveBeenCalled();
    expect(subject.transaction.scheduledMessage.upsert).not.toHaveBeenCalled();
    expect(subject.eventBus.publish).not.toHaveBeenCalled();
  });

  it('requires matching user and conversation in the intervention query', async () => {
    const subject = createSubject();

    await subject.service.capture({
      userId: 'ordinary-user-id',
      messageId: 'inbound-message-id',
    });

    expect(subject.prisma.scheduledMessage.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 'ordinary-user-id',
          conversationId: 'conversation-id',
          externalMessageId: 'outbound-wa-id',
        }),
      }),
    );
  });
});
