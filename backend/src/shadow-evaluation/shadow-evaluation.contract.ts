import type {
  ProfileAcquisitionField,
  ProfileAcquisitionIntent,
} from '../context/coach-adaptive-profile-collector.contract';
import type {
  CoachProfileCompletionState,
  CoachProfileField,
} from '../context/coach-profile-snapshot.contract';
import type {
  ConversationGoal,
  ConversationRecognizedIntent,
} from '../context/conversation-goal-planner.contract';
import type {
  LongitudinalCoachingAction,
  LongitudinalCoachingState,
} from '../longitudinal-coaching/longitudinal-coaching.contract';
import type {
  NutritionInterventionIntensity,
  NutritionPersonalizationLevel,
  NutritionReasoningPriority,
  NutritionReasoningStrategy,
  NutritionRecommendedComplexity,
} from '../nutrition-reasoning/nutrition-reasoning.contract';
import type {
  UnifiedShadowComparisonCategory,
  UnifiedShadowDifferenceDimension,
} from '../unified-shadow-decision/unified-shadow-decision.contract';
import type {
  WorkoutComplexityLevel,
  WorkoutInterventionIntensity,
  WorkoutProgressionDecision,
  WorkoutReasoningPriority,
  WorkoutReasoningProhibition,
  WorkoutReasoningStrategy,
} from '../workout-reasoning/workout-reasoning.contract';
import type { WorkoutModality } from '../workout/v2/workout-planning-artifact.contract';
import type { ShadowObservationEnvelope } from './shadow-observation-envelope.contract';

export const SHADOW_EVALUATION_SCHEMA_VERSION = 1 as const;
export const SHADOW_EVALUATION_PLATFORM_VERSION = '2026.07.1' as const;

export const SHADOW_SCORECARD_FORMULAS = Object.freeze({
  coverage:
    'available required snapshot fields / total required snapshot fields * 100',
  agreement:
    'EXACT_MATCH or COMPATIBLE domain comparisons / available domain comparisons * 100',
  safety:
    'safety signals with a restrictive shadow response / total safety signals * 100; 100 when no signal exists',
  consistency:
    'non-CONFLICT domain comparisons / available domain comparisons * 100',
  determinism:
    'deterministic component outputs / observed deterministic component outputs * 100',
  personalization:
    'arithmetic mean of normalized Nutrition and Workout personalization levels',
} as const);

export type ShadowEvaluationRunInput = ShadowObservationEnvelope;

export interface ShadowCollectorMetrics {
  readonly intent: ProfileAcquisitionIntent;
  readonly completionState: CoachProfileCompletionState;
  readonly collectedFields: readonly CoachProfileField[];
  readonly pendingFields: readonly CoachProfileField[];
  readonly unknownFields: readonly ProfileAcquisitionField[];
  readonly confirmationFields: readonly (
    | CoachProfileField
    | ProfileAcquisitionField
  )[];
  readonly totalRequiredFields: number;
  readonly availableRequiredFields: number;
  readonly completionRate: number;
  readonly unknownRate: number;
  readonly confirmationRate: number;
  readonly estimatedQuestionsRequired: number;
  readonly snapshotCoverageRate: number;
  readonly shouldAsk: boolean;
}

export interface ShadowPlannerMetrics {
  readonly recognizedIntent: ConversationRecognizedIntent;
  readonly selectedGoal: ConversationGoal;
  readonly targetPlan: 'DIET' | 'WORKOUT' | 'BOTH' | null;
  readonly revision: boolean;
  readonly informationRequest: boolean;
  readonly planRequest: boolean;
  readonly canExecute: boolean;
}

export interface ShadowPriorityMetric<TPriority extends string> {
  readonly name: string;
  readonly priority: TPriority;
}

export interface ShadowNutritionMetrics {
  readonly usedKnowledgePackages: readonly string[];
  readonly discardedKnowledgePackages: readonly string[];
  readonly conflicts: readonly string[];
  readonly priorities: readonly ShadowPriorityMetric<NutritionReasoningPriority>[];
  readonly intensity: NutritionInterventionIntensity;
  readonly complexity: NutritionRecommendedComplexity;
  readonly personalization: NutritionPersonalizationLevel;
  readonly strategies: readonly NutritionReasoningStrategy[];
  readonly prohibitedStrategies: readonly NutritionReasoningStrategy[];
  readonly safetyRestricted: boolean;
}

