import {
  ActivationDeliveryStatus,
  ActivationRiskLevel,
  ActivationStage,
} from '@prisma/client';
import { EvolutionGateway } from '../evolution/evolution.gateway';
import { EventService } from '../observability/event.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConversationsService } from '../whatsapp/conversations.service';
import { ActivationJourneyService } from './activation-journey.service';
import { ActivationOnboardingService } from './activation-onboarding.service';
import { ActivationScoreService } from './activation-score.service';
import { ActivationService } from './activation.service';

describe('ActivationJourneyService', () => {
  function subject() {
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([{ locked: true }]),
      activationEvent: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({ id: 'event-id' }),
      },
    };
    const prisma = {
      user: {
        findUniqueOrThrow: jest.fn(),
      },
      subscription: {
        findFirst: jest.fn(),
      },
      activationEvent: {
        findUnique: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null),
        upsert: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $transaction: jest.fn(
        (operation: (client: typeof transaction) => unknown) =>
          operation(transaction),
      ),
    };
    const evolution = {
      sendText: jest.fn().mockResolvedValue({
        externalMessageId: 'evolution-message-id',
      }),
    };
    const conversations = {
      getOrCreateActive: jest.fn().mockResolvedValue({ id: 'conversation-id' }),
      linkRemoteJid: jest.fn().mockResolvedValue(undefined),
    };
    const events = {
      record: jest.fn().mockResolvedValue({ id: 'system-event-id' }),
    };
    const onboarding = {
      start: jest.fn().mockResolvedValue({ id: 'onboarding-id' }),
    };
    const activationService = {
      reconcile: jest.fn(),
      abandon: jest.fn(),
      snapshot: jest.fn().mockResolvedValue({ id: 'snapshot-id' }),
    };
    const service = new ActivationJourneyService(
      prisma as unknown as PrismaService,
      activationService as unknown as ActivationService,
      new ActivationScoreService(),
      conversations as unknown as ConversationsService,
      evolution as unknown as EvolutionGateway,
      events as unknown as EventService,
      onboarding as unknown as ActivationOnboardingService,
    );
    const testable = service as unknown as {
      dueRecovery(
        activation: {
          id: string;
          currentStage: ActivationStage;
          lastProgressAt: Date;
        },
        at: Date,
      ): Promise<number | null>;
      claimDelivery(eventId: string, at: Date): Promise<boolean>;
      dueFlow(
        activation: { id: string; paidAt: Date | null },
        at: Date,
      ): Promise<number | null>;
      sendMessage(
        activationId: string,
        userId: string,
        kind: 'FLOW_MESSAGE' | 'RECOVERY_MESSAGE',
        eventCode: string,
        idempotencyKey: string,
        scheduledFor: Date,
        at: Date,
      ): Promise<void>;
    };

    return {
      service,
      testable,
      prisma,
      transaction,
      evolution,
      conversations,
      events,
      onboarding,
      activationService,
    };
  }

  it('selects the latest due D+ flow and retries an expired lease', async () => {
    const setup = subject();
    setup.prisma.activationEvent.findUnique.mockImplementation(
      ({ where }: { where: { idempotencyKey: string } }) =>
        Promise.resolve(
          where.idempotencyKey.endsWith(':D3')
            ? {
                deliveryStatus: ActivationDeliveryStatus.SENDING,
                leaseExpiresAt: new Date('2026-06-04T11:59:00.000Z'),
              }
            : {
                deliveryStatus: ActivationDeliveryStatus.SENT,
                leaseExpiresAt: null,
              },
        ),
    );

    await expect(
      setup.testable.dueFlow(
        {
          id: 'activation-id',
          paidAt: new Date('2026-06-01T12:00:00.000Z'),
        },
        new Date('2026-06-04T12:00:00.000Z'),
      ),
    ).resolves.toBe(3);
  });

  it('selects D0 before any later due flow message', async () => {
    const setup = subject();
    setup.prisma.activationEvent.findUnique.mockImplementation(
      ({ where }: { where: { idempotencyKey: string } }) =>
        Promise.resolve(
          where.idempotencyKey.endsWith(':D0')
            ? null
            : {
                deliveryStatus: ActivationDeliveryStatus.SENT,
                leaseExpiresAt: null,
              },
        ),
    );

    await expect(
      setup.testable.dueFlow(
        {
          id: 'activation-id',
          paidAt: new Date('2026-06-01T12:00:00.000Z'),
        },
        new Date('2026-06-04T12:00:00.000Z'),
      ),
    ).resolves.toBe(0);
  });

  it('does not select D0 or later flow messages while D0 has an active lease', async () => {
    const setup = subject();
    setup.prisma.activationEvent.findUnique.mockResolvedValue({
      deliveryStatus: ActivationDeliveryStatus.SENDING,
      leaseExpiresAt: new Date('2026-06-04T12:01:00.000Z'),
    });

    await expect(
      setup.testable.dueFlow(
        {
          id: 'activation-id',
          paidAt: new Date('2026-06-01T12:00:00.000Z'),
        },
        new Date('2026-06-04T12:00:00.000Z'),
      ),
    ).resolves.toBeNull();
  });
  it('selects the highest due recovery milestone exactly once', async () => {
    const setup = subject();
    setup.prisma.activationEvent.findUnique.mockResolvedValue(null);

    await expect(
      setup.testable.dueRecovery(
        {
          id: 'activation-id',
          currentStage: ActivationStage.FIRST_MESSAGE_SENT,
          lastProgressAt: new Date('2026-06-01T00:00:00.000Z'),
        },
        new Date('2026-06-08T01:00:00.000Z'),
      ),
    ).resolves.toBe(168);

    setup.prisma.activationEvent.findUnique.mockImplementation(
      ({ where }: { where: { idempotencyKey: string } }) =>
        Promise.resolve(
          where.idempotencyKey.endsWith(':168')
            ? { id: 'existing-event' }
            : null,
        ),
    );
    await expect(
      setup.testable.dueRecovery(
        {
          id: 'activation-id',
          currentStage: ActivationStage.FIRST_MESSAGE_SENT,
          lastProgressAt: new Date('2026-06-01T00:00:00.000Z'),
        },
        new Date('2026-06-08T01:00:00.000Z'),
      ),
    ).resolves.toBe(72);
  });

  it('does not claim a delivery with an active concurrent lease', async () => {
    const setup = subject();
    setup.transaction.activationEvent.findUnique.mockResolvedValue({
      id: 'event-id',
      deliveryStatus: ActivationDeliveryStatus.SENDING,
      leaseExpiresAt: new Date('2026-06-14T12:01:00.000Z'),
    });

    await expect(
      setup.testable.claimDelivery(
        'event-id',
        new Date('2026-06-14T12:00:00.000Z'),
      ),
    ).resolves.toBe(false);
    expect(setup.transaction.$queryRaw).toHaveBeenCalled();
    expect(setup.transaction.activationEvent.update).not.toHaveBeenCalled();
  });

  it('persists a personalized D0 delivery through Evolution', async () => {
    const setup = subject();
    setup.prisma.user.findUniqueOrThrow.mockResolvedValue({
      name: 'Ana Silva',
      phone: '11999999999',
      phoneE164: '+5511999999999',
      activation: {
        currentStage: ActivationStage.WHATSAPP_CONNECTED,
        score: 20,
        riskLevel: ActivationRiskLevel.LOW,
      },
      behavioralProfile: {
        communicationStyle: 'DIRECT',
        motivationStyle: 'ACHIEVEMENT',
      },
      goalClassification: {
        goal: 'WEIGHT_LOSS',
      },
      contextSnapshots: [
        {
          goal: 'WEIGHT_LOSS',
          messagesLast7Days: 0,
          nutritionAnalysesCount: 0,
        },
      ],
      recommendations: [
        {
          title: 'Registre a refeição',
          description: 'Envie uma foto da próxima refeição.',
        },
      ],
      coachProfile: {
        coachingStyle: 'ACCOUNTABILITY',
        tone: 'DIRECT',
      },
    });
    setup.prisma.activationEvent.upsert.mockResolvedValue({
      id: 'event-id',
    });
    setup.transaction.activationEvent.findUnique.mockResolvedValue({
      id: 'event-id',
      deliveryStatus: ActivationDeliveryStatus.PENDING,
      leaseExpiresAt: null,
    });
    setup.evolution.sendText.mockResolvedValue({
      externalMessageId: 'evolution-message-id',
      remoteJid: '5511999999999@s.whatsapp.net',
    });

    await setup.testable.sendMessage(
      'activation-id',
      'user-id',
      'FLOW_MESSAGE',
      'D0',
      'activation-id:flow:D0',
      new Date('2026-06-14T12:00:00.000Z'),
      new Date('2026-06-14T12:00:00.000Z'),
    );

    expect(setup.evolution.sendText).toHaveBeenCalledWith({
      number: '+5511999999999',
      text: expect.stringContaining('Ana'),
    });
    expect(setup.conversations.linkRemoteJid).toHaveBeenCalledWith(
      'user-id',
      '5511999999999@s.whatsapp.net',
    );
    expect(setup.prisma.activationEvent.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          deliveryStatus: ActivationDeliveryStatus.SENT,
          externalMessageId: 'evolution-message-id',
        }),
      }),
    );
  });

  it('sends D0 after payment when an active conversation can be created and whatsappConnectedAt is still null', async () => {
    const setup = subject();
    const paidAt = new Date('2026-06-14T12:00:00.000Z');
    const activation = {
      id: 'activation-id',
      userId: 'user-id',
      currentStage: ActivationStage.PAID,
      score: 20,
      riskLevel: ActivationRiskLevel.LOW,
      registeredAt: new Date('2026-06-14T11:00:00.000Z'),
      paidAt,
      whatsappConnectedAt: null,
      firstMessageSentAt: null,
      firstMealReceivedAt: null,
      firstAnalysisCompletedAt: null,
      firstRecommendationDeliveredAt: null,
      firstCoachInteractionAt: null,
      firstValueAt: null,
      activatedAt: null,
      abandonedAt: null,
      lastProgressAt: paidAt,
      createdAt: paidAt,
      updatedAt: paidAt,
    };
    setup.activationService.reconcile.mockResolvedValue(activation);
    setup.prisma.subscription.findFirst.mockResolvedValue({
      id: 'subscription-id',
    });
    setup.prisma.activationEvent.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'recent-event-id' });
    setup.prisma.activationEvent.findUnique.mockResolvedValue(null);
    setup.prisma.activationEvent.upsert.mockResolvedValue({
      id: 'event-id',
    });
    setup.transaction.activationEvent.findUnique.mockResolvedValue({
      id: 'event-id',
      deliveryStatus: ActivationDeliveryStatus.PENDING,
      leaseExpiresAt: null,
    });
    setup.prisma.user.findUniqueOrThrow.mockResolvedValue({
      name: 'Ana Silva',
      phone: '11999999999',
      phoneE164: '+5511999999999',
      activation: {
        currentStage: ActivationStage.PAID,
        score: 20,
        riskLevel: ActivationRiskLevel.LOW,
      },
      behavioralProfile: null,
      goalClassification: null,
      contextSnapshots: [],
      recommendations: [],
      coachProfile: null,
    });

    await setup.service.processUser('user-id', paidAt);

    expect(setup.conversations.getOrCreateActive).toHaveBeenCalledWith(
      'user-id',
      { subscriptionId: 'subscription-id' },
    );
    expect(setup.evolution.sendText).toHaveBeenCalledTimes(1);
    expect(setup.evolution.sendText).toHaveBeenCalledWith({
      number: '+5511999999999',
      text: expect.stringContaining('Olá Ana.'),
    });
    expect(setup.prisma.activationEvent.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { idempotencyKey: 'activation-id:flow:D0' },
      }),
    );
    expect(setup.onboarding.start).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-id',
        activationId: 'activation-id',
      }),
    );
  });
  it('does not resend D0 when the activation event was already sent', async () => {
    const setup = subject();
    setup.prisma.user.findUniqueOrThrow.mockResolvedValue({
      name: 'Ana Silva',
      phone: '11999999999',
      phoneE164: '+5511999999999',
      activation: {
        currentStage: ActivationStage.WHATSAPP_CONNECTED,
        score: 20,
        riskLevel: ActivationRiskLevel.LOW,
      },
      behavioralProfile: null,
      goalClassification: null,
      contextSnapshots: [],
      recommendations: [],
      coachProfile: null,
    });
    setup.prisma.activationEvent.upsert.mockResolvedValue({
      id: 'event-id',
    });
    setup.transaction.activationEvent.findUnique.mockResolvedValue({
      id: 'event-id',
      deliveryStatus: ActivationDeliveryStatus.SENT,
      leaseExpiresAt: null,
    });

    await setup.testable.sendMessage(
      'activation-id',
      'user-id',
      'FLOW_MESSAGE',
      'D0',
      'activation-id:flow:D0',
      new Date('2026-06-14T12:00:00.000Z'),
      new Date('2026-06-14T12:00:00.000Z'),
    );

    expect(setup.prisma.activationEvent.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          idempotencyKey: 'activation-id:flow:D0',
        },
        update: {},
      }),
    );
    expect(setup.evolution.sendText).not.toHaveBeenCalled();
    expect(setup.prisma.activationEvent.updateMany).not.toHaveBeenCalled();
  });

  it('classifies a 14-day inactive journey as high risk', () => {
    const scores = new ActivationScoreService();

    expect(
      scores.risk(
        {
          currentStage: ActivationStage.FIRST_MESSAGE_SENT,
          lastProgressAt: new Date('2026-06-01T00:00:00.000Z'),
          firstMealReceivedAt: null,
        },
        new Date('2026-06-15T00:00:00.000Z'),
      ),
    ).toBe(ActivationRiskLevel.HIGH);
  });
});
