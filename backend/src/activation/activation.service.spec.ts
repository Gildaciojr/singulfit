import {
  ActivationEventKind,
  ActivationRiskLevel,
  ActivationStage,
  UserActivation,
} from '@prisma/client';
import { EventService } from '../observability/event.service';
import { PrismaService } from '../prisma/prisma.service';
import { ActivationScoreService } from './activation-score.service';
import { ActivationService } from './activation.service';

describe('ActivationService', () => {
  const registeredAt = new Date('2026-06-01T10:00:00.000Z');
  const at = new Date('2026-06-02T10:00:00.000Z');

  function activation(overrides: Partial<UserActivation> = {}): UserActivation {
    return {
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
      ...overrides,
    };
  }

  function subject(initial = activation()) {
    let state = initial;
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([{ locked: true }]),
      userActivation: {
        findUniqueOrThrow: jest.fn(() => Promise.resolve(state)),
        update: jest.fn((args: { data: Partial<UserActivation> }) => {
          state = {
            ...state,
            ...args.data,
          };
          return Promise.resolve(state);
        }),
      },
      activationEvent: {
        create: jest.fn().mockResolvedValue({ id: 'event-id' }),
      },
      activationSnapshot: {
        upsert: jest.fn().mockResolvedValue({ id: 'snapshot-id' }),
      },
    };
    const prisma = {
      $transaction: jest.fn(
        (operation: (client: typeof transaction) => unknown) =>
          operation(transaction),
      ),
    };
    const eventService = {
      recordInTransaction: jest.fn().mockResolvedValue({ id: 'system-event' }),
    };
    const service = new ActivationService(
      prisma as unknown as PrismaService,
      new ActivationScoreService(),
      eventService as unknown as EventService,
    );
    const testable = service as unknown as {
      ensureStarted(userId: string): Promise<UserActivation>;
      collectFacts(userId: string): Promise<unknown>;
    };

    jest.spyOn(testable, 'ensureStarted').mockResolvedValue(initial);

    return {
      service,
      testable,
      transaction,
      eventService,
      getState: () => state,
    };
  }

  it('advances through every stage, detects first value and reaches score 100', async () => {
    const setup = subject();
    jest.spyOn(setup.testable, 'collectFacts').mockResolvedValue({
      paidAt: new Date('2026-06-01T10:05:00.000Z'),
      whatsappConnectedAt: new Date('2026-06-01T10:06:00.000Z'),
      firstMessageSentAt: new Date('2026-06-01T10:07:00.000Z'),
      firstMealReceivedAt: new Date('2026-06-01T11:00:00.000Z'),
      firstAnalysisCompletedAt: new Date('2026-06-01T11:02:00.000Z'),
      firstRecommendationDeliveredAt: new Date('2026-06-01T11:03:00.000Z'),
      firstCoachInteractionAt: new Date('2026-06-01T11:10:00.000Z'),
      firstValueAt: new Date('2026-06-01T11:02:00.000Z'),
      firstValueSource: 'USEFUL_ANALYSIS',
    });

    const result = await setup.service.reconcile('user-id', at);

    expect(result.currentStage).toBe(ActivationStage.ACTIVATED);
    expect(result.score).toBe(100);
    expect(result.firstValueAt).toEqual(new Date('2026-06-01T11:02:00.000Z'));
    expect(setup.transaction.$queryRaw).toHaveBeenCalled();
    expect(setup.transaction.activationEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: ActivationEventKind.FIRST_VALUE,
        }),
      }),
    );
    expect(setup.eventService.recordInTransaction).toHaveBeenCalledWith(
      setup.transaction,
      expect.objectContaining({ eventType: 'USER_ACTIVATED' }),
    );
  });

  it('is idempotent for an already activated journey', async () => {
    const setup = subject(
      activation({
        currentStage: ActivationStage.ACTIVATED,
        score: 100,
        activatedAt: at,
      }),
    );
    jest.spyOn(setup.testable, 'collectFacts').mockResolvedValue({});

    await setup.service.reconcile('user-id', at);

    expect(setup.transaction.activationEvent.create).not.toHaveBeenCalled();
    expect(setup.transaction.userActivation.update).not.toHaveBeenCalled();
    expect(setup.transaction.activationSnapshot.upsert).toHaveBeenCalledTimes(
      1,
    );
  });

  it('takes an advisory lock before mutating state under concurrency', async () => {
    const setup = subject();
    jest.spyOn(setup.testable, 'collectFacts').mockResolvedValue({
      paidAt: at,
      whatsappConnectedAt: null,
      firstMessageSentAt: null,
      firstMealReceivedAt: null,
      firstAnalysisCompletedAt: null,
      firstRecommendationDeliveredAt: null,
      firstCoachInteractionAt: null,
      firstValueAt: null,
      firstValueSource: null,
    });

    await setup.service.reconcile('user-id', at);

    expect(
      setup.transaction.$queryRaw.mock.invocationCallOrder[0],
    ).toBeLessThan(
      setup.transaction.userActivation.update.mock.invocationCallOrder[0],
    );
    expect(setup.getState().currentStage).toBe(ActivationStage.PAID);
  });
});
