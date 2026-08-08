import type {
  AIJobStatus,
  AIJobType,
  FitnessGoal,
  Prisma,
  WorkoutStatus,
} from '@prisma/client';
import type { WORKOUT_PLAN_INCLUDE } from '../../workout.service';

export const WORKOUT_PLAN_V2_REPOSITORY = Symbol('WORKOUT_PLAN_V2_REPOSITORY');

export type PersistedWorkoutPlanRecord = Prisma.WorkoutPlanGetPayload<{
  include: typeof WORKOUT_PLAN_INCLUDE;
}>;

export interface WorkoutPlanV2OwnershipRecord {
  readonly profile: { readonly goal: FitnessGoal } | null;
  readonly aiJob: {
    readonly id: string;
    readonly userId: string;
    readonly type: AIJobType;
    readonly status: AIJobStatus;
    readonly promptVersionId: string;
    readonly operationKey: string | null;
  } | null;
}

export interface CreateWorkoutPlanV2Record {
  readonly userId: string;
  readonly profileId: string;
  readonly aiJobId: string;
  readonly title: string;
  readonly objective: FitnessGoal;
  readonly status: WorkoutStatus;
  readonly generatedAt: Date;
  readonly days: readonly {
    readonly dayNumber: number;
    readonly title: string;
    readonly exercises: readonly {
      readonly exerciseName: string;
      readonly sets: number;
      readonly reps: string;
      readonly restSeconds: number;
      readonly notes: string | null;
    }[];
  }[];
}

export type WorkoutPlanV2Projection = Pick<
  CreateWorkoutPlanV2Record,
  'title' | 'generatedAt' | 'days'
>;

export interface WorkoutPlanV2Repository {
  inTransaction<T>(
    operation: (transaction: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T>;
  acquireUserLock(
    transaction: Prisma.TransactionClient,
    userId: string,
  ): Promise<void>;
  findOwnership(
    transaction: Prisma.TransactionClient,
    input: {
      readonly userId: string;
      readonly profileId: string;
      readonly aiJobId: string;
    },
  ): Promise<WorkoutPlanV2OwnershipRecord>;
  findByAIJobId(
    transaction: Prisma.TransactionClient,
    aiJobId: string,
  ): Promise<PersistedWorkoutPlanRecord | null>;
  archiveActive(
    transaction: Prisma.TransactionClient,
    userId: string,
  ): Promise<void>;
  create(
    transaction: Prisma.TransactionClient,
    input: CreateWorkoutPlanV2Record,
  ): Promise<PersistedWorkoutPlanRecord>;
}
