import type { NutritionPlanningStrategy } from '../diet/v2/nutrition-planning-strategy.contract';
import type {
  LongitudinalCoachingAction,
  LongitudinalCoachingDecision,
} from '../longitudinal-coaching/longitudinal-coaching.contract';
import type { WorkoutPlanningStrategy } from '../workout/v2/workout-planning-strategy.contract';
import {
  NutritionReasoningShadowStrategy,
  ShadowPersonalizationLevel,
  UNIFIED_SHADOW_COMPARISON_CATEGORY,
  UNIFIED_SHADOW_COMPARATOR_VERSION,
  UnifiedShadowComparisonCategory,
  UnifiedShadowDecisionComparison,
  UnifiedShadowDifference,
  UnifiedShadowDifferenceDimension,
  UnifiedShadowDomainComparison,
  WorkoutReasoningShadowStrategy,
} from './unified-shadow-decision.contract';

export interface UnifiedShadowDecisionComparatorInput {
  readonly nutritionLegacy: NutritionPlanningStrategy | null;
  readonly nutritionShadow: NutritionReasoningShadowStrategy | null;
  readonly workoutLegacy: WorkoutPlanningStrategy | null;
  readonly workoutShadow: WorkoutReasoningShadowStrategy | null;
  readonly longitudinalLegacy: LongitudinalCoachingAction;
  readonly longitudinalShadow: LongitudinalCoachingDecision;
}

export class UnifiedShadowDecisionComparator {
  compare(
    input: UnifiedShadowDecisionComparatorInput,
  ): UnifiedShadowDecisionComparison {
    const nutrition =
      input.nutritionLegacy && input.nutritionShadow
        ? this.compareNutrition(input.nutritionLegacy, input.nutritionShadow)
        : null;
    const workout =
      input.workoutLegacy && input.workoutShadow
        ? this.compareWorkout(input.workoutLegacy, input.workoutShadow)
        : null;
    const longitudinal = this.compareLongitudinal(
      input.longitudinalLegacy,
      input.longitudinalShadow,
    );

    return deepFreeze({
      comparatorVersion: UNIFIED_SHADOW_COMPARATOR_VERSION,
      nutrition,
      workout,
      longitudinal,
      overallCategory: this.overallCategory([
        nutrition?.category,
        workout?.category,
        longitudinal.category,
      ]),
    });
  }

  private compareNutrition(
    legacy: NutritionPlanningStrategy,
    shadow: NutritionReasoningShadowStrategy,
  ): UnifiedShadowDomainComparison {
    const differences: UnifiedShadowDifference[] = [];
    const legacyComplexity = this.nutritionComplexity(legacy.detailLevel);
    const legacyIntensity = this.nutritionIntensity(legacy.detailLevel);
    const legacyPersonalization = this.personalization(
      legacy.factors.length +
        legacy.appliedConstraintCodes.length +
        legacy.preferredFoods.length +
        legacy.excludedFoods.length,
    );
    const legacySafety = legacy.appliedConstraintCodes.length > 0;

    this.difference(
      differences,
      'NUTRITION',
      'ARTIFACT_TYPE',
      legacy.artifactType,
      shadow.artifactType,
    );
    this.difference(
      differences,
      'NUTRITION',
      'VARIATION',
      legacy.variationPolicy,
      shadow.variationPolicy,
    );
    this.difference(
      differences,
      'NUTRITION',
      'DETAIL',
      legacy.detailLevel,
      shadow.detailLevel,
    );
    this.difference(
      differences,
      'NUTRITION',
      'TRAINING_AWARE',
      legacy.trainingAware,
      shadow.trainingAware,
    );
    this.difference(
      differences,
      'NUTRITION',
      'INTENSITY',
      legacyIntensity,
      shadow.interventionIntensity,
    );
    this.difference(
      differences,
      'NUTRITION',
      'COMPLEXITY',
      legacyComplexity,
      shadow.complexity,
    );
    this.difference(
      differences,
      'NUTRITION',
      'PERSONALIZATION',
      legacyPersonalization,
      shadow.personalization,
    );
    this.difference(
      differences,
      'NUTRITION',
      'SAFETY',
      legacySafety,
      shadow.safetyRestricted,
    );

    const conflict =
      legacy.artifactType !== shadow.artifactType ||
      (shadow.safetyRestricted && !legacySafety);
    const category = this.directionCategory({
      differences,
      conflict,
      legacyIntensity: this.nutritionIntensityRank(legacyIntensity),
      shadowIntensity: this.nutritionIntensityRank(
        shadow.interventionIntensity,
      ),
      legacyComplexity: this.nutritionComplexityRank(legacyComplexity),
      shadowComplexity: this.nutritionComplexityRank(shadow.complexity),
      legacyPersonalization: this.personalizationRank(legacyPersonalization),
      shadowPersonalization: this.personalizationRank(shadow.personalization),
    });
    return deepFreeze({
      category,
      exact: category === UNIFIED_SHADOW_COMPARISON_CATEGORY.EXACT_MATCH,
      differences,
    });
  }

