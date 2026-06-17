import { ConflictException } from '@nestjs/common';
import {
  BehavioralMotivationStyle,
  NutritionInsightType,
  Prisma,
  RecommendationCategory,
  RecommendationPriority,
  RecommendationStatus,
} from '@prisma/client';
import { EventService } from '../observability/event.service';
import { PrismaService } from '../prisma/prisma.service';
import { BehavioralRecommendationEngineService } from './behavioral-recommendation-engine.service';
import { NutritionRecommendationEngineService } from './nutrition-recommendation-engine.service';
import { RecommendationScoringService } from './recommendation-scoring.service';
import { RecommendationService } from './recommendation.service';
import { RetentionRecommendationEngineService } from './retention-recommendation-engine.service';
import { LongitudinalService } from '../longitudinal/longitudinal.service';

describe('RecommendationService', () => {
  const at = new Date('2026-06-13T12:00:00.000Z');

  function transaction() {
    return {
      $queryRaw: jest.fn().mockResolvedValue([{ locked: true }]),
      user: {
        findUnique: jest.fn().mockResolvedValue({
          nutritionProfile: {
            goal: 'MUSCLE_GAIN',
            restrictions: ['LACTOSE'],
            allergies: [],
          },
          fitnessProfile: null,
          goalClassification: null,
        }),
      },
      nutritionInsight: {
        findMany: jest.fn().mockResolvedValue([
          {
            type: NutritionInsightType.LOW_PROTEIN,
            title: 'Proteína baixa recorrente',
            occurrences: 3,
          },
        ]),
      },
      nutritionTrend: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      mealPattern: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      behavioralProfile: {
        findUnique: jest.fn().mockResolvedValue({
          communicationStyle: 'DIRECT',
          motivationStyle: BehavioralMotivationStyle.PERFORMANCE,
          adherenceStyle: 'STRUCTURED',
          confidenceScore: new Prisma.Decimal('0.8'),
        }),
      },
      behavioralMotivation: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      adherencePrediction: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      stageOfChangeHistory: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      motivationTrigger: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      engagementScore: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      consistencyScore: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      churnRiskAssessment: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      recommendation: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([
            {
              id: 'recommendation-id',
              status: RecommendationStatus.ACTIVE,
            },
          ]),
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            id: 'recommendation-id',
            status: RecommendationStatus.ACTIVE,
            confidenceScore: 70,
            ...data,
          }),
        ),
        update: jest.fn(),
        count: jest.fn().mockResolvedValue(1),
        groupBy: jest.fn().mockResolvedValue([
          {
            category: RecommendationCategory.NUTRITION,
            _count: { _all: 1 },
          },
        ]),
      },
      recommendationDailySnapshot: {
        upsert: jest.fn().mockResolvedValue({ id: 'snapshot-id' }),
      },
    };
  }

  function createSubject(tx = transaction()) {
    const prisma = {
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    const events = {
      recordInTransaction: jest.fn().mockResolvedValue({ id: 'event-id' }),
    };
    const longitudinal = {
      recommendationModifiers: jest.fn().mockResolvedValue({
        categories: {},
        signals: {},
      }),
      refreshRecommendationFeedbackInTransaction: jest
        .fn()
        .mockResolvedValue({ id: 'feedback-id' }),
    };
    const service = new RecommendationService(
      prisma as unknown as PrismaService,
      new NutritionRecommendationEngineService(),
      new BehavioralRecommendationEngineService(),
      new RetentionRecommendationEngineService(),
      new RecommendationScoringService(),
      events as unknown as EventService,
      longitudinal as unknown as LongitudinalService,
    );

    return { service, prisma, tx, events, longitudinal };
  }

  it('persists a contextual recommendation, snapshot and event', async () => {
    const subject = createSubject();

    await subject.service.refreshForUser('user-id', at);

    expect(subject.tx.recommendation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-id',
        category: RecommendationCategory.NUTRITION,
        signalKey: 'NUTRITION:LOW_PROTEIN',
        sourceKey: 'NUTRITION:LOW_PROTEIN:2026-06-08',
        confidenceScore: expect.any(Number),
      }),
    });
    expect(subject.tx.recommendationDailySnapshot.upsert).toHaveBeenCalled();
    expect(subject.events.recordInTransaction).toHaveBeenCalledWith(
      subject.tx,
      expect.objectContaining({
        eventType: 'RECOMMENDATION_GENERATED',
      }),
    );
  });

  it('applies learned feedback to future recommendation confidence', () => {
    const subject = createSubject();
    const adjusted = subject.service.applyFeedback(
      [
        {
          category: RecommendationCategory.NUTRITION,
          priority: RecommendationPriority.HIGH,
          signalKey: 'NUTRITION:LOW_PROTEIN',
          title: 'Proteína',
          description: 'Inclua proteína.',
          reason: 'Histórico',
          evidence: {},
          confidence: {
            contextSources: 2,
            historyDepth: 4,
            recurrence: 2,
            signalStrength: 60,
          },
        },
      ],
      {
        categories: { NUTRITION: 10 },
        signals: { 'NUTRITION:LOW_PROTEIN': 20 },
      },
    );

    expect(adjusted[0].confidence.signalStrength).toBe(90);
  });

  it.each([
    [
      'accept',
      RecommendationStatus.ACCEPTED,
      'RECOMMENDATION_ACCEPTED',
      'acceptedAt',
    ],
    [
      'dismiss',
      RecommendationStatus.DISMISSED,
      'RECOMMENDATION_DISMISSED',
      'dismissedAt',
    ],
  ] as const)(
    '%s transitions an active recommendation once',
    async (method, status, eventType, dateField) => {
      const tx = transaction();
      tx.recommendation.findUnique.mockResolvedValue({
        id: 'recommendation-id',
        userId: 'user-id',
        category: RecommendationCategory.HABIT,
        priority: RecommendationPriority.MEDIUM,
        confidenceScore: 72,
        status: RecommendationStatus.ACTIVE,
        expiresAt: new Date('2026-06-20T00:00:00.000Z'),
      });
      tx.recommendation.update.mockImplementation(({ data }) =>
        Promise.resolve({
          id: 'recommendation-id',
          userId: 'user-id',
          category: RecommendationCategory.HABIT,
          priority: RecommendationPriority.MEDIUM,
          confidenceScore: 72,
          ...data,
        }),
      );
      const subject = createSubject(tx);

      await subject.service[method]('recommendation-id', at);

      expect(tx.recommendation.update).toHaveBeenCalledWith({
        where: { id: 'recommendation-id' },
        data: {
          status,
          [dateField]: at,
        },
      });
      expect(subject.events.recordInTransaction).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({ eventType }),
      );
      expect(
        subject.longitudinal.refreshRecommendationFeedbackInTransaction,
      ).toHaveBeenCalledWith(tx, 'user-id', `recommendation-id:${status}`, at);
    },
  );

  it('expires an overdue recommendation instead of accepting it', async () => {
    const tx = transaction();
    tx.recommendation.findUnique.mockResolvedValue({
      id: 'recommendation-id',
      userId: 'user-id',
      category: RecommendationCategory.HABIT,
      priority: RecommendationPriority.MEDIUM,
      confidenceScore: 72,
      status: RecommendationStatus.ACTIVE,
      expiresAt: new Date('2026-06-12T00:00:00.000Z'),
    });
    tx.recommendation.update.mockImplementation(({ data }) =>
      Promise.resolve({
        id: 'recommendation-id',
        userId: 'user-id',
        category: RecommendationCategory.HABIT,
        priority: RecommendationPriority.MEDIUM,
        confidenceScore: 72,
        ...data,
      }),
    );
    const subject = createSubject(tx);

    await expect(
      subject.service.accept('recommendation-id', at),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.recommendation.update).toHaveBeenCalledWith({
      where: { id: 'recommendation-id' },
      data: {
        status: RecommendationStatus.EXPIRED,
        expiredAt: at,
      },
    });
    expect(subject.events.recordInTransaction).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        eventType: 'RECOMMENDATION_EXPIRED',
      }),
    );
  });
});
