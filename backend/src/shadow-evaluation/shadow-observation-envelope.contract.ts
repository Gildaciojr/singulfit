import type {
  ProfileAcquisitionCandidate,
  ProfileAcquisitionDecision,
} from '../context/coach-adaptive-profile-collector.contract';
import type {
  CoachProfileCompletionStatus,
  CoachProfileSectionCompletion,
} from '../context/coach-profile-snapshot.contract';
import type { ConversationGoalDecision } from '../context/conversation-goal-planner.contract';
import type {
  LongitudinalCoachingDecision,
  LongitudinalRisk,
} from '../longitudinal-coaching/longitudinal-coaching.contract';
import type {
  NutritionKnowledgePackageDecision,
  NutritionProhibitedStrategy,
  NutritionReasoningMetadata,
  NutritionReasoningPriorityProfile,
  NutritionReasoningResult,
  NutritionResolvedConflict,
  NutritionSelectedStrategy,
} from '../nutrition-reasoning/nutrition-reasoning.contract';
import type {
  NutritionReasoningShadowStrategy,
  UnifiedShadowAuditMetadata,
  UnifiedShadowDecisionComparison,
  UnifiedShadowDifference,
  UnifiedShadowDomainComparison,
  WorkoutReasoningShadowStrategy,
} from '../unified-shadow-decision/unified-shadow-decision.contract';
import type {
  WorkoutKnowledgeDecision,
  WorkoutProhibitedStrategy,
  WorkoutReasoningConflictResolution,
  WorkoutReasoningMetadata,
  WorkoutReasoningModalityDecision,
  WorkoutReasoningPriorities,
  WorkoutReasoningResult,
  WorkoutSelectedStrategy,
} from '../workout-reasoning/workout-reasoning.contract';
import type { WorkoutPlanningStrategy } from '../workout/v2/workout-planning-strategy.contract';

export const SHADOW_OBSERVATION_SCHEMA_VERSION = 1 as const;

export type ShadowObservableCompletionSection = Pick<
  CoachProfileSectionCompletion,
  | 'section'
  | 'state'
  | 'ready'
  | 'requiredFields'
  | 'availableFields'
  | 'missingFields'
  | 'confirmationRequiredFields'
>;

export interface ShadowObservableSnapshot {
  readonly referenceDate: string;
  readonly completion: Readonly<{
    overall: CoachProfileCompletionStatus['overall'];
    sections: readonly ShadowObservableCompletionSection[];
  }>;
}

export type ShadowObservableAcquisitionCandidate = Pick<
  ProfileAcquisitionCandidate,
  'field' | 'state' | 'knowledgeStatus'
>;

export interface ShadowObservableAdaptiveDecision {
  readonly intent: ProfileAcquisitionDecision['intent'];
  readonly shouldAsk: boolean;
  readonly orderedCandidates: readonly ShadowObservableAcquisitionCandidate[];
}

export type ShadowObservablePlannerDecision = Pick<
  ConversationGoalDecision,
  'recognizedIntent' | 'goal' | 'targetPlan' | 'canExecute'
>;

export interface ShadowObservableLongitudinalDecision {
  readonly currentState: LongitudinalCoachingDecision['currentState'];
  readonly decision: LongitudinalCoachingDecision['decision'];
  readonly priorities: Readonly<
    Pick<LongitudinalCoachingDecision['priorities'], 'safety'>
  >;
  readonly risks: readonly Pick<LongitudinalRisk, 'code'>[];
  readonly interventionIntensity: LongitudinalCoachingDecision['interventionIntensity'];
  readonly metadata: Readonly<
    Pick<
      LongitudinalCoachingDecision['metadata'],
      'policyVersion' | 'deterministic'
    >
  >;
}

export interface ShadowObservableNutritionReasoning {
  readonly packageDecisions: readonly Pick<
    NutritionKnowledgePackageDecision,
    'packageId' | 'disposition'
  >[];
  readonly resolvedConflicts: readonly Pick<
    NutritionResolvedConflict,
    'conflict'
  >[];
  readonly selectedStrategies: readonly Pick<
    NutritionSelectedStrategy,
    'strategy'
  >[];
  readonly prohibitedStrategies: readonly Pick<
    NutritionProhibitedStrategy,
    'strategy'
  >[];
  readonly interventionIntensity: NutritionReasoningResult['interventionIntensity'];
  readonly personalizationLevel: NutritionReasoningResult['personalizationLevel'];
  readonly recommendedComplexity: NutritionReasoningResult['recommendedComplexity'];
  readonly priorities: NutritionReasoningPriorityProfile;
  readonly metadata: Readonly<
    Pick<
      NutritionReasoningMetadata,
      'strategyVersion' | 'deterministic' | 'safetyRestricted'
    >
  >;
}

