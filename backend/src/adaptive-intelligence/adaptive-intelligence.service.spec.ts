import {
  AdaptiveCommunicationProfile,
  DietaryPatternType,
  EarlyChurnLevel,
  FoodQualityClass,
  NutritionTrendDirection,
  Prisma,
  RecommendationPriority,
  RecommendationStatus,
} from '@prisma/client';
import { EventService } from '../observability/event.service';
import { PrismaService } from '../prisma/prisma.service';
import { AdaptiveIntelligenceCalculatorService } from './adaptive-intelligence-calculator.service';
import { AdaptiveIntelligenceService } from './adaptive-intelligence.service';

describe('AdaptiveIntelligenceService', () => {
  it('persists snapshots, ranking and every observability event atomically', async () => {
    const at = new Date('2026-06-15T12:00:00.000Z');
    const quality = {
      id: 'quality-id',
      userId: 'user-id',
      mealAnalysisId: 'analysis-id',
      score: 82,
      proteinScore: 88,
      fiberScore: 76,
      ultraProcessedScore: 90,
      sugarScore: 85,
      fatScore: 80,
      balanceScore: 80,
      goalAdherenceScore: 84,
      calculatedAt: at,
      createdAt: at,
      updatedAt: at,
      mealAnalysis: {
        hydrationMl: new Prisma.Decimal(450),
        vegetableGrams: new Prisma.Decimal(140),
        items: [
          { foodName: 'Frango' },
          { foodName: 'Arroz' },
          { foodName: 'Brócolis' },
        ],
      },
    };
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([{ locked: true }]),
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: 'user-id' }),
      },
      nutritionQualityScore: {
        findMany: jest.fn().mockResolvedValue([quality]),
      },
      recommendation: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'recommendation-id',
            category: 'NUTRITION',
            signalKey: 'protein:meal',
            priority: RecommendationPriority.HIGH,
            confidenceScore: 84,
            status: RecommendationStatus.ACTIVE,
            generatedAt: at,
          },
        ]),
      },
      behavioralProfile: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ communicationStyle: 'ANALYTICAL' }),
      },
      communicationAdaptationSnapshot: {
        findFirst: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockImplementation(({ create }) =>
          Promise.resolve({
            id: 'communication-id',
            createdAt: at,
            updatedAt: at,
            ...create,
          }),
        ),
      },
      adherencePrediction: {
        findFirst: jest.fn().mockResolvedValue({ responseScore: 75 }),
      },
      engagementScore: {
        findFirst: jest.fn().mockResolvedValue({
          score: 72,
          weeklyUsageScore: 75,
          analysesScore: 80,
        }),
      },
      consistencyScore: {
        findFirst: jest.fn().mockResolvedValue({ score: 70 }),
      },
      habitSnapshot: {
        findFirst: jest.fn().mockResolvedValue({ daysSinceInteraction: 1 }),
      },
      activationSnapshot: {
        findFirst: jest.fn().mockResolvedValue({ riskLevel: 'LOW' }),
      },
      message: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ content: 'feito', timestamp: at }]),
      },
      coachMessage: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      longitudinalMemory: {
        findMany: jest.fn().mockResolvedValue([
          {
            kind: 'VICTORY',
            title: 'Mais vegetais',
            summary: 'Vegetais apareceram com regularidade.',
          },
        ]),
      },
      adaptiveRecommendationRank: {
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn().mockResolvedValue({ id: 'rank-id' }),
      },
      coachCommunicationProfileSnapshot: {
        findFirst: jest.fn().mockResolvedValue({ dominantStyle: 'TECHNICAL' }),
      },
      nutritionEvidenceSnapshot: {
        upsert: jest.fn().mockImplementation(({ create }) =>
          Promise.resolve({
            id: 'evidence-id',
            createdAt: at,
            updatedAt: at,
            ...create,
          }),
        ),
      },
      foodQualityIndex: {
        upsert: jest.fn().mockResolvedValue({
          id: 'food-quality-id',
          qualityClass: FoodQualityClass.GOOD,
        }),
      },
      dietaryPatternSnapshot: {
        upsert: jest.fn().mockImplementation(({ create }) =>
          Promise.resolve({
            id: `pattern-${create.pattern}`,
            createdAt: at,
            updatedAt: at,
            ...create,
          }),
        ),
      },
      userLearningProfile: {
        upsert: jest.fn().mockImplementation(({ create }) =>
          Promise.resolve({
            id: 'learning-id',
            createdAt: at,
            updatedAt: at,
            ...create,
          }),
        ),
      },
      earlyChurnSnapshot: {
        upsert: jest.fn().mockImplementation(({ create }) =>
          Promise.resolve({
            id: 'churn-id',
            createdAt: at,
            updatedAt: at,
            ...create,
          }),
        ),
      },
      longitudinalNutritionWindowSnapshot: {
        upsert: jest.fn().mockImplementation(({ create }) =>
          Promise.resolve({
            id: `evolution-${create.windowDays}`,
            createdAt: at,
            updatedAt: at,
            ...create,
          }),
        ),
      },
    };
    const prisma = {
      $transaction: jest.fn(
        (callback: (client: typeof transaction) => unknown) =>
          callback(transaction),
      ),
    };
    const events = {
      recordInTransaction: jest.fn().mockResolvedValue({ id: 'event-id' }),
    };
    const service = new AdaptiveIntelligenceService(
      prisma as unknown as PrismaService,
      new AdaptiveIntelligenceCalculatorService(),
      events as unknown as EventService,
    );

    const result = await service.refreshForUser('user-id', at);

    expect(result.nutritionEvidence.score).toBeGreaterThan(70);
    expect(result.foodQuality?.qualityClass).toBe(FoodQualityClass.GOOD);
    expect(result.dietaryPatterns.map((item) => item.pattern)).toContain(
      DietaryPatternType.BALANCED,
    );
    expect(result.communication.profile).toBe(
      AdaptiveCommunicationProfile.TECHNICAL,
    );
    expect(result.earlyChurn.level).toBe(EarlyChurnLevel.MEDIUM);
    expect(result.evolution).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          windowDays: 7,
          direction: NutritionTrendDirection.STABLE,
        }),
      ]),
    );
    expect(transaction.adaptiveRecommendationRank.upsert).toHaveBeenCalled();
    const eventTypes = (
      events.recordInTransaction.mock.calls as Array<
        [unknown, { eventType: string }]
      >
    ).map(([, input]) => input.eventType);
    expect(eventTypes).toEqual([
      'NUTRITION_EVIDENCE_RECALCULATED',
      'FOOD_QUALITY_INDEX_UPDATED',
      'DIETARY_PATTERN_UPDATED',
      'USER_LEARNING_PROFILE_UPDATED',
      'COMMUNICATION_PROFILE_ADAPTED',
      'EARLY_CHURN_RECALCULATED',
      'ADAPTIVE_RECOMMENDATION_RANKED',
      'COACH_MEMORY_REINFORCED',
    ]);
  });
});