export interface ShadowWorkoutMetrics {
  readonly modality: WorkoutModality | null;
  readonly usedKnowledgePackages: readonly string[];
  readonly discardedKnowledgePackages: readonly string[];
  readonly conflicts: readonly string[];
  readonly priorities: readonly ShadowPriorityMetric<WorkoutReasoningPriority>[];
  readonly intensity: WorkoutInterventionIntensity;
  readonly complexity: WorkoutComplexityLevel;
  readonly progression: WorkoutProgressionDecision;
  readonly regression: boolean;
  readonly deload: boolean;
  readonly recovery: boolean;
  readonly strategies: readonly WorkoutReasoningStrategy[];
  readonly prohibitedStrategies: readonly WorkoutReasoningProhibition[];
  readonly safetyRestricted: boolean;
}

export interface ShadowLongitudinalMetrics {
  readonly state: LongitudinalCoachingState;
  readonly decision: LongitudinalCoachingAction;
  readonly safetyPriority: string;
  readonly interventionIntensity: string;
  readonly riskCategories: readonly string[];
}

export interface ShadowComparatorMetrics {
  readonly overallCategory: UnifiedShadowComparisonCategory;
  readonly nutritionCategory: UnifiedShadowComparisonCategory | null;
  readonly workoutCategory: UnifiedShadowComparisonCategory | null;
  readonly longitudinalCategory: UnifiedShadowComparisonCategory;
  readonly agreementRate: number;
  readonly divergenceDimensions: readonly UnifiedShadowDifferenceDimension[];
  readonly modalityDivergence: boolean;
  readonly objectiveDivergence: boolean;
  readonly intensityDivergence: boolean;
  readonly complexityDivergence: boolean;
  readonly longitudinalDivergence: boolean;
}

export type ShadowSafetyCategory =
  | 'SAFETY_BLOCKED'
  | 'SAFETY_CRITICAL'
  | 'MANDATORY_REVIEW'
  | 'MANDATORY_DELOAD'
  | 'PAUSE'
  | 'CLINICAL_CONTEXT';

export interface ShadowSafetyMetrics {
  readonly categories: readonly ShadowSafetyCategory[];
  readonly blocked: boolean;
  readonly critical: boolean;
  readonly mandatoryReview: boolean;
  readonly mandatoryDeload: boolean;
  readonly paused: boolean;
  readonly clinicalContext: boolean;
  readonly signalCount: number;
  readonly restrictiveResponseCount: number;
}

export interface ShadowDescriptiveStatistics {
  readonly count: number;
  readonly mean: number;
  readonly median: number;
  readonly minimum: number;
  readonly maximum: number;
}

export interface ShadowComponentMetrics {
  readonly collector: ShadowDescriptiveStatistics;
  readonly planner: ShadowDescriptiveStatistics;
  readonly longitudinal: ShadowDescriptiveStatistics;
  readonly nutrition: ShadowDescriptiveStatistics | null;
  readonly workout: ShadowDescriptiveStatistics | null;
  readonly adapters: ShadowDescriptiveStatistics;
  readonly comparator: ShadowDescriptiveStatistics;
  readonly total: ShadowDescriptiveStatistics;
}

export interface ShadowEvaluationScorecard {
  readonly coverageScore: number;
  readonly agreementScore: number;
  readonly safetyScore: number;
  readonly consistencyScore: number;
  readonly determinismScore: number;
  readonly personalizationScore: number;
}

export interface ShadowEvaluationSummary {
  readonly complete: boolean;
  readonly observedDomains: number;
  readonly conflictCount: number;
  readonly divergenceCount: number;
  readonly safetySignalCount: number;
}

export interface ShadowEvaluationReport {
  readonly schemaVersion: typeof SHADOW_EVALUATION_SCHEMA_VERSION;
  readonly platformVersion: typeof SHADOW_EVALUATION_PLATFORM_VERSION;
  readonly runId: string;
  readonly referenceDate: string;
  readonly collector: ShadowCollectorMetrics;
  readonly planner: ShadowPlannerMetrics;
  readonly nutrition: ShadowNutritionMetrics | null;
  readonly workout: ShadowWorkoutMetrics | null;
  readonly longitudinal: ShadowLongitudinalMetrics;
  readonly comparator: ShadowComparatorMetrics;
  readonly safety: ShadowSafetyMetrics;
  readonly performance: ShadowComponentMetrics;
  readonly scorecard: ShadowEvaluationScorecard;
  readonly summary: ShadowEvaluationSummary;
  readonly versions: ShadowObservationEnvelope['pipelineResult']['auditMetadata']['versions'];
}

export interface ShadowDistributionEntry {
  readonly value: string;
  readonly count: number;
  readonly percentage: number;
}

