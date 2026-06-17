import { BadGatewayException, ForbiddenException } from '@nestjs/common';
import { ScheduledMessageStatus, SubscriptionStatus } from '@prisma/client';
import { EvolutionGateway } from '../evolution/evolution.gateway';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { SubscriptionAccessService } from '../subscriptions/subscription-access.service';
import { AUTOMATION_RULE_CODES } from './automation.constants';
import { AutomationService } from './automation.service';
import { CoachService } from './coach.service';
import { EventBusService } from '../event-bus/event-bus.service';
import { CoachIntelligenceService } from './coach-intelligence.service';
import { BehavioralIntelligenceService } from '../behavior/behavioral-intelligence.service';

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
      scheduledMessage: {
        upsert: jest.fn().mockResolvedValue(scheduledMessage),
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
    const service = new AutomationService(
      prisma as unknown as PrismaService,
      subscriptionsService as unknown as SubscriptionsService,
      coachService as unknown as CoachService,
      evolutionGateway as unknown as EvolutionGateway,
      subscriptionAccessService as unknown as SubscriptionAccessService,
      {
        publish: jest.fn().mockResolvedValue({ id: 'outbox-id' }),
      } as unknown as EventBusService,
      coachIntelligence as unknown as CoachIntelligenceService,
      behavioralIntelligence as unknown as BehavioralIntelligenceService,
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
});
