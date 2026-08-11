import {
  ActivationDeliveryStatus,
  ActivationRiskLevel,
  ActivationStage,
  UserRole,
} from '@prisma/client';
import {
  EvolutionGateway,
  EvolutionSendError,
} from '../evolution/evolution.gateway';
import { EventService } from '../observability/event.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConversationsService } from '../whatsapp/conversations.service';
import { ActivationJourneyService } from './activation-journey.service';
import { ActivationOnboardingService } from './activation-onboarding.service';
import { ActivationScoreService } from './activation-score.service';
import { ActivationService } from './activation.service';

describe('ActivationJourneyService', () => {
  const delivery = (
    deliveryStatus: ActivationDeliveryStatus,
    overrides: Partial<{
      attempts: number;
      failedAt: Date | null;
      leaseExpiresAt: Date | null;
      metadata: object;
      updatedAt: Date;
    }> = {},
  ) => ({
    deliveryStatus,
    attempts: 1,
    failedAt: null,
    leaseExpiresAt: null,
    metadata: {},
    updatedAt: new Date('2026-06-04T11:00:00.000Z'),
    ...overrides,
  });

  function subject() {
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([{ locked: true }]),
      activationEvent: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({ id: 'event-id' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const prisma = {
      user: {
        findMany: jest.fn().mockResolvedValue([]),
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
      recordInTransaction: jest
        .fn()
        .mockResolvedValue({ id: 'system-event-id' }),
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
      claimDelivery(
        eventId: string,
        at: Date,
      ): Promise<false | { attempts: number; leaseExpiresAt: Date }>;
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
            ? delivery(ActivationDeliveryStatus.SENDING, {
                leaseExpiresAt: new Date('2026-06-04T11:59:00.000Z'),
              })
            : delivery(ActivationDeliveryStatus.SENT),
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
            : delivery(ActivationDeliveryStatus.SENT),
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
    setup.prisma.activationEvent.findUnique.mockResolvedValue(
      delivery(ActivationDeliveryStatus.SENDING, {
        leaseExpiresAt: new Date('2026-06-04T12:01:00.000Z'),
      }),
    );

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

  it('does not make a newly failed recovery eligible on the next poll', async () => {
    const setup = subject();
    const failedAt = new Date('2026-06-04T12:00:00.000Z');
    setup.prisma.activationEvent.findUnique.mockResolvedValue(
      delivery(ActivationDeliveryStatus.FAILED, {
        failedAt,
        updatedAt: failedAt,
      }),
    );

    await expect(
      setup.testable.dueRecovery(
        {
          id: 'activation-id',
          currentStage: ActivationStage.REGISTERED,
          lastProgressAt: new Date('2026-06-03T11:00:00.000Z'),
        },
        new Date('2026-06-04T12:00:01.000Z'),
      ),
    ).resolves.toBeNull();
  });

  it('retries a transient recovery only after the exponential backoff', async () => {
    const setup = subject();
    const failedAt = new Date('2026-06-04T12:00:00.000Z');
    setup.prisma.activationEvent.findUnique.mockResolvedValue(
      delivery(ActivationDeliveryStatus.FAILED, {
        attempts: 2,
        failedAt,
        updatedAt: failedAt,
      }),
    );
    const activation = {
      id: 'activation-id',
      currentStage: ActivationStage.REGISTERED,
      lastProgressAt: new Date('2026-06-03T11:00:00.000Z'),
    };

    await expect(
      setup.testable.dueRecovery(
        activation,
        new Date('2026-06-04T12:01:59.999Z'),
      ),
    ).resolves.toBeNull();
    await expect(
      setup.testable.dueRecovery(
        activation,
        new Date('2026-06-04T12:02:00.000Z'),
      ),
    ).resolves.toBe(24);
  });

  it('does not retry a recovery that reached the attempts limit', async () => {
    const setup = subject();
    setup.prisma.activationEvent.findUnique.mockResolvedValue(
      delivery(ActivationDeliveryStatus.FAILED, {
        attempts: 10,
        failedAt: new Date('2026-06-01T00:00:00.000Z'),
      }),
    );

    await expect(
      setup.testable.dueRecovery(
        {
          id: 'activation-id',
          currentStage: ActivationStage.REGISTERED,
          lastProgressAt: new Date('2026-06-03T11:00:00.000Z'),
        },
        new Date('2026-06-04T12:00:00.000Z'),
      ),
    ).resolves.toBeNull();
    expect(setup.evolution.sendText).not.toHaveBeenCalled();
  });

  it('does not retry a recovery with a permanent structured failure', async () => {
    const setup = subject();
    setup.prisma.activationEvent.findUnique.mockResolvedValue(
      delivery(ActivationDeliveryStatus.FAILED, {
        attempts: 1,
        failedAt: new Date('2026-06-01T00:00:00.000Z'),
        metadata: {
          deliveryFailure: {
            terminal: true,
            retryable: false,
            reason: 'PERMANENT_FAILURE',
          },
        },
      }),
    );

    await expect(
      setup.testable.dueRecovery(
        {
          id: 'activation-id',
          currentStage: ActivationStage.REGISTERED,
          lastProgressAt: new Date('2026-06-03T11:00:00.000Z'),
        },
        new Date('2026-06-04T12:00:00.000Z'),
      ),
    ).resolves.toBeNull();
  });

  it('never selects an already sent recovery', async () => {
    const setup = subject();
    setup.prisma.activationEvent.findUnique.mockResolvedValue(
      delivery(ActivationDeliveryStatus.SENT),
    );

    await expect(
      setup.testable.dueRecovery(
        {
          id: 'activation-id',
          currentStage: ActivationStage.REGISTERED,
          lastProgressAt: new Date('2026-06-03T11:00:00.000Z'),
        },
        new Date('2026-06-04T12:00:00.000Z'),
      ),
    ).resolves.toBeNull();
  });

  it('recovers an expired sending lease while attempts remain', async () => {
    const setup = subject();
    setup.prisma.activationEvent.findUnique.mockResolvedValue(
      delivery(ActivationDeliveryStatus.SENDING, {
        attempts: 9,
        leaseExpiresAt: new Date('2026-06-04T11:59:59.000Z'),
      }),
    );

    await expect(
      setup.testable.dueRecovery(
        {
          id: 'activation-id',
          currentStage: ActivationStage.REGISTERED,
          lastProgressAt: new Date('2026-06-03T11:00:00.000Z'),
        },
        new Date('2026-06-04T12:00:00.000Z'),
      ),
    ).resolves.toBe(24);
  });

  it('surfaces an expired exhausted lease for terminal reconciliation', async () => {
    const setup = subject();
    setup.prisma.activationEvent.findUnique.mockResolvedValue(
      delivery(ActivationDeliveryStatus.SENDING, {
        attempts: 10,
        leaseExpiresAt: new Date('2026-06-04T11:59:59.000Z'),
      }),
    );

    await expect(
      setup.testable.dueRecovery(
        {
          id: 'activation-id',
          currentStage: ActivationStage.REGISTERED,
          lastProgressAt: new Date('2026-06-03T11:00:00.000Z'),
        },
        new Date('2026-06-04T12:00:00.000Z'),
      ),
    ).resolves.toBe(24);
  });

  it('claims an expired ninth attempt as the tenth and final send attempt', async () => {
    const setup = subject();
    const at = new Date('2026-06-14T12:00:00.000Z');
    setup.transaction.activationEvent.findUnique.mockResolvedValue({
      id: 'event-id',
      deliveryStatus: ActivationDeliveryStatus.SENDING,
      leaseExpiresAt: new Date('2026-06-14T11:59:00.000Z'),
      attempts: 9,
      failedAt: null,
      metadata: {},
      updatedAt: new Date('2026-06-14T11:00:00.000Z'),
    });

    await expect(setup.testable.claimDelivery('event-id', at)).resolves.toEqual(
      {
        attempts: 10,
        leaseExpiresAt: new Date('2026-06-14T12:01:00.000Z'),
      },
    );
    expect(setup.transaction.activationEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          attempts: { increment: 1 },
        }),
      }),
    );
    expect(setup.transaction.activationEvent.updateMany).not.toHaveBeenCalled();
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
            ? delivery(ActivationDeliveryStatus.SENT)
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
      attempts: 1,
      failedAt: null,
      updatedAt: new Date('2026-06-14T12:00:00.000Z'),
    });

    await expect(
      setup.testable.claimDelivery(
        'event-id',
        new Date('2026-06-14T12:00:00.000Z'),
      ),
    ).resolves.toBe(false);
    expect(setup.transaction.$queryRaw).toHaveBeenCalled();
    expect(setup.transaction.activationEvent.update).not.toHaveBeenCalled();
    expect(setup.transaction.activationEvent.updateMany).not.toHaveBeenCalled();
    expect(setup.events.recordInTransaction).not.toHaveBeenCalled();
  });

  it('allows only one of two concurrent processings to send', async () => {
    const setup = subject();
    const at = new Date('2026-06-14T12:00:00.000Z');
    setup.prisma.user.findUniqueOrThrow.mockResolvedValue({
      name: 'Ana Silva',
      phone: '11999999999',
      phoneE164: '+5511999999999',
      activation: null,
      behavioralProfile: null,
      goalClassification: null,
      contextSnapshots: [],
      recommendations: [],
      coachProfile: null,
    });
    setup.prisma.activationEvent.upsert.mockResolvedValue({ id: 'event-id' });
    setup.transaction.activationEvent.findUnique
      .mockResolvedValueOnce({
        id: 'event-id',
        deliveryStatus: ActivationDeliveryStatus.PENDING,
        leaseExpiresAt: null,
        attempts: 0,
        failedAt: null,
        updatedAt: at,
      })
      .mockResolvedValueOnce({
        id: 'event-id',
        deliveryStatus: ActivationDeliveryStatus.SENDING,
        leaseExpiresAt: new Date(at.getTime() + 60_000),
        attempts: 1,
        failedAt: null,
        updatedAt: at,
      });

    await Promise.all([
      setup.testable.sendMessage(
        'activation-id',
        'user-id',
        'RECOVERY_MESSAGE',
        'RECOVERY_24H',
        'activation-id:recovery:REGISTERED:1:24',
        at,
        at,
      ),
      setup.testable.sendMessage(
        'activation-id',
        'user-id',
        'RECOVERY_MESSAGE',
        'RECOVERY_24H',
        'activation-id:recovery:REGISTERED:1:24',
        at,
        at,
      ),
    ]);

    expect(setup.transaction.$queryRaw).toHaveBeenCalledTimes(2);
    expect(setup.evolution.sendText).toHaveBeenCalledTimes(1);
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
      attempts: 0,
      failedAt: null,
      updatedAt: new Date('2026-06-14T12:00:00.000Z'),
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

  it('turns a permanent destination failure into a terminal failed event', async () => {
    const setup = subject();
    const at = new Date('2026-06-14T12:00:00.000Z');
    setup.prisma.user.findUniqueOrThrow.mockResolvedValue({
      name: 'Ana Silva',
      phone: 'invalid',
      phoneE164: null,
      activation: null,
      behavioralProfile: null,
      goalClassification: null,
      contextSnapshots: [],
      recommendations: [],
      coachProfile: null,
    });
    setup.prisma.activationEvent.upsert.mockResolvedValue({ id: 'event-id' });
    setup.transaction.activationEvent.findUnique.mockResolvedValue({
      id: 'event-id',
      deliveryStatus: ActivationDeliveryStatus.PENDING,
      leaseExpiresAt: null,
      attempts: 0,
      failedAt: null,
      updatedAt: at,
    });
    setup.evolution.sendText.mockRejectedValue(
      new EvolutionSendError(
        'Evolution API rejeitou o envio da mensagem (400)',
        false,
        400,
      ),
    );

    await expect(
      setup.testable.sendMessage(
        'activation-id',
        'user-id',
        'RECOVERY_MESSAGE',
        'RECOVERY_24H',
        'activation-id:recovery:REGISTERED:1:24',
        at,
        at,
      ),
    ).rejects.toBeInstanceOf(EvolutionSendError);

    expect(setup.evolution.sendText).toHaveBeenCalledTimes(1);
    expect(setup.prisma.activationEvent.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          deliveryStatus: ActivationDeliveryStatus.FAILED,
          metadata: expect.objectContaining({
            deliveryFailure: {
              terminal: true,
              retryable: false,
              reason: 'PERMANENT_FAILURE',
            },
          }),
        }),
      }),
    );
    expect(setup.events.record).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'USER_ACTIVATION_DELIVERY_PERMANENT_FAILURE',
      }),
    );
  });

  it('terminalizes an expired final lease without an eleventh send attempt', async () => {
    const setup = subject();
    const at = new Date('2026-06-14T12:00:00.000Z');
    setup.prisma.user.findUniqueOrThrow.mockResolvedValue({
      name: 'Ana Silva',
      phone: '11999999999',
      phoneE164: '+5511999999999',
      activation: null,
      behavioralProfile: null,
      goalClassification: null,
      contextSnapshots: [],
      recommendations: [],
      coachProfile: null,
    });
    setup.prisma.activationEvent.upsert.mockResolvedValue({ id: 'event-id' });
    setup.transaction.activationEvent.findUnique.mockResolvedValue({
      id: 'event-id',
      activationId: 'activation-id',
      userId: 'user-id',
      eventCode: 'RECOVERY_24H',
      deliveryStatus: ActivationDeliveryStatus.SENDING,
      leaseExpiresAt: new Date('2026-06-14T11:59:00.000Z'),
      attempts: 10,
      failedAt: null,
      metadata: { stage: 'REGISTERED' },
      updatedAt: new Date('2026-06-14T11:59:00.000Z'),
    });

    await setup.testable.sendMessage(
      'activation-id',
      'user-id',
      'RECOVERY_MESSAGE',
      'RECOVERY_24H',
      'activation-id:recovery:REGISTERED:1:24',
      at,
      at,
    );

    expect(setup.evolution.sendText).not.toHaveBeenCalled();
    expect(setup.transaction.activationEvent.update).not.toHaveBeenCalled();
    expect(setup.transaction.activationEvent.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'event-id',
        deliveryStatus: ActivationDeliveryStatus.SENDING,
        attempts: 10,
        leaseExpiresAt: new Date('2026-06-14T11:59:00.000Z'),
      },
      data: expect.objectContaining({
        deliveryStatus: ActivationDeliveryStatus.FAILED,
        leaseExpiresAt: null,
        metadata: {
          stage: 'REGISTERED',
          deliveryFailure: {
            terminal: true,
            retryable: true,
            reason: 'RETRY_EXHAUSTED',
          },
        },
      }),
    });
    const terminalData =
      setup.transaction.activationEvent.updateMany.mock.calls[0][0].data;
    expect(terminalData).not.toHaveProperty('attempts');
    expect(setup.events.recordInTransaction).toHaveBeenCalledTimes(1);
    expect(setup.events.recordInTransaction).toHaveBeenCalledWith(
      setup.transaction,
      expect.objectContaining({
        eventType: 'USER_ACTIVATION_DELIVERY_RETRY_EXHAUSTED',
      }),
    );
  });

  it('terminalizes an expired final lease only once under concurrent processing', async () => {
    const setup = subject();
    const at = new Date('2026-06-14T12:00:00.000Z');
    const exhausted = {
      id: 'event-id',
      activationId: 'activation-id',
      userId: 'user-id',
      eventCode: 'RECOVERY_24H',
      deliveryStatus: ActivationDeliveryStatus.SENDING,
      leaseExpiresAt: new Date('2026-06-14T11:59:00.000Z'),
      attempts: 10,
      failedAt: null,
      metadata: {},
      updatedAt: new Date('2026-06-14T11:59:00.000Z'),
    };
    setup.transaction.activationEvent.findUnique
      .mockResolvedValueOnce(exhausted)
      .mockResolvedValueOnce({
        ...exhausted,
        deliveryStatus: ActivationDeliveryStatus.FAILED,
        leaseExpiresAt: null,
        failedAt: at,
        metadata: {
          deliveryFailure: {
            terminal: true,
            retryable: true,
            reason: 'RETRY_EXHAUSTED',
          },
        },
      });

    await Promise.all([
      setup.testable.claimDelivery('event-id', at),
      setup.testable.claimDelivery('event-id', at),
    ]);

    expect(setup.transaction.$queryRaw).toHaveBeenCalledTimes(2);
    expect(setup.transaction.activationEvent.updateMany).toHaveBeenCalledTimes(
      1,
    );
    expect(setup.events.recordInTransaction).toHaveBeenCalledTimes(1);
    expect(setup.transaction.activationEvent.update).not.toHaveBeenCalled();
    expect(setup.evolution.sendText).not.toHaveBeenCalled();
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
      attempts: 0,
      failedAt: null,
      updatedAt: paidAt,
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
      attempts: 1,
      failedAt: null,
      updatedAt: new Date('2026-06-14T12:00:00.000Z'),
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

  it('sends a due recovery to a legitimate active user', async () => {
    const setup = subject();
    const at = new Date('2026-06-14T12:00:00.000Z');
    const registeredAt = new Date('2026-06-13T11:00:00.000Z');
    const activation = {
      id: 'activation-id',
      userId: 'user-id',
      currentStage: ActivationStage.REGISTERED,
      score: 5,
      riskLevel: ActivationRiskLevel.LOW,
      registeredAt,
      paidAt: null,
      whatsappConnectedAt: null,
      firstMessageSentAt: null,
      firstMealReceivedAt: null,
      firstAnalysisCompletedAt: null,
      firstRecommendationDeliveredAt: null,
      firstCoachInteractionAt: null,
      firstValueAt: null,
      activatedAt: null,
      abandonedAt: null,
      lastProgressAt: registeredAt,
      createdAt: registeredAt,
      updatedAt: registeredAt,
    };
    setup.activationService.reconcile.mockResolvedValue(activation);
    setup.prisma.subscription.findFirst.mockResolvedValue(null);
    setup.prisma.activationEvent.findUnique.mockResolvedValue(null);
    setup.prisma.activationEvent.upsert.mockResolvedValue({ id: 'event-id' });
    setup.transaction.activationEvent.findUnique.mockResolvedValue({
      id: 'event-id',
      deliveryStatus: ActivationDeliveryStatus.PENDING,
      leaseExpiresAt: null,
      attempts: 0,
      failedAt: null,
      updatedAt: at,
    });
    setup.prisma.user.findUniqueOrThrow.mockResolvedValue({
      name: 'Ana Silva',
      phone: '11999999999',
      phoneE164: '+5511999999999',
      activation: {
        currentStage: ActivationStage.REGISTERED,
        score: 5,
        riskLevel: ActivationRiskLevel.LOW,
      },
      behavioralProfile: null,
      goalClassification: null,
      contextSnapshots: [],
      recommendations: [],
      coachProfile: null,
    });

    await setup.service.processUser('user-id', at);

    expect(setup.evolution.sendText).toHaveBeenCalledWith({
      number: '+5511999999999',
      text: expect.stringContaining('faz um dia'),
    });
  });

  it('selects only active customer accounts for activation processing', async () => {
    const setup = subject();

    await setup.service.processDue(new Date('2026-06-14T12:00:00.000Z'));

    expect(setup.prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          isActive: true,
          role: UserRole.USER,
        }),
      }),
    );
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