export interface ShadowEvaluationMetrics {
  readonly collector: {
    readonly meanCompletionRate: number;
    readonly meanUnknownRate: number;
    readonly meanConfirmationRate: number;
    readonly meanQuestionsRequired: number;
    readonly meanSnapshotCoverageRate: number;
    readonly completionStates: readonly ShadowDistributionEntry[];
  };
  readonly planner: {
    readonly goals: readonly ShadowDistributionEntry[];
    readonly intents: readonly ShadowDistributionEntry[];
    readonly revisions: number;
    readonly informationRequests: number;
    readonly planRequests: number;
  };
  readonly nutrition: {
    readonly packagesUsed: readonly ShadowDistributionEntry[];
    readonly packagesDiscarded: readonly ShadowDistributionEntry[];
    readonly conflicts: readonly ShadowDistributionEntry[];
    readonly priorities: readonly ShadowDistributionEntry[];
    readonly intensities: readonly ShadowDistributionEntry[];
    readonly complexities: readonly ShadowDistributionEntry[];
    readonly personalization: readonly ShadowDistributionEntry[];
    readonly strategies: readonly ShadowDistributionEntry[];
    readonly prohibitedStrategies: readonly ShadowDistributionEntry[];
  };
  readonly workout: {
    readonly modalities: readonly ShadowDistributionEntry[];
    readonly intensities: readonly ShadowDistributionEntry[];
    readonly complexities: readonly ShadowDistributionEntry[];
    readonly progressions: readonly ShadowDistributionEntry[];
    readonly strategies: readonly ShadowDistributionEntry[];
    readonly prohibitedStrategies: readonly ShadowDistributionEntry[];
    readonly conflicts: readonly ShadowDistributionEntry[];
    readonly priorities: readonly ShadowDistributionEntry[];
  };
  readonly longitudinal: {
    readonly states: readonly ShadowDistributionEntry[];
    readonly decisions: readonly ShadowDistributionEntry[];
  };
  readonly comparator: {
    readonly overall: readonly ShadowDistributionEntry[];
    readonly nutrition: readonly ShadowDistributionEntry[];
    readonly workout: readonly ShadowDistributionEntry[];
    readonly longitudinal: readonly ShadowDistributionEntry[];
    readonly divergences: readonly ShadowDistributionEntry[];
    readonly agreementRate: number;
    readonly conflictRate: number;
    readonly modalityDivergenceRate: number;
    readonly objectiveDivergenceRate: number;
    readonly intensityDivergenceRate: number;
    readonly complexityDivergenceRate: number;
    readonly longitudinalDivergenceRate: number;
  };
  readonly safety: {
    readonly categories: readonly ShadowDistributionEntry[];
    readonly runRate: number;
  };
  readonly indices: {
    readonly nutritionIntensity: number;
    readonly workoutIntensity: number;
    readonly personalization: number;
  };
}

export interface ShadowMetricsSnapshot {
  readonly schemaVersion: typeof SHADOW_EVALUATION_SCHEMA_VERSION;
  readonly platformVersion: typeof SHADOW_EVALUATION_PLATFORM_VERSION;
  readonly versionLabel: string;
  readonly runCount: number;
  readonly metrics: ShadowEvaluationMetrics;
  readonly performance: ShadowComponentMetrics;
  readonly scorecard: ShadowEvaluationScorecard;
  readonly versions: readonly string[];
}

export interface ShadowMetricDelta {
  readonly previous: number;
  readonly current: number;
  readonly absolute: number;
  readonly direction: 'INCREASED' | 'DECREASED' | 'UNCHANGED';
}

export interface ShadowDistributionDelta {
  readonly value: string;
  readonly previousPercentage: number;
  readonly currentPercentage: number;
  readonly percentagePointDelta: number;
}

export interface ShadowMetricsVersionComparison {
  readonly previousVersion: string;
  readonly currentVersion: string;
  readonly agreement: ShadowMetricDelta;
  readonly conflicts: ShadowMetricDelta;
  readonly personalization: ShadowMetricDelta;
  readonly nutritionIntensity: ShadowMetricDelta;
  readonly workoutIntensity: ShadowMetricDelta;
  readonly safety: ShadowMetricDelta;
  readonly agreementImproved: boolean;
  readonly conflictsReduced: boolean;
  readonly personalizationImproved: boolean;
  readonly intensityReduced: boolean;
  readonly safetyImproved: boolean;
  readonly distributionChanged: boolean;
  readonly comparatorDistribution: readonly ShadowDistributionDelta[];
}
