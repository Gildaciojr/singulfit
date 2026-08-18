import type { WorkoutArtifactType } from '../workout-planning-artifact.contract';
import type {
  WorkoutPlanningReadiness,
  WorkoutReadinessField,
  WorkoutSafetyFlag,
} from '../workout-planning-artifact.contract';
import type { GenerateWorkoutPlanV2Input } from '../workout-planning-generation.contract';
import type { WorkoutPlanV2 } from '../workout-plan-v2.contract';
import type {
  PersistedWorkoutPlanV2Aggregate,
  WorkoutExecutionContextV2,
  WorkoutPlanV2Ownership,
} from '../persistence/workout-plan-v2-persistence.contract';

export interface WorkoutApplicationExecutionInputV2 {
  readonly generationInput: GenerateWorkoutPlanV2Input;
  readonly ownership: WorkoutPlanV2Ownership;
  readonly executionContext?: WorkoutExecutionContextV2;
}

export interface WorkoutApplicationPlanExecutionResultV2 {
  readonly kind: 'PLAN';
  readonly aggregateId: string;
  readonly artifactType: WorkoutArtifactType;
  readonly document: WorkoutPlanV2;
  readonly projection: PersistedWorkoutPlanV2Aggregate;
  readonly persistence: 'CREATED' | 'REUSED';
  readonly aiJobCompleted: true;
}

export interface WorkoutApplicationClarificationResultV2 {
  readonly kind: 'CLARIFICATION';
  readonly resolutionReason: string;
  readonly readiness: WorkoutPlanningReadiness | null;
  readonly missingFields: readonly WorkoutReadinessField[];
  readonly confirmationRequiredFields: readonly WorkoutReadinessField[];
  readonly safetyFlags: readonly WorkoutSafetyFlag[];
  readonly aiJobCompleted: false;
}

export interface WorkoutApplicationBlockedResultV2 {
  readonly kind: 'BLOCKED';
  readonly safetyOutcome: 'BLOCKED' | 'PROFESSIONAL_REVIEW_RECOMMENDED';
  readonly reasonCodes: readonly string[];
  readonly safetyFlags: readonly WorkoutSafetyFlag[];
  readonly aiJobCompleted: false;
}

export type WorkoutApplicationExecutionResultV2 =
  | WorkoutApplicationPlanExecutionResultV2
  | WorkoutApplicationClarificationResultV2
  | WorkoutApplicationBlockedResultV2;
