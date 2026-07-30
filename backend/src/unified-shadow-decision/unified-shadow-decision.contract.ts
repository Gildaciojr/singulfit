import type {
  CoachAdaptiveProfileCollectorInput,
  ProfileAcquisitionDecision,
} from '../context/coach-adaptive-profile-collector.contract';
import type { CoachProfileSnapshot } from '../context/coach-profile-snapshot.contract';
import type {
  ConversationGoalDecision,
  ConversationGoalPlannerInput,
} from '../context/conversation-goal-planner.contract';
import type { NutritionPlanningContext } from '../diet/v2/nutrition-planning-context.contract';
import type { NutritionPlanningStrategy } from '../diet/v2/nutrition-planning-strategy.contract';
import type {
  LongitudinalCoachingAction,
  LongitudinalCoachingDecision,
  LongitudinalCoachingInput,
} from '../longitudinal-coaching/longitudinal-coaching.contract';
import type {
  NutritionInterventionIntensity,
  NutritionPersonalizationLevel,
  NutritionReasoningResult,
  NutritionReasoningStrategy,
  NutritionRecommendedComplexity,
} from '../nutrition-reasoning/nutrition-reasoning.contract';
import type {
  WorkoutComplexityLevel,
  WorkoutInterventionIntensity,
  WorkoutProgressionDecision,
  WorkoutReasoningObjective,
  WorkoutReasoningProhibition,
  WorkoutReasoningResult,
  WorkoutReasoningStrategy,
} from '../workout-reasoning/workout-reasoning.contract';
import type {
  WorkoutArtifactType,
  WorkoutModality,
} from '../workout/v2/workout-planning-artifact.contract';
import type { WorkoutPlanningContext } from '../workout/v2/workout-planning-context.contract';
import type {
  WorkoutBlockType,
  WorkoutPlanningStrategy,
} from '../workout/v2/workout-planning-strategy.contract';

export const UNIFIED_SHADOW_ADAPTER_VERSION = '2026.07.1' as const;
export const UNIFIED_SHADOW_COMPARATOR_VERSION = '2026.07.1' as const;
export const UNIFIED_SHADOW_PIPELINE_VERSION = '2026.07.1' as const;

export const UNIFIED_SHADOW_COMPARISON_CATEGORY = {
  EXACT_MATCH: 'EXACT_MATCH',
  COMPATIBLE: 'COMPATIBLE',
  MORE_CONSERVATIVE: 'MORE_CONSERVATIVE',
  MORE_AGGRESSIVE: 'MORE_AGGRESSIVE',
  MORE_PERSONALIZED: 'MORE_PERSONALIZED',
  LESS_PERSONALIZED: 'LESS_PERSONALIZED',
  CONFLICT: 'CONFLICT',
} as const;

export type UnifiedShadowComparisonCategory =
  (typeof UNIFIED_SHADOW_COMPARISON_CATEGORY)[keyof typeof UNIFIED_SHADOW_COMPARISON_CATEGORY];

export type ShadowPersonalizationLevel = 'BASIC' | 'CONTEXTUAL' | 'HIGH';

export interface NutritionReasoningShadowStrategy {
  readonly adapterVersion: typeof UNIFIED_SHADOW_ADAPTER_VERSION;
  readonly artifactType: NutritionReasoningResult['metadata']['artifactType'];
  readonly interventionIntensity: NutritionInterventionIntensity;
  readonly complexity: NutritionRecommendedComplexity;
  readonly personalization: NutritionPersonalizationLevel;
  readonly variationPolicy: NutritionPlanningStrategy['variationPolicy'];
  readonly detailLevel: NutritionPlanningStrategy['detailLevel'];
  readonly trainingAware: boolean;
  readonly safetyRestricted: boolean;
  readonly restrictionCodes: readonly string[];
  readonly selectedStrategies: readonly NutritionReasoningStrategy[];
  readonly prohibitedStrategies: readonly NutritionReasoningStrategy[];
}