  private compareWorkout(
    legacy: WorkoutPlanningStrategy,
    shadow: WorkoutReasoningShadowStrategy,
  ): UnifiedShadowDomainComparison {
    const differences: UnifiedShadowDifference[] = [];
    const legacyComplexity = this.workoutComplexity(legacy);
    const legacyIntensity = legacy.intensityPolicy.qualitativeLevel;
    const shadowIntensity = this.workoutIntensity(shadow.interventionIntensity);
    const legacyPersonalization = this.personalization(
      legacy.personalizationFactors.length + legacy.appliedConstraints.length,
    );
    const legacySafety =
      legacy.progressionPolicy.initialState === 'REASSESS' ||
      legacy.progressionPolicy.initialState === 'PAUSE';

    this.difference(
      differences,
      'WORKOUT',
      'ARTIFACT_TYPE',
      legacy.artifactType,
      shadow.artifactType,
    );
    this.difference(
      differences,
      'WORKOUT',
      'MODALITY',
      legacy.modality,
      shadow.modality,
    );
    this.difference(
      differences,
      'WORKOUT',
      'INTENSITY',
      legacyIntensity,
      shadowIntensity,
    );
    this.difference(
      differences,
      'WORKOUT',
      'COMPLEXITY',
      legacyComplexity,
      shadow.complexity,
    );
    this.difference(
      differences,
      'WORKOUT',
      'PERSONALIZATION',
      legacyPersonalization,
      shadow.personalization,
    );
    this.difference(
      differences,
      'WORKOUT',
      'PROGRESSION',
      legacy.progressionPolicy.initialState,
      shadow.progression,
    );
    this.difference(
      differences,
      'WORKOUT',
      'TECHNICAL_MOVEMENTS',
      legacy.technicalMovementsAllowed,
      shadow.technicalMovementsAllowed,
    );
    this.difference(
      differences,
      'WORKOUT',
      'ACTIVITY_LIMIT',
      legacy.maximumActivitiesPerSession,
      shadow.maximumActivitiesPerSession,
    );
    this.difference(
      differences,
      'WORKOUT',
      'SAFETY',
      legacySafety,
      shadow.safetyRestricted,
    );

    const conflict =
      legacy.artifactType !== shadow.artifactType ||
      (shadow.modality !== null && legacy.modality !== shadow.modality) ||
      (shadow.safetyRestricted && !legacySafety);
    const category = this.directionCategory({
      differences,
      conflict,
      legacyIntensity: this.workoutIntensityRank(legacyIntensity),
      shadowIntensity: this.workoutIntensityRank(shadowIntensity),
      legacyComplexity: this.workoutComplexityRank(legacyComplexity),
      shadowComplexity: this.workoutComplexityRank(shadow.complexity),
      legacyPersonalization: this.personalizationRank(legacyPersonalization),
      shadowPersonalization: this.personalizationRank(shadow.personalization),
      legacyProgression: this.progressionRank(
        legacy.progressionPolicy.initialState,
      ),
      shadowProgression: this.progressionRank(shadow.progression),
    });
    return deepFreeze({
      category,
      exact: category === UNIFIED_SHADOW_COMPARISON_CATEGORY.EXACT_MATCH,
      differences,
    });
  }

