import type { WorkoutWeekday } from '@prisma/client';
import type {
  WorkoutPlanV2,
  WorkoutSessionV2,
} from './workout-plan-v2.contract';

export interface CurrentWorkoutPlanV2 {
  readonly implementation: 'V2';
  readonly aggregateId: string;
  readonly userId: string;
  readonly aiJobId: string;
  readonly document: WorkoutPlanV2;
  readonly timezone: string;
  readonly calendar: readonly {
    readonly sessionSequence: number;
    readonly weekday: WorkoutWeekday | null;
  }[];
}

export interface CurrentWorkoutPlanLegacyExercise {
  readonly exerciseName: string;
  readonly sets: number;
  readonly reps: string;
  readonly restSeconds: number;
  readonly notes: string | null;
}

export interface CurrentWorkoutPlanLegacySession {
  readonly sequence: number;
  readonly title: string;
  readonly exercises: readonly CurrentWorkoutPlanLegacyExercise[];
}

export interface CurrentWorkoutPlanLegacyRelational {
  readonly implementation: 'LEGACY_RELATIONAL';
  readonly aggregateId: string;
  readonly userId: string;
  readonly aiJobId: string;
  readonly title: string;
  readonly timezone: string;
  readonly sessions: readonly CurrentWorkoutPlanLegacySession[];
  readonly calendar: readonly {
    readonly sessionSequence: number;
    readonly weekday: WorkoutWeekday | null;
  }[];
}

export type CurrentWorkoutPlanReadResult =
  | Readonly<{ status: 'AVAILABLE'; plan: CurrentWorkoutPlanV2 }>
  | Readonly<{
      status: 'LEGACY_RELATIONAL';
      plan: CurrentWorkoutPlanLegacyRelational;
    }>
  | Readonly<{ status: 'NO_PLAN'; plan: null }>
  | Readonly<{ status: 'INVALID_V2_PLAN'; plan: null }>;

export type WorkoutPlanReadSelection =
  | Readonly<{ kind: 'FULL_PLAN' }>
  | Readonly<{ kind: 'SESSION'; session: WorkoutSessionV2 }>
  | Readonly<{ kind: 'REST_DAY'; weekday: WorkoutWeekday }>
  | Readonly<{ kind: 'CLARIFICATION'; message: string }>
  | Readonly<{ kind: 'CALENDAR_UNAVAILABLE'; message: string }>;