export interface WorkoutReasoningShadowStrategy {
  readonly adapterVersion: typeof UNIFIED_SHADOW_ADAPTER_VERSION;
  readonly artifactType: WorkoutArtifactType;
  readonly modality: WorkoutModality | null;
  readonly objective: WorkoutReasoningObjective;
  readonly interventionIntensity: WorkoutInterventionIntensity;
  readonly complexity: WorkoutComplexityLevel;
  readonly personalization: ShadowPersonalizationLevel;
  readonly progression: WorkoutProgressionDecision;
  readonly requiredBlocks: readonly WorkoutBlockType[];
  readonly maximumActivitiesPerSession: number;
  readonly technicalMovementsAllowed: boolean;
  readonly safetyRestricted: boolean;
  readonly constraintCodes: readonly string[];
  readonly selectedStrategies: readonly WorkoutReasoningStrategy[];
  readonly prohibitedStrategies: readonly WorkoutReasoningProhibition[];
}

export type UnifiedShadowDifferenceDimension =
  | 'ARTIFACT_TYPE'
  | 'MODALITY'
  | 'VARIATION'
  | 'DETAIL'
  | 'TRAINING_AWARE'
  | 'INTENSITY'
  | 'COMPLEXITY'
  | 'PERSONALIZATION'
  | 'PROGRESSION'
  | 'TECHNICAL_MOVEMENTS'
  | 'ACTIVITY_LIMIT'
  | 'SAFETY'
  | 'LONGITUDINAL_DECISION';

export interface UnifiedShadowDifference {
  readonly domain: 'NUTRITION' | 'WORKOUT' | 'LONGITUDINAL';
  readonly dimension: UnifiedShadowDifferenceDimension;
  readonly legacyValue: string | number | boolean | null;
  readonly shadowValue: string | number | boolean | null;
}

export interface UnifiedShadowDomainComparison {
  readonly category: UnifiedShadowComparisonCategory;
  readonly exact: boolean;
  readonly differences: readonly UnifiedShadowDifference[];
}

export interface UnifiedShadowDecisionComparison {
  readonly comparatorVersion: typeof UNIFIED_SHADOW_COMPARATOR_VERSION;
  readonly nutrition: UnifiedShadowDomainComparison | null;
  readonly workout: UnifiedShadowDomainComparison | null;
  readonly longitudinal: UnifiedShadowDomainComparison;
  readonly overallCategory: UnifiedShadowComparisonCategory;
}

export interface UnifiedShadowLatencyMetadata {
  readonly collectorMs: number;
  readonly plannerMs: number;
  readonly longitudinalMs: number;
  readonly nutritionReasoningMs: number | null;
  readonly workoutReasoningMs: number | null;
  readonly nutritionStrategyMs: number | null;
  readonly workoutStrategyMs: number | null;
  readonly adaptersMs: number;
  readonly comparatorMs: number;
  readonly totalMs: number;
}

export interface UnifiedShadowAuditMetadata {
  readonly status: 'COMPLETED';
  readonly plannerGoal: ConversationGoalDecision['goal'];
  readonly collectorShouldAsk: boolean;
  readonly overallCategory: UnifiedShadowComparisonCategory;
  readonly nutritionCategory: UnifiedShadowComparisonCategory | null;
  readonly workoutCategory: UnifiedShadowComparisonCategory | null;
  readonly longitudinalCategory: UnifiedShadowComparisonCategory;
  readonly nutritionIntensity: NutritionInterventionIntensity | null;
  readonly nutritionComplexity: NutritionRecommendedComplexity | null;
  readonly workoutIntensity: WorkoutInterventionIntensity | null;
  readonly workoutComplexity: WorkoutComplexityLevel | null;
  readonly workoutProgression: WorkoutProgressionDecision | null;
  readonly longitudinalDecision: LongitudinalCoachingAction;
  readonly differenceDimensions: readonly UnifiedShadowDifferenceDimension[];
  readonly differences: readonly UnifiedShadowDifference[];
  readonly nutritionStrategyCodes: readonly NutritionReasoningStrategy[];
  readonly workoutStrategyCodes: readonly WorkoutReasoningStrategy[];
  readonly latency: UnifiedShadowLatencyMetadata;
  readonly versions: {
    readonly adapter: typeof UNIFIED_SHADOW_ADAPTER_VERSION;
    readonly comparator: typeof UNIFIED_SHADOW_COMPARATOR_VERSION;
    readonly pipeline: typeof UNIFIED_SHADOW_PIPELINE_VERSION;
    readonly nutritionReasoning: string | null;
    readonly workoutReasoning: string | null;
    readonly longitudinalPolicy: string;
  };
}