  private compareLongitudinal(
    legacy: LongitudinalCoachingAction,
    shadow: LongitudinalCoachingDecision,
  ): UnifiedShadowDomainComparison {
    const differences: UnifiedShadowDifference[] = [];
    this.difference(
      differences,
      'LONGITUDINAL',
      'LONGITUDINAL_DECISION',
      legacy,
      shadow.decision,
    );
    const safetyCritical = shadow.priorities.safety === 'CRITICAL';
    const category =
      differences.length === 0
        ? UNIFIED_SHADOW_COMPARISON_CATEGORY.EXACT_MATCH
        : safetyCritical && legacy !== 'REVIEW'
          ? UNIFIED_SHADOW_COMPARISON_CATEGORY.CONFLICT
          : this.longitudinalCategory(legacy, shadow.decision);
    return deepFreeze({
      category,
      exact: category === UNIFIED_SHADOW_COMPARISON_CATEGORY.EXACT_MATCH,
      differences,
    });
  }

  private directionCategory(input: {
    readonly differences: readonly UnifiedShadowDifference[];
    readonly conflict: boolean;
    readonly legacyIntensity: number;
    readonly shadowIntensity: number;
    readonly legacyComplexity: number;
    readonly shadowComplexity: number;
    readonly legacyPersonalization: number;
    readonly shadowPersonalization: number;
    readonly legacyProgression?: number;
    readonly shadowProgression?: number;
  }): UnifiedShadowComparisonCategory {
    if (input.conflict) return UNIFIED_SHADOW_COMPARISON_CATEGORY.CONFLICT;
    if (input.differences.length === 0) {
      return UNIFIED_SHADOW_COMPARISON_CATEGORY.EXACT_MATCH;
    }

    const legacyProgression = input.legacyProgression ?? 0;
    const shadowProgression = input.shadowProgression ?? 0;
    const conservative =
      input.shadowIntensity < input.legacyIntensity ||
      input.shadowComplexity < input.legacyComplexity ||
      shadowProgression < legacyProgression;
    const aggressive =
      input.shadowIntensity > input.legacyIntensity ||
      input.shadowComplexity > input.legacyComplexity ||
      shadowProgression > legacyProgression;

    if (conservative && !aggressive) {
      return UNIFIED_SHADOW_COMPARISON_CATEGORY.MORE_CONSERVATIVE;
    }
    if (aggressive && !conservative) {
      return UNIFIED_SHADOW_COMPARISON_CATEGORY.MORE_AGGRESSIVE;
    }
    if (
      input.shadowPersonalization > input.legacyPersonalization &&
      !conservative &&
      !aggressive
    ) {
      return UNIFIED_SHADOW_COMPARISON_CATEGORY.MORE_PERSONALIZED;
    }
    if (
      input.shadowPersonalization < input.legacyPersonalization &&
      !conservative &&
      !aggressive
    ) {
      return UNIFIED_SHADOW_COMPARISON_CATEGORY.LESS_PERSONALIZED;
    }
    return UNIFIED_SHADOW_COMPARISON_CATEGORY.COMPATIBLE;
  }

  private longitudinalCategory(
    legacy: LongitudinalCoachingAction,
    shadow: LongitudinalCoachingAction,
  ): UnifiedShadowComparisonCategory {
    const legacyRank = this.longitudinalRank(legacy);
    const shadowRank = this.longitudinalRank(shadow);
    if (shadowRank < legacyRank) {
      return UNIFIED_SHADOW_COMPARISON_CATEGORY.MORE_CONSERVATIVE;
    }
    if (shadowRank > legacyRank) {
      return UNIFIED_SHADOW_COMPARISON_CATEGORY.MORE_AGGRESSIVE;
    }
    return UNIFIED_SHADOW_COMPARISON_CATEGORY.COMPATIBLE;
  }

  private overallCategory(
    categories: readonly (UnifiedShadowComparisonCategory | undefined)[],
  ): UnifiedShadowComparisonCategory {
    const values = categories.filter(
      (item): item is UnifiedShadowComparisonCategory => item !== undefined,
    );
    const precedence: readonly UnifiedShadowComparisonCategory[] = [
      UNIFIED_SHADOW_COMPARISON_CATEGORY.CONFLICT,
      UNIFIED_SHADOW_COMPARISON_CATEGORY.MORE_AGGRESSIVE,
      UNIFIED_SHADOW_COMPARISON_CATEGORY.MORE_CONSERVATIVE,
      UNIFIED_SHADOW_COMPARISON_CATEGORY.MORE_PERSONALIZED,
      UNIFIED_SHADOW_COMPARISON_CATEGORY.LESS_PERSONALIZED,
      UNIFIED_SHADOW_COMPARISON_CATEGORY.COMPATIBLE,
      UNIFIED_SHADOW_COMPARISON_CATEGORY.EXACT_MATCH,
    ];
    return (
      precedence.find((category) => values.includes(category)) ??
      UNIFIED_SHADOW_COMPARISON_CATEGORY.EXACT_MATCH
    );
  }

