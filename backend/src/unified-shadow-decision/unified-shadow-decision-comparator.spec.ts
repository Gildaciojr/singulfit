import { FitnessGoal } from '@prisma/client';
import { CONVERSATION_GOAL } from '../context/conversation-goal-planner.contract';
import { NUTRITION_ARTIFACT_TYPE } from '../diet/v2/nutrition-planning-artifact.contract';
import type { NutritionPlanningStrategy } from '../diet/v2/nutrition-planning-strategy.contract';
import type { LongitudinalCoachingDecision } from '../longitudinal-coaching/longitudinal-coaching.contract';
import type { NutritionReasoningResult } from '../nutrition-reasoning/nutrition-reasoning.contract';
import type { WorkoutReasoningResult } from '../workout-reasoning/workout-reasoning.contract';
import {
  WORKOUT_ARTIFACT_TYPE,
  WORKOUT_MODALITY,
} from '../workout/v2/workout-planning-artifact.contract';
import type { WorkoutPlanningStrategy } from '../workout/v2/workout-planning-strategy.contract';
import { NutritionReasoningShadowAdapter } from './nutrition-reasoning-shadow.adapter';
import { UnifiedShadowDecisionComparator } from './unified-shadow-decision-comparator';
import { UNIFIED_SHADOW_COMPARISON_CATEGORY } from './unified-shadow-decision.contract';
import { WorkoutReasoningShadowAdapter } from './workout-reasoning-shadow.adapter';

