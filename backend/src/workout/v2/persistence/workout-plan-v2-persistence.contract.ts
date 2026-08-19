import type {
  FitnessGoal,
  WorkoutStatus,
  WorkoutWeekday,
} from '@prisma/client';
import type { WorkoutPlanV2 } from '../workout-plan-v2.contract';
import type { WorkoutPlanningGenerationResult } from '../workout-planning-generation.contract';

export interface WorkoutPlanV2Ownership {
  readonly userId: string;
  readonly profileId: string;
}

export interface WorkoutExecutionContextV2 {
  readonly correlationId: string;
  readonly traceId?: string;
}

export interface PersistWorkoutPlanV2Input {
  readonly generation: WorkoutPlanningGenerationResult;
  readonly ownership: WorkoutPlanV2Ownership;
  readonly executionContext?: WorkoutExecutionContextV2;
  readonly calendarWeekdays?: readonly WorkoutWeekday[];
}

export interface PersistedWorkoutExerciseV2Projection {
  readonly id: string;
  readonly exerciseName: string;
  readonly sets: number;
  readonly reps: string;
  readonly restSeconds: number;
  readonly notes: string | null;
}

export interface PersistedWorkoutDayV2Projection {
  readonly id: string;
  readonly dayNumber: number;
  readonly weekday: WorkoutWeekday | null;
  readonly title: string;
  readonly exercises: readonly PersistedWorkoutExerciseV2Projection[];
}

export interface PersistedWorkoutPlanV2Aggregate {
  readonly id: string;
  readonly userId: string;
  readonly profileId: string;
  readonly aiJobId: string;
  readonly title: string;
  readonly objective: FitnessGoal;
  readonly status: WorkoutStatus;
  readonly document: WorkoutPlanV2;
  readonly days: readonly PersistedWorkoutDayV2Projection[];
  readonly generatedAt: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface PersistWorkoutPlanV2Result {
  readonly persistence: 'CREATED' | 'REUSED';
  readonly aggregate: PersistedWorkoutPlanV2Aggregate;
  readonly aiJobCompleted: true;
}