export interface ShadowObservableWorkoutReasoning {
  readonly primaryObjective: WorkoutReasoningResult['primaryObjective'];
  readonly modality: Readonly<
    Pick<WorkoutReasoningModalityDecision, 'resolved'>
  >;
  readonly knowledgeDecisions: readonly Pick<
    WorkoutKnowledgeDecision,
    'packageId' | 'disposition'
  >[];
  readonly resolvedConflicts: readonly Pick<
    WorkoutReasoningConflictResolution,
    'conflict'
  >[];
  readonly selectedStrategies: readonly Pick<
    WorkoutSelectedStrategy,
    'strategy'
  >[];
  readonly prohibitedStrategies: readonly Pick<
    WorkoutProhibitedStrategy,
    'prohibition'
  >[];
  readonly interventionIntensity: WorkoutReasoningResult['interventionIntensity'];
  readonly authorizedComplexity: WorkoutReasoningResult['authorizedComplexity'];
  readonly progressionDecision: WorkoutReasoningResult['progressionDecision'];
  readonly priorities: WorkoutReasoningPriorities;
  readonly metadata: Readonly<
    Pick<
      WorkoutReasoningMetadata,
      'strategyVersion' | 'deterministic' | 'safetyRestricted'
    >
  >;
}

export type ShadowObservableNutritionAdapterResult = Readonly<
  Pick<
    NutritionReasoningShadowStrategy,
    | 'adapterVersion'
    | 'artifactType'
    | 'interventionIntensity'
    | 'complexity'
    | 'personalization'
    | 'variationPolicy'
    | 'detailLevel'
    | 'trainingAware'
    | 'safetyRestricted'
    | 'restrictionCodes'
    | 'selectedStrategies'
    | 'prohibitedStrategies'
  >
>;

export type ShadowObservableWorkoutAdapterResult = Readonly<
  Pick<
    WorkoutReasoningShadowStrategy,
    | 'adapterVersion'
    | 'artifactType'
    | 'modality'
    | 'objective'
    | 'interventionIntensity'
    | 'complexity'
    | 'personalization'
    | 'progression'
    | 'requiredBlocks'
    | 'maximumActivitiesPerSession'
    | 'technicalMovementsAllowed'
    | 'safetyRestricted'
    | 'constraintCodes'
    | 'selectedStrategies'
    | 'prohibitedStrategies'
  >
>;

export interface ShadowObservableExecutionArtifacts {
  readonly adaptiveDecision: ShadowObservableAdaptiveDecision;
  readonly plannerDecision: ShadowObservablePlannerDecision;
  readonly longitudinalDecision: ShadowObservableLongitudinalDecision;
  readonly nutritionReasoning: ShadowObservableNutritionReasoning | null;
  readonly workoutReasoning: ShadowObservableWorkoutReasoning | null;
  readonly workoutLegacyStrategy: Readonly<
    Pick<WorkoutPlanningStrategy, 'objective'>
  > | null;
  readonly nutritionShadowStrategy: ShadowObservableNutritionAdapterResult | null;
  readonly workoutShadowStrategy: ShadowObservableWorkoutAdapterResult | null;
}

export type ShadowObservableDifference = Pick<
  UnifiedShadowDifference,
  'domain' | 'dimension'
>;

export interface ShadowObservableDomainComparison extends Pick<
  UnifiedShadowDomainComparison,
  'category' | 'exact'
> {
  readonly differences: readonly ShadowObservableDifference[];
}

export interface ShadowObservableDecisionComparison extends Pick<
  UnifiedShadowDecisionComparison,
  'comparatorVersion' | 'overallCategory'
> {
  readonly nutrition: ShadowObservableDomainComparison | null;
  readonly workout: ShadowObservableDomainComparison | null;
  readonly longitudinal: ShadowObservableDomainComparison;
}

export type ShadowObservableAuditMetadata = Readonly<
  Omit<UnifiedShadowAuditMetadata, 'differences'>
>;

export interface ShadowObservationSafetyIndicators {
  readonly nutritionRestricted: boolean;
  readonly workoutRestricted: boolean;
  readonly longitudinalCritical: boolean;
  readonly mandatoryReview: boolean;
  readonly mandatoryDeload: boolean;
  readonly paused: boolean;
  readonly clinicalBoundary: boolean;
}

export interface ShadowObservationEnvelope {
  readonly schemaVersion: typeof SHADOW_OBSERVATION_SCHEMA_VERSION;
  readonly runId: string;
  readonly snapshot: ShadowObservableSnapshot;
  readonly artifacts: ShadowObservableExecutionArtifacts;
  readonly pipelineResult: Readonly<{
    status: 'COMPLETED';
    comparison: ShadowObservableDecisionComparison;
    auditMetadata: ShadowObservableAuditMetadata;
    auditPersisted: boolean;
  }>;
  readonly safetyIndicators: ShadowObservationSafetyIndicators;
}
