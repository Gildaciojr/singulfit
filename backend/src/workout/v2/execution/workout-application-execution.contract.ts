import type { WorkoutArtifactType } from '../workout-planning-artifact.contract';
import type { WorkoutPlanV2 } from '../workout-plan-v2.contract';
import type {
  PersistWorkoutPlanV2Input,
  PersistedWorkoutPlanV2Aggregate,
} from '../persistence/workout-plan-v2-persistence.contract';

export type WorkoutApplicationExecutionInputV2 = PersistWorkoutPlanV2Input;

export interface WorkoutApplicationExecutionResultV2 {
  readonly kind: 'PLAN';
  readonly aggregateId: string;
  readonly artifactType: WorkoutArtifactType;
  readonly document: WorkoutPlanV2;
  readonly projection: PersistedWorkoutPlanV2Aggregate;
  readonly persistence: 'CREATED' | 'REUSED';
  readonly aiJobCompleted: true;
}
