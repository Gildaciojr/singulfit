import {
  FoodPreferenceKind,
  GoalProgressionState,
  LongitudinalDirection,
  Prisma,
  RecommendationCategory,
  RecommendationStatus,
} from '@prisma/client';
import { EventService } from '../observability/event.service';
import { PrismaService } from '../prisma/prisma.service';
import { LongitudinalCalculatorService } from './longitudinal-calculator.service';
import { LongitudinalService } from './longitudinal.service';

describe('LongitudinalService', () => {
  function service(prisma: object = {}) {
    return new LongitudinalService(
      prisma as PrismaService,
      new LongitudinalCalculatorService(),
      { recordInTransaction: jest.fn() } as unknown as EventService,
    );
  }

  it('detects frequent, avoided and explicitly rejected foods with confidence', () => {
    const subject = service();
    const history = [0, 1, 2].map((index) => ({
      calculatedAt: new Date(`2026-06-${10 + index}T12:00:00.000Z`),
      score: 75,
      goalAdherenceScore: 75,
      proteinScore: 80,
      sugarScore: 70,
      ultraProcessedScore: 85,
      mealAnalysis: {
        hydrationMl: new Prisma.Decimal('300'),
        vegetableGrams: new Prisma.Decimal('100'),
        totalProtein: new Prisma.Decimal('30'),
        totalSugar: new Prisma.Decimal('8'),
        ultraProcessedRatio: new Prisma.Decimal('0.1'),
        items: [
          {
            foodName: 'Frango',
            isUltraProcessed: false,
            isVegetable: false,
          },
        ],
      },
    }));

    const preferences = subject.foodPreferences(
      history,
      [
        {
          content: 'Eu não gosto de brócolis.',
          timestamp: new Date('2026-06-13T10:00:00.000Z'),
        },
      ],
      [{ description: 'Lactose' }],
      [],
    );

    expect(preferences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          foodName: 'Frango',
          kind: FoodPreferenceKind.FREQUENT,
        }),
        expect.objectContaining({
          normalizedFood: 'lactose',
          kind: FoodPreferenceKind.AVOIDED,
        }),
        expect.objectContaining({
          normalizedFood: 'brocolis',
          kind: FoodPreferenceKind.REJECTED,
          confidence: 0.92,
        }),
      ]),
    );
  });

  it('turns accepted, ignored and rejected recommendations into future modifiers', () => {
    const subject = service();
    const feedback = subject.recommendationFeedback([
      {
        category: RecommendationCategory.NUTRITION,
        signalKey: 'NUTRITION:PROTEIN',
        status: RecommendationStatus.ACCEPTED,
      },
      {
        category: RecommendationCategory.NUTRITION,
        signalKey: 'NUTRITION:PROTEIN',
        status: RecommendationStatus.ACCEPTED,
      },
      {
        category: RecommendationCategory.HYDRATION,
        signalKey: 'HYDRATION:LOW',
        status: RecommendationStatus.DISMISSED,
      },
      {
        category: RecommendationCategory.HABIT,
        signalKey: 'HABIT:REGULARITY',
        status: RecommendationStatus.EXPIRED,
      },
    ]);

    expect(feedback.acceptanceRate).toBe(50);
    expect(feedback.categoryScores.NUTRITION).toBe(20);
    expect(feedback.categoryScores.HYDRATION).toBe(-10);
    expect(feedback.categoryScores.HABIT).toBe(-4);
  });

  it('creates append-only memories for victories and recurring habits', () => {
    const subject = service();
    const memories = subject.longitudinalMemories({
      sourceKey: 'analysis:one',
      evolution: {
        current: {
          quality: 80,
          hydration: 70,
          vegetables: 75,
          ultraProcessed: 85,
          sugar: 82,
          protein: 88,
        },
        previous: {
          quality: 60,
          hydration: 55,
          vegetables: 50,
          ultraProcessed: 60,
          sugar: 58,
          protein: 62,
        },
        directions: {
          quality: LongitudinalDirection.IMPROVING,
          hydration: LongitudinalDirection.IMPROVING,
          vegetables: LongitudinalDirection.IMPROVING,
          ultraProcessed: LongitudinalDirection.IMPROVING,
          sugar: LongitudinalDirection.IMPROVING,
          protein: LongitudinalDirection.IMPROVING,
        },
        overallDirection: LongitudinalDirection.IMPROVING,
      },
      relapse: null,
      goalProgression: {
        score: 84,
        nutritionScore: 86,
        state: GoalProgressionState.IMPROVING,
      },
      adherenceScore: 82,
      preferences: [
        {
          foodName: 'Frango',
          kind: FoodPreferenceKind.FREQUENT,
          confidence: 0.92,
        },
      ],
      generatedAt: new Date('2026-06-14T12:00:00.000Z'),
    });

    expect(memories.map((item: { kind: string }) => item.kind)).toEqual(
      expect.arrayContaining(['VICTORY', 'ACHIEVEMENT', 'POSITIVE_HABIT']),
    );
    expect(
      new Set(memories.map((item: { sourceKey: string }) => item.sourceKey))
        .size,
    ).toBe(memories.length);
  });

  it('generates one immutable review for a completed month', async () => {
    const subject = service();
    const transaction = {
      monthlyEvolutionReview: {
        upsert: jest
          .fn()
          .mockImplementation(({ create }) =>
            Promise.resolve({ id: 'review-id', ...create }),
          ),
      },
    };
    const history = [
      {
        calculatedAt: new Date('2026-05-05T12:00:00.000Z'),
        score: 55,
        goalAdherenceScore: 55,
        proteinScore: 50,
        sugarScore: 50,
        ultraProcessedScore: 45,
        mealAnalysis: {
          hydrationMl: new Prisma.Decimal('150'),
          vegetableGrams: new Prisma.Decimal('40'),
          totalProtein: new Prisma.Decimal('15'),
          totalSugar: new Prisma.Decimal('25'),
          ultraProcessedRatio: new Prisma.Decimal('0.6'),
          items: [],
        },
      },
      {
        calculatedAt: new Date('2026-05-25T12:00:00.000Z'),
        score: 85,
        goalAdherenceScore: 85,
        proteinScore: 90,
        sugarScore: 88,
        ultraProcessedScore: 90,
        mealAnalysis: {
          hydrationMl: new Prisma.Decimal('450'),
          vegetableGrams: new Prisma.Decimal('130'),
          totalProtein: new Prisma.Decimal('35'),
          totalSugar: new Prisma.Decimal('7'),
          ultraProcessedRatio: new Prisma.Decimal('0.1'),
          items: [],
        },
      },
    ];

    const review = await subject.createMonthlyReview(
      transaction,
      'user-id',
      history,
      [],
      new Date('2026-06-14T12:00:00.000Z'),
    );

    expect(review.direction).toBe(LongitudinalDirection.IMPROVING);
    expect(transaction.monthlyEvolutionReview.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId_monthStart: {
            userId: 'user-id',
            monthStart: new Date('2026-05-01T00:00:00.000Z'),
          },
        },
        update: {},
      }),
    );
  });

  it('serializes concurrent reprocessing and returns persisted state idempotently', async () => {
    const persisted = {
      historySize: 6,
      adherenceScore: 70,
      consistencyScore: 65,
    };
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([{ locked: true }]),
      longitudinalNutritionProfile: {
        findUnique: jest.fn().mockResolvedValue({ id: 'profile-id' }),
        findFirst: jest.fn().mockResolvedValue(persisted),
        create: jest.fn(),
      },
      foodPreferenceSnapshot: { findMany: jest.fn().mockResolvedValue([]) },
      nutritionEvolutionSnapshot: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      nutritionRelapse: { findFirst: jest.fn().mockResolvedValue(null) },
      goalProgressionSnapshot: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      coachAdaptationSnapshot: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      longitudinalMemory: { findMany: jest.fn().mockResolvedValue([]) },
      monthlyEvolutionReview: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    const subject = service();

    const results = await Promise.all([
      subject.refreshInTransaction(
        transaction as never,
        'user-id',
        'analysis-id',
      ),
      subject.refreshInTransaction(
        transaction as never,
        'user-id',
        'analysis-id',
      ),
    ]);

    expect(transaction.$queryRaw).toHaveBeenCalledTimes(2);
    expect(
      transaction.longitudinalNutritionProfile.create,
    ).not.toHaveBeenCalled();
    expect(results[0].profile).toEqual(persisted);
    expect(results[1]).toEqual(results[0]);
  });
});