describe('Unified Shadow Decision adapters and comparator', () => {
  const nutritionAdapter = new NutritionReasoningShadowAdapter();
  const workoutAdapter = new WorkoutReasoningShadowAdapter();
  const comparator = new UnifiedShadowDecisionComparator();

  function nutritionReasoning(
    overrides: Partial<
      Pick<
        NutritionReasoningResult,
        | 'interventionIntensity'
        | 'personalizationLevel'
        | 'recommendedComplexity'
      >
    > & {
      readonly artifactType?: NutritionReasoningResult['metadata']['artifactType'];
      readonly safetyRestricted?: boolean;
      readonly strategyCount?: number;
    } = {},
  ): NutritionReasoningResult {
    const strategies = [
      'ENERGY_BALANCE',
      'PROTEIN_PRIORITY',
      'ROUTINE_ALIGNMENT',
      'HYDRATION_SUPPORT',
      'BEHAVIOR_ADHERENCE',
      'NUTRITION_EDUCATION',
      'FOOD_SUBSTITUTION',
      'PRACTICAL_MEALS',
    ] as const;
    return {
      prioritizedObjectives: [],
      packageDecisions: [],
      activeFactors: [],
      discardedFactors: [],
      resolvedConflicts: [],
      appliedRestrictions: [],
      selectedStrategies: strategies
        .slice(0, overrides.strategyCount ?? 0)
        .map((strategy) => ({
          strategy,
          priority: 'MEDIUM',
          sourcePackageIds: [],
          reasonCodes: [],
        })),
      prohibitedStrategies: [],
      interventionIntensity: overrides.interventionIntensity ?? 'LOW',
      personalizationLevel: overrides.personalizationLevel ?? 'BASIC',
      recommendedComplexity: overrides.recommendedComplexity ?? 'MINIMAL',
      priorities: {
        adherence: 'MEDIUM',
        performance: 'LOW',
        recovery: 'LOW',
        education: 'MEDIUM',
        practicality: 'MEDIUM',
        economy: 'LOW',
        satiety: 'LOW',
        behavior: 'MEDIUM',
      },
      metadata: {
        schemaVersion: 1,
        strategyVersion: '2026.07.1',
        knowledgeCatalogVersion: '2026.07.1',
        sourcePackageIds: [],
        conversationGoal: CONVERSATION_GOAL.GENERATE_DIET_PLAN,
        artifactType:
          overrides.artifactType ?? NUTRITION_ARTIFACT_TYPE.POINT_GUIDANCE,
        deterministic: true,
        safetyRestricted: overrides.safetyRestricted ?? false,
      },
    };
  }

  function workoutReasoning(
    overrides: Partial<
      Pick<
        WorkoutReasoningResult,
        | 'interventionIntensity'
        | 'authorizedComplexity'
        | 'progressionDecision'
        | 'primaryObjective'
      >
    > & {
      readonly modality?: WorkoutReasoningResult['modality']['resolved'];
      readonly artifactType?: WorkoutReasoningResult['metadata']['artifactType'];
      readonly safetyRestricted?: boolean;
      readonly factorCount?: number;
      readonly experience?: WorkoutReasoningResult['metadata']['experience'];
    } = {},
  ): WorkoutReasoningResult {
    return {
      primaryObjective: overrides.primaryObjective ?? 'MAINTENANCE',
      secondaryObjectives: [],
      modality: {
        requested: overrides.modality ?? WORKOUT_MODALITY.GENERAL_FITNESS,
        profile: overrides.modality ?? WORKOUT_MODALITY.GENERAL_FITNESS,
        resolved: overrides.modality ?? WORKOUT_MODALITY.GENERAL_FITNESS,
        status: 'CONFIRMED',
        requiresConfirmation: false,
      },
      knowledgeDecisions: [],
      activeFactors: Array.from(
        { length: overrides.factorCount ?? 0 },
        (_item, index) => ({
          packageId: 'adherence' as const,
          factorCode: `FACTOR_${index}`,
          polarity: 'POSITIVE' as const,
          priority: 'MEDIUM' as const,
        }),
      ),
      discardedFactors: [],
      resolvedConflicts: [],
      appliedConstraints: [],
      selectedStrategies: [],
      prohibitedStrategies: [],
      interventionIntensity: overrides.interventionIntensity ?? 'LOW',
      authorizedComplexity: overrides.authorizedComplexity ?? 'MINIMAL',
      progressionDecision: overrides.progressionDecision ?? 'MAINTAIN',
      priorities: {
        safety: 'LOW',
        technique: 'MEDIUM',
        adherence: 'MEDIUM',
        motivation: 'LOW',
        education: 'MEDIUM',
        strength: 'LOW',
        hypertrophy: 'LOW',
        endurance: 'LOW',
        conditioning: 'LOW',
        mobility: 'LOW',
        recovery: 'LOW',
        progression: 'MEDIUM',
        practicality: 'MEDIUM',
        equipment: 'LOW',
        environment: 'LOW',
      },
      rationaleCodes: [],
      metadata: {
        schemaVersion: 1,
        strategyVersion: '2026.07.1',
        knowledgeSchemaVersion: 1,
        knowledgeCatalogVersion: '2026.07.1',
        sourcePackageIds: [],
        conversationGoal: CONVERSATION_GOAL.GENERATE_WORKOUT_PLAN,
        artifactType:
          overrides.artifactType ?? WORKOUT_ARTIFACT_TYPE.POINT_GUIDANCE,
        requestedModality:
          overrides.modality ?? WORKOUT_MODALITY.GENERAL_FITNESS,
        experience: overrides.experience ?? 'BEGINNER',
        deterministic: true,
        safetyRestricted: overrides.safetyRestricted ?? false,
      },
    };
  }

  function nutritionLegacy(
    overrides: Partial<NutritionPlanningStrategy> = {},
  ): NutritionPlanningStrategy {
    return {
      schemaVersion: 2,
      artifactType: NUTRITION_ARTIFACT_TYPE.POINT_GUIDANCE,
      objective: { status: 'CONFIRMED', value: FitnessGoal.MAINTENANCE },
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
      variationPolicy: 'MINIMAL',
      detailLevel: 'BRIEF',
      factors: [],
      ...overrides,
    };
  }

  function workoutLegacy(
    overrides: Partial<WorkoutPlanningStrategy> = {},
  ): WorkoutPlanningStrategy {
    return {
      schemaVersion: 2,
      artifactType: WORKOUT_ARTIFACT_TYPE.POINT_GUIDANCE,
      modality: WORKOUT_MODALITY.GENERAL_FITNESS,
      objective: { status: 'NOT_SET' },
      experience: { status: 'NOT_SET' },
      sessionCount: 0,
      sessionDurationMinutes: { status: 'NOT_SET' },
      environment: { status: 'NOT_SET' },
      authorizedEquipment: [],
      requiredBlocks: [],
      optionalBlocks: [],
      maximumActivitiesPerSession: 4,
      technicalMovementsAllowed: false,
      intensityPolicy: {
        scale: 'RPE',
        minimum: 3,
        maximum: 5,
        qualitativeLevel: 'LIGHT',
        exactLoadAllowed: false,
        exactPaceAllowed: false,
        exactPowerAllowed: false,
      },
      progressionPolicy: {
        initialState: 'MAINTAIN',
        maximumWeeklyIncreasePercent: 5,
        simultaneousVariablesAllowed: 1,
        requiresCompletedSessions: true,
        blocksOnSafetyFlag: true,
      },
      appliedConstraints: [],
      personalizationFactors: [],
      ...overrides,
    };
  }

  function longitudinal(
    decision: LongitudinalCoachingDecision['decision'] = 'KEEP_PLAN',
    safetyCritical = false,
  ): LongitudinalCoachingDecision {
    return {
      currentState: 'STABLE',
      trends: {
        weight: 'STABLE',
        frequency: 'STABLE',
        adherence: 'STABLE',
        hydration: 'STABLE',
        nutrition: 'STABLE',
        training: 'STABLE',
        evolution: 'STABLE',
      },
      stability: 'STABLE',
      progress: {
        trend: 'STABLE',
        evidenceStrength: 'SUFFICIENT',
        observationSpanDays: 30,
        observationCount: 6,
      },
      regression: { detected: false, severity: null },
      relapse: { detected: false, severity: null },
      adherence: { level: 'HIGH', score: 85, trend: 'STABLE' },
      motivation: { level: 'HIGH', trend: 'STABLE' },
      needs: {
        adaptation: false,
        reassessment: decision === 'REVIEW',
        deload: decision === 'DELOAD',
        maintenance: decision === 'KEEP_PLAN',
        information: decision === 'ASK_INFORMATION',
      },
      decision,
      priorities: {
        nutrition: 'MEDIUM',
        training: 'MEDIUM',
        behavioral: 'MEDIUM',
        safety: safetyCritical ? 'CRITICAL' : 'LOW',
      },
      risks: [],
      interventionIntensity: safetyCritical ? 'RESTRICTED' : 'LOW',
      rationaleCodes: ['DETERMINISTIC_POLICY'],
      metadata: {
        schemaVersion: 1,
        policyVersion: '2026.07.1',
        referenceDate: '2026-07-16T12:00:00.000Z',
        historyObservations: 4,
        progressObservations: 3,
        checkInObservations: 3,
        activePlans: 2,
        previousDecisions: 0,
        deterministic: true,
      },
    };
  }

  function compare(
    input: {
      readonly nutritionLegacy?: NutritionPlanningStrategy;
      readonly nutritionReasoning?: NutritionReasoningResult;
      readonly workoutLegacy?: WorkoutPlanningStrategy;
      readonly workoutReasoning?: WorkoutReasoningResult;
      readonly longitudinalLegacy?: LongitudinalCoachingDecision['decision'];
      readonly longitudinalShadow?: LongitudinalCoachingDecision;
    } = {},
  ) {
    return comparator.compare({
      nutritionLegacy: input.nutritionLegacy ?? nutritionLegacy(),
      nutritionShadow: nutritionAdapter.adapt(
        input.nutritionReasoning ?? nutritionReasoning(),
      ),
      workoutLegacy: input.workoutLegacy ?? workoutLegacy(),
      workoutShadow: workoutAdapter.adapt(
        input.workoutReasoning ?? workoutReasoning(),
      ),
      longitudinalLegacy: input.longitudinalLegacy ?? 'KEEP_PLAN',
      longitudinalShadow: input.longitudinalShadow ?? longitudinal(),
    });
  }

  it('produces an exact match when all comparable dimensions agree', () => {
    const result = compare();

    expect(result.nutrition?.category).toBe(
      UNIFIED_SHADOW_COMPARISON_CATEGORY.EXACT_MATCH,
    );
    expect(result.workout?.category).toBe(
      UNIFIED_SHADOW_COMPARISON_CATEGORY.EXACT_MATCH,
    );
    expect(result.longitudinal.category).toBe(
      UNIFIED_SHADOW_COMPARISON_CATEGORY.EXACT_MATCH,
    );
    expect(result.overallCategory).toBe(
      UNIFIED_SHADOW_COMPARISON_CATEGORY.EXACT_MATCH,
    );
  });

  it('classifies a less intense and less complex nutrition strategy as conservative', () => {
    const result = compare({
      nutritionLegacy: nutritionLegacy({
        detailLevel: 'DETAILED',
        variationPolicy: 'WEEKLY',
      }),
    });

    expect(result.nutrition?.category).toBe(
      UNIFIED_SHADOW_COMPARISON_CATEGORY.MORE_CONSERVATIVE,
    );
  });

  it('classifies a higher intensity and complexity as more aggressive', () => {
    const result = compare({
      nutritionReasoning: nutritionReasoning({
        interventionIntensity: 'HIGH',
        recommendedComplexity: 'DETAILED',
      }),
    });

    expect(result.nutrition?.category).toBe(
      UNIFIED_SHADOW_COMPARISON_CATEGORY.MORE_AGGRESSIVE,
    );
  });

  it('detects a safety conflict', () => {
    const result = compare({
      nutritionReasoning: nutritionReasoning({ safetyRestricted: true }),
    });

    expect(result.nutrition?.category).toBe(
      UNIFIED_SHADOW_COMPARISON_CATEGORY.CONFLICT,
    );
  });

  it('compares personalization independently from intensity and complexity', () => {
    const result = compare({
      nutritionReasoning: nutritionReasoning({
        personalizationLevel: 'HIGH',
      }),
    });

    expect(result.nutrition?.category).toBe(
      UNIFIED_SHADOW_COMPARISON_CATEGORY.MORE_PERSONALIZED,
    );
  });

  it('detects workout modality conflicts', () => {
    const result = compare({
      workoutReasoning: workoutReasoning({
        modality: WORKOUT_MODALITY.RUNNING,
      }),
    });

    expect(result.workout?.category).toBe(
      UNIFIED_SHADOW_COMPARISON_CATEGORY.CONFLICT,
    );
  });

  it('compares workout intensity and complexity deterministically', () => {
    const result = compare({
      workoutReasoning: workoutReasoning({
        interventionIntensity: 'HIGH',
        authorizedComplexity: 'ADVANCED',
      }),
    });

    expect(result.workout?.category).toBe(
      UNIFIED_SHADOW_COMPARISON_CATEGORY.MORE_AGGRESSIVE,
    );
    expect(result.workout?.differences.map((item) => item.dimension)).toEqual(
      expect.arrayContaining(['INTENSITY', 'COMPLEXITY', 'ACTIVITY_LIMIT']),
    );
  });

  it('compares progression independently', () => {
    const conservative = compare({
      workoutReasoning: workoutReasoning({ progressionDecision: 'DELOAD' }),
    });
    const aggressive = compare({
      workoutReasoning: workoutReasoning({ progressionDecision: 'PROGRESS' }),
    });

    expect(conservative.workout?.category).toBe(
      UNIFIED_SHADOW_COMPARISON_CATEGORY.MORE_CONSERVATIVE,
    );
    expect(aggressive.workout?.category).toBe(
      UNIFIED_SHADOW_COMPARISON_CATEGORY.MORE_AGGRESSIVE,
    );
  });

  it('compares longitudinal reductions and increases', () => {
    const conservative = compare({
      longitudinalShadow: longitudinal('REDUCE'),
    });
    const aggressive = compare({
      longitudinalShadow: longitudinal('INCREASE'),
    });

    expect(conservative.longitudinal.category).toBe(
      UNIFIED_SHADOW_COMPARISON_CATEGORY.MORE_CONSERVATIVE,
    );
    expect(aggressive.longitudinal.category).toBe(
      UNIFIED_SHADOW_COMPARISON_CATEGORY.MORE_AGGRESSIVE,
    );
  });

  it('treats disagreement with a critical longitudinal safety decision as conflict', () => {
    const result = compare({
      longitudinalLegacy: 'KEEP_PLAN',
      longitudinalShadow: longitudinal('REVIEW', true),
    });

    expect(result.longitudinal.category).toBe(
      UNIFIED_SHADOW_COMPARISON_CATEGORY.CONFLICT,
    );
  });

  it('is deterministic, deeply frozen and does not mutate inputs', () => {
    const legacy = nutritionLegacy();
    const reasoning = nutritionReasoning({ strategyCount: 3 });
    const before = JSON.stringify({ legacy, reasoning });
    const first = compare({
      nutritionLegacy: legacy,
      nutritionReasoning: reasoning,
    });
    const second = compare({
      nutritionLegacy: legacy,
      nutritionReasoning: reasoning,
    });

    expect(first).toEqual(second);
    expect(JSON.stringify({ legacy, reasoning })).toBe(before);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.nutrition)).toBe(true);
    expect(Object.isFrozen(first.nutrition?.differences)).toBe(true);
    expect(() =>
      Object.defineProperty(first, 'overallCategory', { value: 'CONFLICT' }),
    ).toThrow();
  });
});