  private difference(
    target: UnifiedShadowDifference[],
    domain: UnifiedShadowDifference['domain'],
    dimension: UnifiedShadowDifferenceDimension,
    legacyValue: string | number | boolean | null,
    shadowValue: string | number | boolean | null,
  ): void {
    if (legacyValue !== shadowValue) {
      target.push({ domain, dimension, legacyValue, shadowValue });
    }
  }

  private nutritionComplexity(
    detail: NutritionPlanningStrategy['detailLevel'],
  ): NutritionReasoningShadowStrategy['complexity'] {
    return detail === 'BRIEF'
      ? 'MINIMAL'
      : detail === 'DETAILED'
        ? 'DETAILED'
        : 'MODERATE';
  }

  private nutritionIntensity(
    detail: NutritionPlanningStrategy['detailLevel'],
  ): NutritionReasoningShadowStrategy['interventionIntensity'] {
    return detail === 'BRIEF'
      ? 'LOW'
      : detail === 'DETAILED'
        ? 'HIGH'
        : 'MODERATE';
  }

  private workoutComplexity(
    strategy: WorkoutPlanningStrategy,
  ): WorkoutReasoningShadowStrategy['complexity'] {
    const count = strategy.maximumActivitiesPerSession;
    if (count <= 4) return 'MINIMAL';
    if (count <= 6) return 'SIMPLE';
    if (count <= 8) return 'STANDARD';
    if (count <= 10) return 'DETAILED';
    return 'ADVANCED';
  }

  private workoutIntensity(
    intensity: WorkoutReasoningShadowStrategy['interventionIntensity'],
  ):
    | WorkoutPlanningStrategy['intensityPolicy']['qualitativeLevel']
    | 'BLOCKED' {
    if (intensity === 'BLOCKED') return 'BLOCKED';
    if (intensity === 'RECOVERY' || intensity === 'LOW') return 'LIGHT';
    if (intensity === 'MODERATE') return 'MODERATE';
    return 'HIGH';
  }

  private personalization(score: number): ShadowPersonalizationLevel {
    return score >= 8 ? 'HIGH' : score >= 3 ? 'CONTEXTUAL' : 'BASIC';
  }

  private personalizationRank(level: ShadowPersonalizationLevel): number {
    return level === 'BASIC' ? 1 : level === 'CONTEXTUAL' ? 2 : 3;
  }

  private nutritionIntensityRank(value: string): number {
    return value === 'RESTRICTED'
      ? 0
      : value === 'LOW'
        ? 1
        : value === 'MODERATE'
          ? 2
          : 3;
  }

  private nutritionComplexityRank(value: string): number {
    return value === 'MINIMAL'
      ? 1
      : value === 'SIMPLE'
        ? 2
        : value === 'MODERATE'
          ? 3
          : 4;
  }

  private workoutIntensityRank(value: string): number {
    return value === 'BLOCKED'
      ? 0
      : value === 'LIGHT'
        ? 1
        : value === 'MODERATE'
          ? 2
          : 3;
  }

  private workoutComplexityRank(value: string): number {
    return value === 'RESTRICTED'
      ? 0
      : value === 'MINIMAL'
        ? 1
        : value === 'SIMPLE'
          ? 2
          : value === 'STANDARD'
            ? 3
            : value === 'DETAILED'
              ? 4
              : 5;
  }

  private progressionRank(value: string): number {
    return value === 'PAUSE'
      ? 0
      : value === 'REGRESS' || value === 'DELOAD' || value === 'REASSESS'
        ? 1
        : value === 'MAINTAIN'
          ? 2
          : 3;
  }

  private longitudinalRank(value: LongitudinalCoachingAction): number {
    const ranks: Readonly<Record<LongitudinalCoachingAction, number>> =
      Object.freeze({
        ASK_INFORMATION: 0,
        WAIT: 0,
        REVIEW: 1,
        DELOAD: 1,
        REDUCE: 1,
        KEEP_PLAN: 2,
        ADAPT_PLAN: 3,
        INCREASE: 4,
      });
    return ranks[value];
  }
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}
