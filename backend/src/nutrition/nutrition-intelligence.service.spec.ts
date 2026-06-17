import {
  FitnessGoal,
  MealCategory,
  NutritionInsightStatus,
  NutritionInsightType,
  NutritionRecommendationType,
  NutritionTrendDirection,
  Prisma,
} from '@prisma/client';
import { ContextService } from '../context/context.service';
import { EventService } from '../observability/event.service';
import { PrismaService } from '../prisma/prisma.service';
import { NutritionUserContext } from './interfaces/nutrition-context.interface';
import { NutritionIntelligenceService } from './nutrition-intelligence.service';
import { NutritionQualityService } from './nutrition-quality.service';
import { LongitudinalService } from '../longitudinal/longitudinal.service';
import { AdaptiveIntelligenceService } from '../adaptive-intelligence/adaptive-intelligence.service';

describe('NutritionIntelligenceService', () => {
  const context: NutritionUserContext = {
    userId: 'user-id',
    goal: FitnessGoal.MUSCLE_GAIN,
    activityLevel: 'MODERATE',
    restrictions: [{ type: 'LACTOSE', description: 'Sem lactose' }],
    allergies: [],
    preferences: {
      preferredMealTimes: ['12:00'],
      preferredLanguage: 'pt-BR',
      timezone: 'America/Sao_Paulo',
    },
    latestSnapshot: {
      adherenceScore: 72,
    },
    memories: [
      {
        summary: 'Usuário relata dificuldade com proteína no almoço',
        content: {
          recentMessages: [],
        },
      },
    ],
    statistics: {
      nutritionAnalysesCount: 4,
      adherenceScore: 72,
      messagesLast7Days: 3,
      messagesLast30Days: 9,
    },
    recentMeals: [],
    activeInsights: [],
    trends: [],
  };

  it('combines Context Engine, memory and nutrition history', async () => {
    const prisma = {
      meal: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'meal-id',
            createdAt: new Date('2026-06-13T12:00:00.000Z'),
            analysis: {
              mealCategory: MealCategory.LUNCH,
              items: [{ foodName: 'Arroz' }],
              qualityScore: { score: 70 },
            },
          },
        ]),
      },
      nutritionInsight: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      nutritionTrend: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const contextService = {
      buildUserContext: jest.fn().mockResolvedValue({
        userId: 'user-id',
        nutritionProfile: {
          goal: FitnessGoal.MUSCLE_GAIN,
          activityLevel: 'MODERATE',
          restrictions: context.restrictions,
          allergies: [],
        },
        preferences: context.preferences,
        latestSnapshot: context.latestSnapshot,
        memories: context.memories,
        statistics: context.statistics,
      }),
    };
    const service = new NutritionIntelligenceService(
      prisma as unknown as PrismaService,
      contextService as unknown as ContextService,
      new NutritionQualityService(),
      {} as EventService,
      {} as LongitudinalService,
      {} as AdaptiveIntelligenceService,
    );

    const result = await service.buildUserNutritionContext('user-id');

    expect(contextService.buildUserContext).toHaveBeenCalledWith('user-id');
    expect(result.goal).toBe(FitnessGoal.MUSCLE_GAIN);
    expect(result.memories[0]?.summary).toContain('proteína');
    expect(result.recentMeals[0]).toEqual(
      expect.objectContaining({
        category: MealCategory.LUNCH,
        score: 70,
        foods: ['Arroz'],
      }),
    );
  });

  it('persists recurring insights, trends, recommendations and events', async () => {
    const calculatedAt = new Date('2026-06-13T15:00:00.000Z');
    const quality = {
      score: 32,
      proteinScore: 25,
      fiberScore: 20,
      ultraProcessedScore: 30,
      sugarScore: 35,
      fatScore: 55,
      balanceScore: 30,
      goalAdherenceScore: 28,
    };
    const history = [0, 1, 2].map((index) => ({
      id: `score-${index}`,
      userId: 'user-id',
      mealAnalysisId: `analysis-${index}`,
      ...quality,
      calculatedAt: new Date(calculatedAt.getTime() - index * 86_400_000),
      createdAt: calculatedAt,
      updatedAt: calculatedAt,
      mealAnalysis: {
        mealCategory: MealCategory.LUNCH,
        hydrationMl: new Prisma.Decimal('80'),
        vegetableGrams: new Prisma.Decimal('20'),
        items: [{ foodName: 'Biscoito recheado' }],
      },
    }));
    const transaction = {
      mealAnalysis: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'analysis-id',
          totalCalories: new Prisma.Decimal('650'),
          totalProtein: new Prisma.Decimal('8'),
          totalCarbs: new Prisma.Decimal('95'),
          totalFat: new Prisma.Decimal('25'),
          totalFiber: new Prisma.Decimal('2'),
          totalSugar: new Prisma.Decimal('35'),
          ultraProcessedRatio: new Prisma.Decimal('0.70'),
          vegetableGrams: new Prisma.Decimal('20'),
          hydrationMl: new Prisma.Decimal('80'),
          mealCategory: MealCategory.LUNCH,
          items: [{ foodName: 'Biscoito recheado' }],
        }),
      },
      nutritionQualityScore: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({
          id: 'quality-id',
          userId: 'user-id',
          mealAnalysisId: 'analysis-id',
          ...quality,
          calculatedAt,
          createdAt: calculatedAt,
          updatedAt: calculatedAt,
        }),
        findMany: jest.fn().mockResolvedValue(history),
      },
      nutritionInsight: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockImplementation(({ create }) =>
          Promise.resolve({
            id: `insight-${create.type}`,
            status: NutritionInsightStatus.ACTIVE,
            occurrences: 1,
            createdAt: calculatedAt,
            updatedAt: calculatedAt,
            resolvedAt: null,
            ...create,
          }),
        ),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
      },
      mealPattern: {
        upsert: jest.fn().mockResolvedValue({ id: 'pattern-id' }),
      },
      nutritionTrend: {
        upsert: jest.fn().mockImplementation(({ create }) =>
          Promise.resolve({
            id: `trend-${create.windowDays}`,
            createdAt: calculatedAt,
            ...create,
          }),
        ),
      },
      nutritionRecommendation: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        upsert: jest.fn().mockImplementation(({ create }) =>
          Promise.resolve({
            id: `recommendation-${create.type}`,
            createdAt: calculatedAt,
            updatedAt: calculatedAt,
            ...create,
          }),
        ),
      },
    };
    const qualityService = {
      calculate: jest.fn().mockReturnValue(quality),
    };
    const eventService = {
      recordInTransaction: jest.fn().mockResolvedValue({ id: 'event-id' }),
    };
    const longitudinal = {
      refreshInTransaction: jest.fn().mockResolvedValue({
        profile: { historySize: 3 },
      }),
    };
    const adaptive = {
      refreshInTransaction: jest.fn().mockResolvedValue({
        nutritionEvidence: { score: 32 },
      }),
    };
    const service = new NutritionIntelligenceService(
      {} as PrismaService,
      {} as ContextService,
      qualityService as unknown as NutritionQualityService,
      eventService as unknown as EventService,
      longitudinal as unknown as LongitudinalService,
      adaptive as unknown as AdaptiveIntelligenceService,
    );

    const result = await service.processCompletedAnalysis(
      transaction as unknown as Prisma.TransactionClient,
      'user-id',
      'analysis-id',
      context,
      calculatedAt,
    );

    expect(transaction.nutritionQualityScore.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          score: 32,
          proteinScore: 25,
        }),
      }),
    );
    expect(transaction.nutritionInsight.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          type: NutritionInsightType.LOW_PROTEIN,
        }),
      }),
    );
    expect(transaction.mealPattern.upsert).toHaveBeenCalledTimes(4);
    expect(transaction.nutritionTrend.upsert).toHaveBeenCalledTimes(3);
    expect(result.trends).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          windowDays: 7,
          direction: NutritionTrendDirection.STABLE,
        }),
      ]),
    );
    expect(transaction.nutritionRecommendation.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          type: NutritionRecommendationType.PROTEIN_ADJUSTMENT,
          rationale: expect.stringContaining('histórico recente'),
          action: expect.stringContaining('restrições cadastradas'),
        }),
      }),
    );
    expect(eventService.recordInTransaction).toHaveBeenCalledWith(
      transaction,
      expect.objectContaining({
        eventType: 'NUTRITION_SCORE_RECALCULATED',
      }),
    );
    expect(eventService.recordInTransaction).toHaveBeenCalledWith(
      transaction,
      expect.objectContaining({
        eventType: 'NUTRITION_INSIGHT_CREATED',
      }),
    );
    expect(eventService.recordInTransaction).toHaveBeenCalledWith(
      transaction,
      expect.objectContaining({
        eventType: 'NUTRITION_TREND_RECALCULATED',
      }),
    );
    expect(eventService.recordInTransaction).toHaveBeenCalledWith(
      transaction,
      expect.objectContaining({
        eventType: 'NUTRITION_RECOMMENDATION_GENERATED',
      }),
    );
    expect(longitudinal.refreshInTransaction).toHaveBeenCalledWith(
      transaction,
      'user-id',
      'analysis-id',
      calculatedAt,
    );
    expect(adaptive.refreshInTransaction).toHaveBeenCalledWith(
      transaction,
      'user-id',
      calculatedAt,
    );
  });
});
