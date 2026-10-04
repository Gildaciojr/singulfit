import {
  CoachProfileAcquisitionCycleStatus,
  CoachProactiveWorkoutOutcome,
} from '@prisma/client';
import type { EventBusService } from '../event-bus/event-bus.service';
import type { PrismaService } from '../prisma/prisma.service';
import { CoachProactiveResponseService } from './coach-proactive-response.service';

describe('CoachProactiveResponseService', () => {
  it.each(['bom dia', 'oi', 'beleza', 'tudo certo', 'foi ótimo', 'estou bem'])(
    'does not conclude a workout from evidence-free reply %s',
    async (content) => {
      const s = createSubject({
        replyId: null,
        intent: 'WORKOUT_CHECK',
        content,
      });
      await expect(
        s.service.capture({
          userId: 'user-id',
          messageId: 'inbound-message-id',
        }),
      ).resolves.toMatchObject({ handled: false, outcome: null });
      expect(s.transaction.scheduledMessage.update).not.toHaveBeenCalled();
    },
  );
  it.each(['inbound', 'intervention'] as const)(
    'rejects foreign %s before reminder mutation or outcome',
    async (source) => {
      const s = createSubject();
      if (source === 'inbound')
        s.prisma.message.findFirst.mockResolvedValue({
          id: 'inbound-message-id',
          conversationId: 'conversation-id',
          content: 'fiz tudo',
          timestamp: new Date('2026-08-19T22:15:00Z'),
          conversation: { userId: 'user-b', user: { name: null } },
        });
      else
        s.prisma.scheduledMessage.findFirst.mockResolvedValue({
          id: 'foreign',
          userId: 'user-b',
          conversationId: 'conversation-id',
        });
      await expect(
        s.service.capture({
          userId: 'ordinary-user-id',
          messageId: 'inbound-message-id',
        }),
      ).resolves.toMatchObject({ handled: false });
      expect(s.transaction.scheduledMessage.upsert).not.toHaveBeenCalled();
      expect(s.eventBus.publish).not.toHaveBeenCalled();
    },
  );
  it.each([
    ['HYDRATION_CHECK', 'sim, já bebi água', 'COMPLETED'],
    ['HYDRATION_CHECK', 'já bebi 1 litro', 'COMPLETED'],
    ['HYDRATION_CHECK', 'acho que tomei uns 900ml', 'COMPLETED'],
    ['HYDRATION_CHECK', 'ainda bebi pouca água', 'PARTIAL'],
    ['HYDRATION_CHECK', 'acabei de encher minha garrafa', 'DEFERRED'],
    ['LUNCH_CHECK', 'já almocei', 'COMPLETED'],
    ['LUNCH_CHECK', 'ainda não, vou almoçar mais tarde', 'DEFERRED'],
    ['LUNCH_CHECK', 'almocei arroz, feijão e frango', 'COMPLETED'],
    ['DINNER_CHECK', 'já jantei', 'COMPLETED'],
    ['DINNER_CHECK', 'ainda não jantei', 'SKIPPED'],
    ['DINNER_CHECK', 'jantei frango com arroz', 'COMPLETED'],
    ['WORKOUT_CHECK', 'já treinei', 'COMPLETED'],
    ['WORKOUT_CHECK', 'não consegui treinar hoje', 'SKIPPED'],
    ['WORKOUT_CHECK', 'treinei mas senti dor no joelho', 'ISSUE_REPORTED'],
    ['GOOD_MORNING', 'estou bem', 'COMPLETED'],
    ['GOOD_MORNING', 'Sim, já tomei café da manhã.', 'COMPLETED'],
    ['GOOD_MORNING', 'acordei cansada hoje', 'PARTIAL'],
    ['DAILY_CHECK_IN', 'hoje está corrido', 'PARTIAL'],
    ['MEAL_PLAN_CHECK', 'sim, segui o plano', 'COMPLETED'],
  ] as const)(
    'handles natural %s reply: %s',
    async (intent, content, outcome) => {
      const subject = createSubject({ intent, content });
      await expect(
        subject.service.capture({
          userId: 'ordinary-user-id',
          messageId: 'inbound-message-id',
        }),
      ).resolves.toMatchObject({ handled: true, outcome });
      expect(subject.transaction.scheduledMessage.upsert).toHaveBeenCalledTimes(
        1,
      );
      expect(subject.eventBus.publish).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    'Hoje minha rotina virou de cabeça para baixo',
    'Monte meu jantar de hoje',
    'Monte um treino para academia 5 vezes na semana',
  ])('preserves a reminder context for modern runtime: %s', async (content) => {
    const subject = createSubject({ intent: 'HYDRATION_CHECK', content });
    await expect(
      subject.service.capture({
        userId: 'ordinary-user-id',
        messageId: 'inbound-message-id',
      }),
    ).resolves.toMatchObject({ handled: false, continueInRuntime: true });
    expect(subject.transaction.scheduledMessage.upsert).not.toHaveBeenCalled();
  });

  it.each(['outbound', 'scheduled'] as const)(
    'fences unquoted ambiguous replies after a newer %s turn',
    async (kind) => {
      const subject = createSubject({ replyId: null, content: 'sim' });
      if (kind === 'outbound')
        subject.prisma.outboundMessage.findFirst.mockResolvedValue({
          id: 'newer-id',
        });
      else
        subject.prisma.scheduledMessage.findFirst.mockResolvedValueOnce({
          id: 'intervention-id',
          sentAt: new Date('2026-08-19T22:00:00Z'),
          scheduledFor: new Date('2026-08-19T22:00:00Z'),
          responseExpiresAt: new Date('2026-08-20T22:00:00Z'),
          responseMessageId: null,
          context: {
            source: 'COACH_PROACTIVE_V1',
            intent: 'HYDRATION_CHECK',
          },
        });
      if (kind === 'scheduled')
        subject.prisma.scheduledMessage.findMany.mockResolvedValue([
          { id: 'newer-id', context: {} },
        ]);
      await expect(
        subject.service.capture({
          userId: 'ordinary-user-id',
          messageId: 'inbound-message-id',
        }),
      ).resolves.toMatchObject({ handled: false });
      expect(
        subject.transaction.scheduledMessage.upsert,
      ).not.toHaveBeenCalled();
    },
  );

  function createSubject(options?: {
    replyId?: string | null;
    content?: string;
    intervention?: boolean;
    expired?: boolean;
    consumed?: boolean;
    consumedByCurrent?: boolean;
    intent?: string;
    activeProfileAskedAt?: Date | null;
    activeProfileStatus?: CoachProfileAcquisitionCycleStatus;
    name?: string | null;
    outcome?: CoachProactiveWorkoutOutcome;
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
        userId: 'ordinary-user-id',
        user: { name: options?.name === undefined ? null : options.name },
      },
    };
    const intervention = {
      id: 'intervention-id',
      userId: 'ordinary-user-id',
      conversationId: 'conversation-id',
      userId: 'ordinary-user-id',
      conversationId: 'conversation-id',
      content: 'Você conseguiu concluir o que combinamos?',
      scheduledFor: new Date(
        options?.expired
          ? '2026-08-18T22:00:00.000Z'
          : '2026-08-19T22:00:00.000Z',
      ),
      sentAt: new Date(
        options?.expired
          ? '2026-08-18T22:00:01.000Z'
          : '2026-08-19T22:00:01.000Z',
      ),
      responseOutcome:
        options?.outcome ??
        (options?.consumed || options?.consumedByCurrent
          ? CoachProactiveWorkoutOutcome.COMPLETED
          : null),
      respondedAt: options?.consumed ? new Date('2026-08-19T22:05:00Z') : null,
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
        findUnique: jest.fn().mockResolvedValue(null),
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
      outboundMessage: { findFirst: jest.fn().mockResolvedValue(null) },
      scheduledMessage: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest
          .fn()
          .mockImplementation((query: { where: { id?: unknown } }) =>
            Promise.resolve(
              query.where.id
                ? null
                : options?.intervention === false
                  ? null
                  : intervention,
            ),
          ),
      },
      coachProfileAcquisitionCycle: {
        findFirst: jest.fn().mockResolvedValue(
          options?.activeProfileAskedAt
            ? {
                id: 'active-cycle-id',
                status:
                  options.activeProfileStatus ??
                  CoachProfileAcquisitionCycleStatus.ASKED,
              }
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
      message,
      intervention,
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
    ['WORKOUT_CHECK', 'já fiz', 'COMPLETED'],
    ['WORKOUT_CHECK', 'feito', 'COMPLETED'],
    ['WORKOUT_CHECK', 'já pensei nisso', 'UNKNOWN'],
    ['WORKOUT_CHECK', 'já queria', 'UNKNOWN'],
    ['WORKOUT_CHECK', 'já estava vendo', 'UNKNOWN'],
    ['WORKOUT_CHECK', 'não deu', 'SKIPPED'],
    ['WORKOUT_CHECK', 'não', 'SKIPPED'],
    ['WORKOUT_CHECK', 'faço mais tarde', 'DEFERRED'],
    ['LUNCH_CHECK', 'já comi', 'COMPLETED'],
    ['LUNCH_CHECK', 'comi outra coisa', 'PARTIAL'],
    ['LUNCH_CHECK', 'não comi', 'SKIPPED'],
  ] as const)(
    'classifies P0 %s / %s as %s',
    async (intent, content, outcome) => {
      const s = createSubject({ intent, content });
      expect(
        await s.service.capture({
          userId: 'ordinary-user-id',
          messageId: s.message.id,
        }),
      ).toMatchObject({ handled: true, outcome });
    },
  );
  it('keeps a quoted negative reminder answer with its reminder even with active acquisition', async () => {
    const s = createSubject({
      intent: 'WORKOUT_CHECK',
      content: 'não',
      activeProfileAskedAt: new Date('2026-08-19T22:10:00Z'),
    });
    await expect(
      s.service.capture({
        userId: 'ordinary-user-id',
        messageId: s.message.id,
      }),
    ).resolves.toMatchObject({ handled: true, outcome: 'SKIPPED' });
  });
  it.each(['ok', 'sim', 'não'])(
    'does not infer completion from ambiguous %s',
    async (content) => {
      const s = createSubject({ content });
      s.intervention.content = 'Hora do seu treino.';
      expect(
        await s.service.capture({
          userId: 'ordinary-user-id',
          messageId: s.message.id,
        }),
      ).toMatchObject({ outcome: 'UNKNOWN' });
    },
  );
  it.each(['já fiz', 'não consegui'])(
    'allows DEFERRED to evolve for %s once per inbound',
    async (content) => {
      const s = createSubject({ content, consumed: true, outcome: 'DEFERRED' });
      s.transaction.scheduledMessage.update.mockImplementation(
        (args: {
          data: {
            responseMessageId: string;
            responseOutcome: CoachProactiveWorkoutOutcome;
            respondedAt: Date;
          };
        }) => {
          Object.assign(s.intervention, args.data);
          return Promise.resolve({});
        },
      );
      const first = await s.service.capture({
        userId: 'ordinary-user-id',
        messageId: s.message.id,
      });
      expect(first).toMatchObject({
        duplicated: false,
        outcome: content === 'já fiz' ? 'COMPLETED' : 'SKIPPED',
      });
      expect(
        await s.service.capture({
          userId: 'ordinary-user-id',
          messageId: s.message.id,
        }),
      ).toMatchObject({ duplicated: true });
      expect(s.transaction.conversationMemory.upsert).toHaveBeenCalledTimes(1);
      expect(s.eventBus.publish).toHaveBeenCalledTimes(1);
    },
  );
  it('allows UNKNOWN to evolve but fences terminal results and old replays', async () => {
    const s = createSubject({
      content: 'fiz só metade',
      consumed: true,
      outcome: 'UNKNOWN',
    });
    expect(
      await s.service.capture({
        userId: 'ordinary-user-id',
        messageId: s.message.id,
      }),
    ).toMatchObject({ outcome: 'PARTIAL', duplicated: false });
    s.intervention.responseOutcome = 'PARTIAL';
    expect(
      await s.service.capture({
        userId: 'ordinary-user-id',
        messageId: s.message.id,
      }),
    ).toMatchObject({ duplicated: true, outcome: 'PARTIAL' });
    expect(s.transaction.conversationMemory.upsert).toHaveBeenCalledTimes(1);
  });
  it('uses actual send time for delayed reminders and fences expiry after 24 hours', async () => {
    const s = createSubject({ content: 'já fiz' });
    s.intervention.scheduledFor = new Date('2026-08-18T20:00:00Z');
    s.intervention.responseExpiresAt = new Date('2026-08-19T20:00:00Z');
    expect(
      await s.service.capture({
        userId: 'ordinary-user-id',
        messageId: s.message.id,
      }),
    ).toMatchObject({ handled: true });
    s.message.timestamp = new Date('2026-08-20T22:00:02Z');
    expect(
      await s.service.capture({
        userId: 'ordinary-user-id',
        messageId: s.message.id,
      }),
    ).toMatchObject({ handled: false });
    expect(s.transaction.scheduledMessage.update).toHaveBeenCalledTimes(1);
  });
  it('serializes competing terminal replies to a deferred intervention', async () => {
    const s = createSubject({ consumed: true, outcome: 'DEFERRED' });
    s.prisma.message.findFirst.mockImplementation(
      (args: { where: { id: string } }) =>
        Promise.resolve({
          ...s.message,
          id: args.where.id,
          content: args.where.id === 'first' ? 'já fiz' : 'não consegui',
        }),
    );
    let queue: Promise<unknown> = Promise.resolve();
    s.prisma.$transaction.mockImplementation(
      (operation: (client: typeof s.transaction) => unknown) => {
        const result = queue.then(() => operation(s.transaction));
        queue = result.then(() => undefined);
        return result;
      },
    );
    s.transaction.scheduledMessage.update.mockImplementation(
      (args: {
        data: {
          responseMessageId: string;
          responseOutcome: CoachProactiveWorkoutOutcome;
          respondedAt: Date;
        };
      }) => {
        Object.assign(s.intervention, args.data);
        return Promise.resolve({});
      },
    );
    const results = await Promise.all(
      ['first', 'second'].map((messageId) =>
        s.service.capture({ userId: 'ordinary-user-id', messageId }),
      ),
    );
    expect(results.filter((result) => !result.duplicated)).toHaveLength(1);
    expect(s.intervention.responseOutcome).toBe('COMPLETED');
    expect(s.transaction.scheduledMessage.update).toHaveBeenCalledTimes(1);
    expect(s.transaction.conversationMemory.upsert).toHaveBeenCalledTimes(1);
    expect(s.eventBus.publish).toHaveBeenCalledTimes(1);
  });
  it('allows an unquoted completion after the intervention own deferred acknowledgment', async () => {
    const s = createSubject({
      replyId: null,
      consumed: true,
      outcome: 'DEFERRED',
      content: 'já fiz',
    });
    s.prisma.scheduledMessage.findMany.mockResolvedValue([
      {
        id: 'ack',
        context: {
          source: 'COACH_PROACTIVE_RESPONSE_V1',
          interventionId: s.intervention.id,
        },
      },
    ]);
    expect(
      await s.service.capture({
        userId: 'ordinary-user-id',
        messageId: s.message.id,
      }),
    ).toMatchObject({ duplicated: false, outcome: 'COMPLETED' });
    s.prisma.scheduledMessage.findMany.mockResolvedValue([
      { id: 'other', context: {} },
    ]);
    expect(
      await s.service.capture({
        userId: 'ordinary-user-id',
        messageId: s.message.id,
      }),
    ).toMatchObject({ handled: false });
    expect(s.transaction.conversationMemory.upsert).toHaveBeenCalledTimes(1);
  });

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
    ).resolves.toEqual({
      handled: false,
      duplicated: false,
      outcome: null,
      ...('content' in options ? { continueInRuntime: true } : {}),
    });
    expect(subject.transaction.scheduledMessage.update).not.toHaveBeenCalled();
    expect(subject.eventBus.publish).not.toHaveBeenCalled();
  });

  it.each([
    ['HYDRATION_CHECK', 'já bati a meta', 'hidratação concluída'],
    ['HYDRATION_CHECK', 'ainda não', 'alguns goles'],
    ['HYDRATION_CHECK', 'bebi pouco hoje', 'pequenos goles'],
    ['LUNCH_CHECK', 'já almocei', 'almoço feito'],
    ['LUNCH_CHECK', 'sim', 'almoço feito'],
    ['LUNCH_CHECK', 'ainda não', 'não fez o almoço'],
    ['DINNER_CHECK', 'já', 'registrar corretamente'],
    ['DINNER_CHECK', 'sim, jantei', 'jantar feito'],
    ['DINNER_CHECK', 'não jantei ainda', 'não fez o jantar'],
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
    ['LUNCH_CHECK', 'comi outra coisa', 'PARTIAL', 'almoço foi diferente'],
    ['DINNER_CHECK', 'comi outra coisa', 'PARTIAL', 'jantar foi diferente'],
    [
      'MEAL_PLAN_CHECK',
      'comi outra coisa',
      'PARTIAL',
      'alimentação foi diferente',
    ],
    ['LUNCH_CHECK', 'vou comer depois', 'DEFERRED', 'almoço depois'],
    ['DINNER_CHECK', 'vou jantar depois', 'DEFERRED', 'jantar depois'],
    ['MEAL_PLAN_CHECK', 'vou comer depois', 'DEFERRED', 'vai comer depois'],
    ['LUNCH_CHECK', 'não comi', 'SKIPPED', 'não fez o almoço'],
    ['DINNER_CHECK', 'não jantei', 'SKIPPED', 'não fez o jantar'],
    ['MEAL_PLAN_CHECK', 'não comi', 'SKIPPED', 'não seguiu o plano'],
    ['LUNCH_CHECK', 'já almocei', 'COMPLETED', 'almoço feito'],
    ['DINNER_CHECK', 'já jantei', 'COMPLETED', 'jantar feito'],
    ['MEAL_PLAN_CHECK', 'segui o plano', 'COMPLETED', 'Continue seguindo'],
    ['LUNCH_CHECK', 'ok', 'UNKNOWN', 'registrar corretamente'],
    ['DAILY_CHECK_IN', 'não consegui', 'SKIPPED', 'não foi possível'],
    ['GOOD_MORNING', 'vou fazer depois', 'DEFERRED', 'retomar mais tarde'],
    ['HYDRATION_CHECK', 'vou beber depois', 'DEFERRED', 'retome a hidratação'],
    [
      'WORKOUT_CHECK',
      'meu joelho está doendo',
      'ISSUE_REPORTED',
      'Evite movimentos',
    ],
  ] as const)(
    'preserves public state semantics for %s / %s',
    async (intent, content, outcome, expected) => {
      const s = createSubject({ intent, content });
      expect(
        await s.service.capture({
          userId: 'ordinary-user-id',
          messageId: 'inbound-message-id',
        }),
      ).toMatchObject({ outcome });
      const response: string =
        s.transaction.coachMessage.upsert.mock.calls[0][0].create.content;
      expect(response).toContain(expected);
      expect(response).not.toMatch(
        /\b(?:V2|pipeline|schema|provider|runtime|canonical|canônico|rollout|internal|persistence)\b|\d+\s*(?:kcal|calorias|g de proteína)/iu,
      );
      expect((response.match(/\?/gu) ?? []).length).toBeLessThanOrEqual(1);
      if (outcome === 'PARTIAL' || outcome === 'SKIPPED')
        expect(response).not.toMatch(
          /Quando conseguir parar|priorize seu|vai fazer .* depois/iu,
        );
      if (outcome !== 'COMPLETED') expect(response).not.toContain('Que bom!');
    },
  );
  it('does not acknowledge a meal when its persistence transaction fails', async () => {
    const s = createSubject({
      intent: 'LUNCH_CHECK',
      content: 'comi outra coisa',
    });
    s.transaction.scheduledMessage.update.mockRejectedValue(
      new Error('database unavailable'),
    );
    await expect(
      s.service.capture({
        userId: 'ordinary-user-id',
        messageId: 'inbound-message-id',
      }),
    ).rejects.toThrow('database unavailable');
    expect(s.transaction.coachMessage.upsert).not.toHaveBeenCalled();
    expect(s.eventBus.publish).not.toHaveBeenCalled();
  });

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

  it('lets an active profile question keep precedence over a newer unquoted proactive context', async () => {
    const subject = createSubject({
      replyId: null,
      content: 'sim',
      activeProfileAskedAt: new Date('2026-08-19T21:13:00.000Z'),
    });

    await expect(
      subject.service.capture({
        userId: 'ordinary-user-id',
        messageId: 'inbound-message-id',
      }),
    ).resolves.toEqual({ handled: false, duplicated: false, outcome: null });
    expect(subject.transaction.scheduledMessage.upsert).not.toHaveBeenCalled();
  });

  it('does not classify an unquoted confirmation response while profile acquisition is active', async () => {
    const subject = createSubject({
      replyId: null,
      content: 'sim',
      activeProfileAskedAt: new Date('2026-08-19T21:13:00.000Z'),
      activeProfileStatus:
        CoachProfileAcquisitionCycleStatus.CONFIRMATION_PENDING,
    });

    await expect(
      subject.service.capture({
        userId: 'ordinary-user-id',
        messageId: 'inbound-message-id',
      }),
    ).resolves.toEqual({ handled: false, duplicated: false, outcome: null });
    expect(subject.transaction.scheduledMessage.update).not.toHaveBeenCalled();
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
