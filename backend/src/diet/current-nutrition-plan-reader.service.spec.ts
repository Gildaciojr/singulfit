import { ConflictException } from '@nestjs/common';
import {
  AIJobStatus,
  AIJobType,
  DietPlanStatus,
  FitnessGoal,
  NutritionArtifactType,
  NutritionPlanLifecycleReason,
  NutritionPlanStatus,
  NutritionPlanImplementation,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CANONICAL_NUTRITION_READ_CONFLICT } from './current-nutrition-plan-reader.contract';
import { CurrentNutritionPlanReaderService } from './current-nutrition-plan-reader.service';
import type { NutritionPlanV2 } from './v2/nutrition-plan-v2.contract';
import { NutritionPlanV2PersistenceValidator } from './v2/persistence/nutrition-plan-v2-persistence.validator';

const LEGACY_DATE = new Date('2026-07-29T12:00:00.000Z');
const V2_DATE = new Date('2026-07-30T12:00:00.000Z');

function decimal(value: number): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

function legacyPlan(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    id: 'legacy-id',
    userId: 'user-id',
    profileId: 'profile-id',
    aiJobId: 'legacy-job-id',
    title: 'Plano Legacy',
    objective: FitnessGoal.WEIGHT_LOSS,
    dailyCaloriesTarget: decimal(1_800),
    proteinTarget: decimal(120),
    carbsTarget: decimal(210),
    fatTarget: decimal(60),
    status: DietPlanStatus.ACTIVE,
    generatedAt: LEGACY_DATE,
    createdAt: LEGACY_DATE,
    updatedAt: LEGACY_DATE,
    meals: [
      {
        id: 'meal-id',
        dietPlanId: 'legacy-id',
        name: 'Café da manhã',
        order: 1,
        caloriesTarget: decimal(400),
        notes: null,
        items: [
          {
            id: 'item-id',
            dietMealId: 'meal-id',
            foodName: 'Aveia',
            quantity: '40 g',
            calories: decimal(150),
            protein: decimal(5),
            carbs: decimal(25),
            fat: decimal(3),
            substitutionGroup: null,
          },
        ],
      },
    ],
    aiJob: {
      id: 'legacy-job-id',
      userId: 'user-id',
      conversationId: null,
      messageId: null,
      type: AIJobType.DIET,
      status: AIJobStatus.COMPLETED,
      promptVersionId: 'prompt-id',
      providerResponseId: 'response-id',
      operationKey: 'legacy-operation',
      attempts: 1,
      startedAt: LEGACY_DATE,
      leaseExpiresAt: null,
      result: null,
      completedAt: LEGACY_DATE,
      failedAt: null,
      error: null,
      createdAt: LEGACY_DATE,
      updatedAt: LEGACY_DATE,
      usage: [],
    },
    ...overrides,
  };
}

function v2Document(): NutritionPlanV2 {
  return {
    schemaVersion: 2,
    artifactType: 'WEEKLY_PLAN',
    lifecycleReason: 'CREATION',
    replacesPlanReference: null,
    title: 'Plano V2',
    objectiveSummary: 'Estratégia nutricional segura',
    strategy: {
      schemaVersion: 2,
      artifactType: 'WEEKLY_PLAN',
      objective: { status: 'CONFIRMED', value: FitnessGoal.WEIGHT_LOSS },
      dayCount: 0,
      mealCountPerDay: { status: 'NOT_SET' },
      mealSchedule: { status: 'NOT_SET' },
      energyTargetKcal: { status: 'NOT_SET' },
      energySource: 'NOT_AVAILABLE',
      macroTargets: { status: 'NOT_SET' },
      trainingAware: false,
      appliedConstraintCodes: [],
      excludedFoods: [],
      preferredFoods: [],
      variationPolicy: 'WEEKLY',
      detailLevel: 'STANDARD',
      factors: [],
    },
    guidance: [],
    days: [],
    substitutions: [],
    adaptationRules: [],
    hydrationGuidance: [],
    safetyNotes: [],
    generation: {
      engineVersion: 2,
      promptVersionId: 'prompt-id',
      aiJobId: 'v2-job-id',
      operationKey: 'v2-operation',
      model: 'model-id',
      generatedAt: V2_DATE.toISOString(),
      reused: false,
    },
    validation: { status: 'VALID', issues: [] },
  };
}