export type UnifiedShadowFailureCode =
  | 'CONFIG_FAILED'
  | 'COLLECTOR_FAILED'
  | 'PLANNER_FAILED'
  | 'LONGITUDINAL_FAILED'
  | 'NUTRITION_REASONING_FAILED'
  | 'WORKOUT_REASONING_FAILED'
  | 'NUTRITION_STRATEGY_FAILED'
  | 'WORKOUT_STRATEGY_FAILED'
  | 'ADAPTER_FAILED'
  | 'COMPARATOR_FAILED'
  | 'AUDIT_FAILED';

export interface UnifiedShadowFailureMetadata {
  readonly status: 'FAILED';
  readonly failureCode: UnifiedShadowFailureCode;
  readonly pipelineVersion: typeof UNIFIED_SHADOW_PIPELINE_VERSION;
  readonly totalMs: number;
}

export interface UnifiedShadowNutritionInput {
  readonly planningContext: NutritionPlanningContext;
}

export interface UnifiedShadowWorkoutInput {
  readonly planningContext: WorkoutPlanningContext;
  readonly recognizedModality: WorkoutModality | null;
}

export interface UnifiedShadowDecisionPipelineInput {
  readonly operation: {
    readonly userId: string;
    readonly auditEntityId: string;
  };
  readonly snapshot: CoachProfileSnapshot;
  readonly collector: Omit<CoachAdaptiveProfileCollectorInput, 'snapshot'>;
  readonly planner: Omit<
    ConversationGoalPlannerInput,
    'snapshot' | 'adaptiveDecision' | 'completion'
  >;
  readonly longitudinal: Omit<LongitudinalCoachingInput, 'snapshot'>;
  readonly nutrition: UnifiedShadowNutritionInput | null;
  readonly workout: UnifiedShadowWorkoutInput | null;
  readonly legacyLongitudinalDecision: LongitudinalCoachingAction;
}

export interface UnifiedShadowExecutionArtifacts {
  readonly adaptiveDecision: ProfileAcquisitionDecision;
  readonly plannerDecision: ConversationGoalDecision;
  readonly longitudinalDecision: LongitudinalCoachingDecision;
  readonly nutritionReasoning: NutritionReasoningResult | null;
  readonly workoutReasoning: WorkoutReasoningResult | null;
  readonly nutritionLegacyStrategy: NutritionPlanningStrategy | null;
  readonly workoutLegacyStrategy: WorkoutPlanningStrategy | null;
  readonly nutritionShadowStrategy: NutritionReasoningShadowStrategy | null;
  readonly workoutShadowStrategy: WorkoutReasoningShadowStrategy | null;
}

export type UnifiedShadowDecisionPipelineResult =
  | Readonly<{
      status: 'SKIPPED';
      reason: 'MODE_NOT_SHADOW';
    }>
  | Readonly<{
      status: 'COMPLETED';
      artifacts: UnifiedShadowExecutionArtifacts;
      comparison: UnifiedShadowDecisionComparison;
      auditMetadata: UnifiedShadowAuditMetadata;
      auditPersisted: boolean;
    }>
  | Readonly<{
      status: 'FAILED';
      failure: UnifiedShadowFailureMetadata;
      auditPersisted: boolean;
    }>;
