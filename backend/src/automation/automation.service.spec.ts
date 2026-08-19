import { BadGatewayException, ForbiddenException } from '@nestjs/common';
import { ScheduledMessageStatus, SubscriptionStatus } from '@prisma/client';
import { EvolutionGateway } from '../evolution/evolution.gateway';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { SubscriptionAccessService } from '../subscriptions/subscription-access.service';
import { AUTOMATION_RULE_CODES } from './automation.constants';
import {
  AutomationService,
  COACH_PROACTIVE_MIN_GAP_MINUTES,
} from './automation.service';
import { CoachService } from './coach.service';
import { EventBusService } from '../event-bus/event-bus.service';
import { CoachIntelligenceService } from './coach-intelligence.service';
import { BehavioralIntelligenceService } from '../behavior/behavioral-intelligence.service';
import { CoachProactiveSchedulePolicy } from './coach-proactive-schedule.policy';

describe('AutomationService', () => {
  function createSubject(options?: {
    remindersEnabled?: boolean;
    workoutReminderEnabled?: boolean;
    gatewayFailure?: boolean;
    subscriptionStatus?: SubscriptionStatus | null;
    canSendCoachMessage?: boolean;
  }) {
    const preferences = {
      id: 'preferences-id',
      userId: 'user-id',
      remindersEnabled: options?.remindersEnabled ?? true,
      workoutReminderEnabled: options?.workoutReminderEnabled ?? true,
      mealReminderEnabled: true,
      hydrationReminderEnabled: true,
      progressReminderEnabled: true,
    };
    const rule = {
      id: 'rule-id',
      code: AUTOMATION_RULE_CODES.DAILY_WORKOUT,
      name: 'Treino do dia',
      enabled: true,
    };
    const scheduledMessage = {
      id: 'scheduled-id',
      userId: 'user-id',
      automationRuleId: rule.id,
      scheduledFor: new Date('2026-06-10T12:00:00.000Z'),
      status: ScheduledMessageStatus.PENDING,
      content: 'Treino personalizado',
      automationRule: rule,
    };
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([{ locked: true }]),
      conversation: {
        findFirst: jest.fn().mockResolvedValue({ id: 'conversation-id' }),
      },
      scheduledMessage: {
        upsert: jest.fn().mockResolvedValue(scheduledMessage),
        create: jest.fn().mockResolvedValue(scheduledMessage),
        findUnique: jest.fn().mockResolvedValue({
          ...scheduledMessage,
          user: {
            phone: '11999999999',
            phoneE164: '+5511999999999',
          },
        }),
        update: jest
          .fn()
          .mockImplementation(
            (args: { data: { status: ScheduledMessageStatus } }) =>
              Promise.resolve({
                ...scheduledMessage,
                status: args.data.status,
                user: {
                  phone: '11999999999',
                  phoneE164: '+5511999999999',
                },
              }),
          ),
      },
      coachMessage: {
        upsert: jest.fn().mockResolvedValue({
          id: 'coach-message-id',
          content: 'Mensagem proativa natural',
        }),
      },
      userAutomationPreference: {
        findUnique: jest.fn().mockResolvedValue(preferences),
      },
      subscription: {
        findFirst: jest.fn().mockResolvedValue(
          options?.subscriptionStatus === null
            ? null
            : {
                status:
                  options?.subscriptionStatus ?? SubscriptionStatus.ACTIVE,
              },
        ),
      },
    };
    const prisma = {
      user: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      habitSnapshot: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      coachMessage: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      churnRiskAssessment: {
        findUnique: jest.fn().mockResolvedValue({
          level: 'HIGH',
          daysInactive: 8,
        }),
      },
      userAutomationPreference: {
        upsert: jest.fn().mockResolvedValue(preferences),
      },
      automationRule: {
        findUnique: jest.fn().mockResolvedValue(rule),
        findMany: jest.fn().mockResolvedValue([rule]),
      },
      scheduledMessage: {
        count: jest.fn().mockResolvedValue(0),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        upsert: jest.fn().mockResolvedValue(scheduledMessage),
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest
          .fn()
          .mockResolvedValueOnce([scheduledMessage])
          .mockResolvedValue([]),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          ...scheduledMessage,
          status: ScheduledMessageStatus.SENT,
        }),
        findUnique: jest.fn().mockResolvedValue(null),
      },
      $transaction: jest.fn(
        (operation: (client: typeof transaction) => unknown) =>
          operation(transaction),
      ),
    };
    const subscriptionsService = {
      getProfileSubscription: jest.fn().mockResolvedValue({
        status: SubscriptionStatus.ACTIVE,
      }),
    };
    const coachService = {
      generateContent: jest.fn().mockResolvedValue('Treino personalizado'),
      generateProactiveContent: jest.fn().mockResolvedValue({
        content: 'Mensagem proativa natural',
        operationKey: 'proactive-operation-key',
        context: {
          workoutPlanId: 'workout-plan-id',
          workoutSessionSequence: 2,
          workoutSessionLabel: 'Costas e bíceps',
        },
      }),
      generateOnboardingKickoff: jest
        .fn()
        .mockResolvedValue('Mensagem premium inicial'),
    };
    const evolutionGateway = {
      sendText: options?.gatewayFailure
        ? jest
            .fn()
            .mockRejectedValue(
              new BadGatewayException('Evolution indisponível'),
            )
        : jest.fn().mockResolvedValue({
            externalMessageId: 'external-id',
          }),
    };
    const subscriptionAccessService = {
      requireAccess:
        options?.subscriptionStatus === null
          ? jest
              .fn()
              .mockRejectedValue(new ForbiddenException('Assinatura expirada'))
          : jest.fn().mockResolvedValue({
              status: options?.subscriptionStatus ?? SubscriptionStatus.ACTIVE,
            }),
      requireAccessInTransaction:
        options?.subscriptionStatus === null
          ? jest
              .fn()
              .mockRejectedValue(new ForbiddenException('Assinatura expirada'))
          : jest.fn().mockResolvedValue({
              status: options?.subscriptionStatus ?? SubscriptionStatus.ACTIVE,
            }),
    };
    const coachIntelligence = {
      recalculateUser: jest.fn().mockResolvedValue({}),
      getExperienceSignals: jest.fn().mockResolvedValue({
        whatsapp: {
          preferredHourUtc: null,
        },
        canSendCoachMessage: options?.canSendCoachMessage ?? true,
      }),
    };
    const behavioralIntelligence = {
      preferredScheduleHour: jest.fn().mockResolvedValue(9),
    };
    const eventBus = {
      publish: jest.fn().mockResolvedValue({ id: 'outbox-id' }),
    };
    const service = new AutomationService(
      prisma as unknown as PrismaService,
      subscriptionsService as unknown as SubscriptionsService,
      coachService as unknown as CoachService,
      evolutionGateway as unknown as EvolutionGateway,
      subscriptionAccessService as unknown as SubscriptionAccessService,
      eventBus as unknown as EventBusService,
      coachIntelligence as unknown as CoachIntelligenceService,
      behavioralIntelligence as unknown as BehavioralIntelligenceService,
      new CoachProactiveSchedulePolicy(),
    );

    return {
      service,
      prisma,
      transaction,
      subscriptionsService,
      coachService,
      evolutionGateway,
      subscriptionAccessService,
      coachIntelligence,
      behavioralIntelligence,
      eventBus,
      preferences,
      rule,
      scheduledMessage,
    };
  }

  it('creates default preferences on first read', async () => {
    const subject = createSubject();

    await expect(subject.service.getPreferences('user-id')).resolves.toBe(
      subject.preferences,
    );
    expect(subject.prisma.userAutomationPreference.upsert).toHaveBeenCalledWith(
      {
        where: {
          userId: 'user-id',
        },
        update: {},
        create: {
          userId: 'user-id',
        },
      },
    );
  });

  it('cancels pending workout messages when its preference is disabled', async () => {
    const subject = createSubject({
      workoutReminderEnabled: false,
    });

    await subject.service.updatePreferences('user-id', {
      workoutReminderEnabled: false,
    });

    expect(subject.prisma.scheduledMessage.updateMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-id',
        status: ScheduledMessageStatus.PENDING,
        automationRule: {
          code: {
            in: [AUTOMATION_RULE_CODES.DAILY_WORKOUT],
          },
        },
      },
      data: {
        status: ScheduledMessageStatus.CANCELED,
      },
    });
  });

  it('schedules personalized content idempotently', async () => {
    const subject = createSubject();
    const scheduledFor = new Date('2026-06-10T12:00:00.000Z');

    await expect(
      subject.service.scheduleMessage(
        'user-id',
        AUTOMATION_RULE_CODES.DAILY_WORKOUT,
        scheduledFor,
      ),
    ).resolves.toBe(subject.scheduledMessage);
    expect(subject.coachService.generateContent).toHaveBeenCalledWith(
      'user-id',
      AUTOMATION_RULE_CODES.DAILY_WORKOUT,
      scheduledFor,
    );
    expect(subject.transaction.scheduledMessage.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId_automationRuleId_scheduledFor: {
            userId: 'user-id',
            automationRuleId: 'rule-id',
            scheduledFor,
          },
        },
      }),
    );
  });

  it('schedules an onboarding kickoff through the existing automation outbox', async () => {
    const subject = createSubject();
    const scheduledFor = new Date('2026-06-10T12:00:00.000Z');

    await expect(
      subject.service.scheduleOnboardingKickoff('user-id', scheduledFor),
    ).resolves.toBe(subject.scheduledMessage);
    expect(
      subject.subscriptionsService.getProfileSubscription,
    ).toHaveBeenCalledWith('user-id');
    expect(subject.coachIntelligence.recalculateUser).toHaveBeenCalledWith(
      'user-id',
      scheduledFor,
    );
    expect(subject.coachService.generateOnboardingKickoff).toHaveBeenCalledWith(
      'user-id',
    );
    expect(subject.transaction.scheduledMessage.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          content: 'Mensagem premium inicial',
        }),
      }),
    );
    expect(subject.eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'AUTOMATION_TRIGGERED',
        aggregateType: 'SCHEDULED_MESSAGE',
        payload: expect.objectContaining({
          scheduledMessageId: 'scheduled-id',
          source: 'ONBOARDING_COMPLETED',
        }),
      }),
      subject.transaction,
    );
  });

  it('keeps onboarding kickoff scheduling available when coach recalculation lacks enough context', async () => {
    const subject = createSubject();
    subject.coachIntelligence.recalculateUser.mockRejectedValueOnce(
      new Error('Contexto insuficiente'),
    );

    await expect(
      subject.service.scheduleOnboardingKickoff(
        'user-id',
        new Date('2026-06-10T12:00:00.000Z'),
      ),
    ).resolves.toBe(subject.scheduledMessage);
    expect(subject.coachService.generateOnboardingKickoff).toHaveBeenCalled();
  });

  it('blocks scheduling when the user disabled the rule category', async () => {
    const subject = createSubject({
      workoutReminderEnabled: false,
    });

    await expect(
      subject.service.scheduleMessage(
        'user-id',
        AUTOMATION_RULE_CODES.DAILY_WORKOUT,
        new Date('2026-06-10T12:00:00.000Z'),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(subject.coachService.generateContent).not.toHaveBeenCalled();
  });

  it('sends a due message once under an advisory lock', async () => {
    const subject = createSubject();

    await expect(
      subject.service.sendScheduledMessage(
        'scheduled-id',
        new Date('2026-06-10T13:00:00.000Z'),
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        status: ScheduledMessageStatus.SENT,
      }),
    );
    expect(subject.transaction.$queryRaw).toHaveBeenCalled();
    expect(subject.evolutionGateway.sendText).toHaveBeenCalledWith({
      number: '+5511999999999',
      text: 'Treino personalizado',
    });
    expect(subject.prisma.scheduledMessage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'scheduled-id' }),
        data: expect.objectContaining({
          status: ScheduledMessageStatus.SENT,
          externalMessageId: 'external-id',
        }),
      }),
    );
  });

  it('persists a failed status when Evolution rejects the message', async () => {
    const subject = createSubject({
      gatewayFailure: true,
    });

    await expect(
      subject.service.sendScheduledMessage(
        'scheduled-id',
        new Date('2026-06-10T13:00:00.000Z'),
      ),
    ).rejects.toThrow('Evolution indisponível');
    expect(subject.prisma.scheduledMessage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: ScheduledMessageStatus.FAILED,
        }),
      }),
    );
  });

  it('cancels a due message when the subscription is no longer eligible', async () => {
    const subject = createSubject({
      subscriptionStatus: null,
    });

    await expect(
      subject.service.sendScheduledMessage(
        'scheduled-id',
        new Date('2026-06-10T13:00:00.000Z'),
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        status: ScheduledMessageStatus.CANCELED,
      }),
    );
    expect(subject.evolutionGateway.sendText).not.toHaveBeenCalled();
  });

  it('materializes contextual retention rules and sends through Evolution', async () => {
    const subject = createSubject();
    subject.prisma.user.findMany.mockResolvedValue([{ id: 'user-id' }]);
    subject.prisma.automationRule.findUnique.mockImplementation(
      ({ where }: { where: { code: string } }) =>
        Promise.resolve({
          ...subject.rule,
          code: where.code,
        }),
    );
    const at = new Date('2026-06-10T16:00:00.000Z');

    await subject.service.dispatchDue(at);

    expect(subject.coachIntelligence.recalculateUser).toHaveBeenCalledWith(
      'user-id',
      at,
    );
    expect(
      subject.behavioralIntelligence.preferredScheduleHour,
    ).toHaveBeenCalledWith('user-id', at);
    expect(subject.coachService.generateContent).toHaveBeenCalledWith(
      'user-id',
      AUTOMATION_RULE_CODES.DAILY_COACH,
      new Date('2026-06-10T09:00:00.000Z'),
    );
    expect(subject.coachService.generateContent).toHaveBeenCalledWith(
      'user-id',
      AUTOMATION_RULE_CODES.WEEKLY_REVIEW,
      new Date('2026-06-08T09:00:00.000Z'),
    );
    expect(subject.coachService.generateContent).toHaveBeenCalledWith(
      'user-id',
      AUTOMATION_RULE_CODES.MONTHLY_REVIEW,
      new Date('2026-06-01T09:00:00.000Z'),
    );
    expect(subject.coachService.generateContent).toHaveBeenCalledWith(
      'user-id',
      AUTOMATION_RULE_CODES.REENGAGEMENT,
      new Date('2026-06-10T09:00:00.000Z'),
    );
    expect(subject.evolutionGateway.sendText).toHaveBeenCalledTimes(1);
  });

  it('spaces daily coach and reengagement when message fatigue is active', async () => {
    const subject = createSubject({ canSendCoachMessage: false });
    subject.prisma.user.findMany.mockResolvedValue([{ id: 'user-id' }]);
    subject.prisma.automationRule.findUnique.mockImplementation(
      ({ where }: { where: { code: string } }) =>
        Promise.resolve({
          ...subject.rule,
          code: where.code,
        }),
    );

    await subject.service.dispatchDue(new Date('2026-06-10T16:00:00.000Z'));

    expect(subject.coachService.generateContent).not.toHaveBeenCalledWith(
      'user-id',
      AUTOMATION_RULE_CODES.DAILY_COACH,
      expect.any(Date),
    );
    expect(subject.coachService.generateContent).not.toHaveBeenCalledWith(
      'user-id',
      AUTOMATION_RULE_CODES.REENGAGEMENT,
      expect.any(Date),
    );
    expect(subject.coachService.generateContent).toHaveBeenCalledWith(
      'user-id',
      AUTOMATION_RULE_CODES.WEEKLY_REVIEW,
      expect.any(Date),
    );
  });

  it('materializes an exact proactive slot once and publishes one event without sending', async () => {
    const subject = createSubject();
    const automationPreference = subject.preferences;
    subject.prisma.user.findMany.mockResolvedValue([
      {
        id: 'user-id',
        preferences: { timezone: 'America/Sao_Paulo' },
        automationPreference,
      },
    ]);
    subject.prisma.scheduledMessage.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'scheduled-id' });
    subject.prisma.automationRule.findUnique.mockResolvedValue({
      ...subject.rule,
      code: AUTOMATION_RULE_CODES.HYDRATION_REMINDER,
    });
    const at = new Date('2026-08-18T13:00:00.000Z');

    await expect(subject.service.materializeDueMessages(at)).resolves.toEqual({
      scanned: 1,
      materialized: 1,
    });
    await expect(subject.service.materializeDueMessages(at)).resolves.toEqual({
      scanned: 1,
      materialized: 0,
    });

    expect(subject.coachService.generateProactiveContent).toHaveBeenCalledTimes(
      1,
    );
    expect(subject.eventBus.publish).toHaveBeenCalledTimes(1);
    expect(subject.eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'AUTOMATION_TRIGGERED',
        payload: expect.objectContaining({
          source: 'COACH_PROACTIVE_V1',
          intent: 'HYDRATION_CHECK',
          slotKey: 'HYDRATION_MORNING',
        }),
      }),
      subject.transaction,
    );
    expect(subject.transaction.coachMessage.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          context: expect.objectContaining({
            source: 'COACH_PROACTIVE_V1',
            workoutPlanId: 'workout-plan-id',
            workoutSessionSequence: 2,
          }),
        }),
      }),
    );
    expect(subject.transaction.scheduledMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          conversationId: 'conversation-id',
          coachMessageId: 'coach-message-id',
          responseExpiresAt: new Date('2026-08-19T13:30:00.000Z'),
          context: expect.objectContaining({
            source: 'COACH_PROACTIVE_V1',
            workoutPlanId: 'workout-plan-id',
          }),
        }),
      }),
    );
    expect(subject.evolutionGateway.sendText).not.toHaveBeenCalled();
    expect(
      subject.coachIntelligence.getExperienceSignals,
    ).not.toHaveBeenCalled();
  });

  it('enforces the daily cap before realization', async () => {
    const subject = createSubject();
    subject.prisma.user.findMany.mockResolvedValue([
      {
        id: 'user-id',
        preferences: { timezone: 'America/Sao_Paulo' },
        automationPreference: subject.preferences,
      },
    ]);
    subject.prisma.coachMessage.findMany.mockResolvedValue([
      { context: { source: 'COACH_PROACTIVE_V1' } },
      { context: { source: 'COACH_PROACTIVE_V1' } },
      { context: { source: 'COACH_PROACTIVE_V1' } },
    ]);

    await subject.service.materializeDueMessages(
      new Date('2026-08-18T13:00:00.000Z'),
    );

    expect(
      subject.coachService.generateProactiveContent,
    ).not.toHaveBeenCalled();
    expect(subject.eventBus.publish).not.toHaveBeenCalled();
  });

  it('does not persist or publish a workout slot without calendar evidence', async () => {
    const subject = createSubject();
    const scheduledFor = new Date('2026-08-18T22:00:00.000Z');
    subject.prisma.user.findMany.mockResolvedValue([
      {
        id: 'user-id',
        preferences: { timezone: 'America/Sao_Paulo' },
        automationPreference: subject.preferences,
      },
    ]);
    subject.coachService.generateProactiveContent.mockResolvedValueOnce(null);
    Reflect.set(subject.service, 'proactiveSchedule', {
      materializableSlots: jest.fn().mockReturnValue([
        {
          intent: 'WORKOUT_CHECK',
          slotKey: 'WORKOUT',
          ruleCode: AUTOMATION_RULE_CODES.DAILY_WORKOUT,
          scheduledFor,
          localTime: '19:00',
        },
      ]),
      localDayRange: jest.fn().mockReturnValue({
        start: new Date('2026-08-18T03:00:00.000Z'),
        end: new Date('2026-08-19T03:00:00.000Z'),
      }),
    });

    await expect(
      subject.service.materializeDueMessages(scheduledFor),
    ).resolves.toEqual({ scanned: 1, materialized: 0 });
    expect(subject.transaction.coachMessage.upsert).not.toHaveBeenCalled();
    expect(subject.transaction.scheduledMessage.create).not.toHaveBeenCalled();
    expect(subject.eventBus.publish).not.toHaveBeenCalled();
  });

  it.each([
    [
      'lunch, hydration and workout',
      [
        [
          'LUNCH_CHECK',
          'LUNCH',
          '2026-08-18T15:45:00.000Z',
          AUTOMATION_RULE_CODES.MEAL_REMINDER,
        ],
        [
          'HYDRATION_CHECK',
          'HYDRATION_AFTERNOON',
          '2026-08-18T18:45:00.000Z',
          AUTOMATION_RULE_CODES.HYDRATION_REMINDER,
        ],
        [
          'WORKOUT_CHECK',
          'WORKOUT',
          '2026-08-18T22:00:00.000Z',
          AUTOMATION_RULE_CODES.DAILY_WORKOUT,
        ],
      ],
      3,
    ],
    [
      'two hydration slots',
      [
        [
          'HYDRATION_CHECK',
          'HYDRATION_MORNING',
          '2026-08-18T13:30:00.000Z',
          AUTOMATION_RULE_CODES.HYDRATION_REMINDER,
        ],
        [
          'HYDRATION_CHECK',
          'HYDRATION_AFTERNOON',
          '2026-08-18T18:30:00.000Z',
          AUTOMATION_RULE_CODES.HYDRATION_REMINDER,
        ],
      ],
      2,
    ],
  ] as const)(
    'allows %s with exact-slot dedupe',
    async (_name, definitions, expectedCount) => {
      const subject = createSubject();
      subject.prisma.user.findMany.mockResolvedValue([
        {
          id: 'user-id',
          preferences: { timezone: 'America/Sao_Paulo' },
          automationPreference: subject.preferences,
        },
      ]);
      subject.prisma.automationRule.findUnique.mockImplementation(
        ({ where }: { where: { code: string } }) =>
          Promise.resolve({ ...subject.rule, code: where.code }),
      );
      const slots = definitions.map(
        ([intent, slotKey, scheduledFor, ruleCode]) => ({
          intent,
          slotKey,
          ruleCode,
          scheduledFor: new Date(scheduledFor),
          localTime: '12:00',
        }),
      );
      Reflect.set(subject.service, 'proactiveSchedule', {
        materializableSlots: jest.fn().mockReturnValue(slots),
        localDayRange: jest.fn().mockReturnValue({
          start: new Date('2026-08-18T03:00:00.000Z'),
          end: new Date('2026-08-19T03:00:00.000Z'),
        }),
      });

      await expect(
        subject.service.materializeDueMessages(
          new Date('2026-08-18T15:00:00.000Z'),
        ),
      ).resolves.toEqual({ scanned: 1, materialized: expectedCount });

      expect(subject.transaction.scheduledMessage.create).toHaveBeenCalledTimes(
        expectedCount,
      );
      expect(subject.eventBus.publish).toHaveBeenCalledTimes(expectedCount);
    },
  );

  it.each([
    ['master', { remindersEnabled: false }],
    ['hydration', { hydrationReminderEnabled: false }],
  ] as const)(
    'honors the %s proactive preference gate',
    async (_name, override) => {
      const subject = createSubject();
      subject.prisma.user.findMany.mockResolvedValue([
        {
          id: 'user-id',
          preferences: { timezone: 'America/Sao_Paulo' },
          automationPreference: { ...subject.preferences, ...override },
        },
      ]);

      await subject.service.materializeDueMessages(
        new Date('2026-08-18T13:00:00.000Z'),
      );

      expect(
        subject.coachService.generateProactiveContent,
      ).not.toHaveBeenCalled();
      expect(subject.eventBus.publish).not.toHaveBeenCalled();
    },
  );

  it('paginates eligible users without repeatedly scanning the first batch', async () => {
    const subject = createSubject({ canSendCoachMessage: false });
    const users = Array.from({ length: 100 }, (_, index) => ({
      id: `user-${String(index).padStart(3, '0')}`,
      preferences: { timezone: 'America/Sao_Paulo' },
      automationPreference: subject.preferences,
    }));
    subject.prisma.user.findMany
      .mockResolvedValueOnce(users)
      .mockResolvedValueOnce([]);
    Reflect.set(subject.service, 'proactiveSchedule', {
      materializableSlots: jest.fn().mockReturnValue([]),
      localDayRange: jest.fn().mockReturnValue({
        start: new Date('2026-08-18T03:00:00.000Z'),
        end: new Date('2026-08-19T03:00:00.000Z'),
      }),
    });

    await expect(
      subject.service.materializeDueMessages(
        new Date('2026-08-18T13:00:00.000Z'),
      ),
    ).resolves.toEqual({ scanned: 100, materialized: 0 });

    expect(subject.prisma.user.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        cursor: { id: 'user-099' },
        skip: 1,
      }),
    );
    expect(
      subject.coachIntelligence.getExperienceSignals,
    ).not.toHaveBeenCalled();
  });

  it('ignores a recent reactive outbound for proactive cooldown ownership', async () => {
    const subject = createSubject();
    subject.prisma.user.findMany.mockResolvedValue([
      {
        id: 'user-id',
        preferences: { timezone: 'America/Sao_Paulo' },
        automationPreference: subject.preferences,
      },
    ]);
    subject.prisma.coachMessage.findMany.mockResolvedValue([
      {
        context: { source: 'WHATSAPP_COACH_COMMAND' },
        scheduledFor: new Date('2026-08-18T13:00:00.000Z'),
      },
    ]);

    await expect(
      subject.service.materializeDueMessages(
        new Date('2026-08-18T13:00:00.000Z'),
      ),
    ).resolves.toEqual({ scanned: 1, materialized: 1 });
  });

  it('blocks a proactive contact 179 minutes after the previous proactive', async () => {
    const subject = createSubject();
    subject.prisma.user.findMany.mockResolvedValue([
      {
        id: 'user-id',
        preferences: { timezone: 'America/Sao_Paulo' },
        automationPreference: subject.preferences,
      },
    ]);
    subject.prisma.coachMessage.findMany.mockResolvedValue([
      {
        context: { source: 'COACH_PROACTIVE_V1' },
        scheduledFor: new Date('2026-08-18T10:31:00.000Z'),
      },
    ]);

    await expect(
      subject.service.materializeDueMessages(
        new Date('2026-08-18T13:00:00.000Z'),
      ),
    ).resolves.toEqual({ scanned: 1, materialized: 0 });
    expect(
      subject.coachService.generateProactiveContent,
    ).not.toHaveBeenCalled();
  });

  it('allows a proactive contact at the exact 180-minute boundary', async () => {
    const subject = createSubject();
    subject.prisma.user.findMany.mockResolvedValue([
      {
        id: 'user-id',
        preferences: { timezone: 'America/Sao_Paulo' },
        automationPreference: subject.preferences,
      },
    ]);
    subject.prisma.coachMessage.findMany.mockResolvedValue([
      {
        context: { source: 'COACH_PROACTIVE_V1' },
        scheduledFor: new Date('2026-08-18T10:30:00.000Z'),
      },
    ]);

    await expect(
      subject.service.materializeDueMessages(
        new Date('2026-08-18T13:00:00.000Z'),
      ),
    ).resolves.toEqual({ scanned: 1, materialized: 1 });
    expect(COACH_PROACTIVE_MIN_GAP_MINUTES).toBe(180);
  });

  it('does not materialize proactive outreach without entitlement', async () => {
    const subject = createSubject({ subscriptionStatus: null });
    subject.prisma.user.findMany.mockResolvedValue([
      {
        id: 'user-id',
        preferences: { timezone: 'America/Sao_Paulo' },
        automationPreference: subject.preferences,
      },
    ]);

    await expect(
      subject.service.materializeDueMessages(
        new Date('2026-08-18T13:00:00.000Z'),
      ),
    ).resolves.toEqual({ scanned: 1, materialized: 0 });
    expect(
      subject.coachService.generateProactiveContent,
    ).not.toHaveBeenCalled();
  });
});