function v2Plan(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    id: 'v2-id',
    userId: 'user-id',
    profileId: 'profile-id',
    aiJobId: 'v2-job-id',
    schemaVersion: 2,
    engineVersion: 2,
    artifactType: NutritionArtifactType.WEEKLY_PLAN,
    lifecycleReason: NutritionPlanLifecycleReason.CREATION,
    replacesPlanReference: null,
    status: NutritionPlanStatus.ACTIVE,
    document: v2Document(),
    generatedAt: V2_DATE,
    createdAt: V2_DATE,
    updatedAt: V2_DATE,
    ...overrides,
  };
}

describe('CurrentNutritionPlanReaderService', () => {
  function createSubject(input?: {
    readonly activeLegacy?: readonly ReturnType<typeof legacyPlan>[];
    readonly activeV2?: readonly ReturnType<typeof v2Plan>[];
    readonly legacyHistory?: readonly ReturnType<typeof legacyPlan>[];
    readonly v2History?: readonly ReturnType<typeof v2Plan>[];
    readonly ownership?: {
      readonly implementation: NutritionPlanImplementation;
      readonly planId: string;
      readonly profileId: string;
    } | null;
  }) {
    const prisma = {
      nutritionPlanOwnership: {
        findUnique: jest.fn().mockResolvedValue(input?.ownership ?? null),
      },
      dietPlan: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([...(input?.activeLegacy ?? [])])
          .mockResolvedValue([...(input?.legacyHistory ?? [])]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      nutritionPlanV2: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([...(input?.activeV2 ?? [])])
          .mockResolvedValue([...(input?.v2History ?? [])]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    return {
      prisma,
      service: new CurrentNutritionPlanReaderService(
        prisma as unknown as PrismaService,
        new NutritionPlanV2PersistenceValidator(),
      ),
    };
  }

  it('returns the Legacy variant when it is the only active implementation', async () => {
    const subject = createSubject({ activeLegacy: [legacyPlan()] });

    const current = await subject.service.getCurrent('user-id');

    expect(current).toMatchObject({
      implementation: 'LEGACY',
      id: 'legacy-id',
      dailyCaloriesTarget: 1_800,
    });
  });

  it('returns the V2 document without fabricating NOT_SET targets', async () => {
    const subject = createSubject({ activeV2: [v2Plan()] });

    const current = await subject.service.getCurrent('user-id');

    expect(current).toMatchObject({
      implementation: 'V2',
      id: 'v2-id',
      objectiveSummary: 'Estratégia nutricional segura',
      document: {
        strategy: {
          energyTargetKcal: { status: 'NOT_SET' },
          macroTargets: { status: 'NOT_SET' },
        },
      },
    });
  });

  it('returns null when neither implementation has an active plan', async () => {
    const subject = createSubject();

    await expect(subject.service.getCurrent('user-id')).resolves.toBeNull();
  });

  it('rejects dual-active implementations instead of using timestamps', async () => {
    const subject = createSubject({
      activeLegacy: [legacyPlan()],
      activeV2: [v2Plan()],
    });

    const operation = subject.service.getCurrent('user-id');

    await expect(operation).rejects.toBeInstanceOf(ConflictException);
    await expect(operation).rejects.toMatchObject({
      response: expect.objectContaining({
        error: CANONICAL_NUTRITION_READ_CONFLICT,
      }),
    });
  });

  it.each([
    [NutritionPlanImplementation.LEGACY, legacyPlan(), 'LEGACY'],
    [NutritionPlanImplementation.V2, v2Plan(), 'V2'],
  ] as const)(
    'uses persisted %s ownership even with both stores active',
    async (implementation, ownedPlan, expected) => {
      const subject = createSubject({
        ownership: {
          implementation,
          planId: ownedPlan.id,
          profileId: 'profile-id',
        },
        activeLegacy: [legacyPlan()],
        activeV2: [v2Plan()],
      });
      if (implementation === NutritionPlanImplementation.LEGACY) {
        subject.prisma.dietPlan.findFirst.mockResolvedValue(ownedPlan);
      } else {
        subject.prisma.nutritionPlanV2.findFirst.mockResolvedValue(ownedPlan);
      }
      await expect(
        subject.service.getCurrent('user-id'),
      ).resolves.toMatchObject({
        implementation: expected,
        id: ownedPlan.id,
      });
      expect(subject.prisma.dietPlan.findMany).not.toHaveBeenCalled();
      expect(subject.prisma.nutritionPlanV2.findMany).not.toHaveBeenCalled();
    },
  );

  it('rejects dangling persisted ownership without fallback', async () => {
    const subject = createSubject({
      ownership: {
        implementation: NutritionPlanImplementation.V2,
        planId: 'missing-id',
        profileId: 'profile-id',
      },
      activeLegacy: [legacyPlan()],
    });
    await expect(subject.service.getCurrent('user-id')).rejects.toMatchObject({
      response: expect.objectContaining({
        error: CANONICAL_NUTRITION_READ_CONFLICT,
      }),
    });
    expect(subject.prisma.dietPlan.findMany).not.toHaveBeenCalled();
  });

  it('validates owned user, profile and ACTIVE status in the aggregate lookup', async () => {
    const subject = createSubject({
      ownership: {
        implementation: NutritionPlanImplementation.LEGACY,
        planId: 'legacy-id',
        profileId: 'owned-profile-id',
      },
    });
    await expect(subject.service.getCurrent('user-id')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(subject.prisma.dietPlan.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'legacy-id',
        userId: 'user-id',
        profileId: 'owned-profile-id',
        status: DietPlanStatus.ACTIVE,
      },
      include: expect.any(Object),
    });
  });

  it('rejects an invalid owned V2 document without selecting Legacy', async () => {
    const subject = createSubject({
      ownership: {
        implementation: NutritionPlanImplementation.V2,
        planId: 'v2-id',
        profileId: 'profile-id',
      },
      activeLegacy: [legacyPlan()],
    });
    subject.prisma.nutritionPlanV2.findFirst.mockResolvedValue(
      v2Plan({ document: { invalid: true } }),
    );
    await expect(subject.service.getCurrent('user-id')).rejects.toMatchObject({
      response: expect.objectContaining({
        error: CANONICAL_NUTRITION_READ_CONFLICT,
      }),
    });
    expect(subject.prisma.dietPlan.findMany).not.toHaveBeenCalled();
  });

  it('rejects multiple active plans inside one implementation', async () => {
    const subject = createSubject({
      activeLegacy: [legacyPlan(), legacyPlan({ id: 'legacy-id-2' })],
    });

    await expect(subject.service.getCurrent('user-id')).rejects.toMatchObject({
      response: expect.objectContaining({
        error: CANONICAL_NUTRITION_READ_CONFLICT,
      }),
    });
  });

  it('reads an explicitly discriminated V2 reference safely', async () => {
    const subject = createSubject();
    subject.prisma.nutritionPlanV2.findFirst.mockResolvedValue(v2Plan());

    const plan = await subject.service.getByReference('user-id', {
      implementation: 'V2',
      id: 'v2-id',
    });

    expect(plan).toMatchObject({ implementation: 'V2', id: 'v2-id' });
    expect(subject.prisma.nutritionPlanV2.findFirst).toHaveBeenCalledWith({
      where: { id: 'v2-id', userId: 'user-id' },
    });
  });

  it('merges history with deterministic generatedAt and id ordering', async () => {
    const tiedDate = new Date('2026-07-31T12:00:00.000Z');
    const subject = createSubject();
    subject.prisma.dietPlan.findMany
      .mockReset()
      .mockResolvedValue([
        legacyPlan({ id: 'a', generatedAt: tiedDate, updatedAt: tiedDate }),
      ]);
    subject.prisma.nutritionPlanV2.findMany
      .mockReset()
      .mockResolvedValue([
        v2Plan({ id: 'b', generatedAt: tiedDate, updatedAt: tiedDate }),
        v2Plan({ id: 'newest', generatedAt: V2_DATE }),
      ]);

    const history = await subject.service.listHistory('user-id');

    expect(history.map((item) => `${item.implementation}:${item.id}`)).toEqual([
      'V2:b',
      'LEGACY:a',
      'V2:newest',
    ]);
  });

  it('bounds history queries and rejects invalid limits', async () => {
    const subject = createSubject();
    subject.prisma.dietPlan.findMany.mockReset().mockResolvedValue([]);
    subject.prisma.nutritionPlanV2.findMany.mockReset().mockResolvedValue([]);

    await subject.service.listHistory('user-id', 25);

    expect(subject.prisma.dietPlan.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 25 }),
    );
    await expect(
      subject.service.listHistory('user-id', 101),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
