import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { WORKOUT_PLAN_INCLUDE } from '../../workout.service';
import type {
  CreateWorkoutPlanV2Record,
  PersistedWorkoutPlanRecord,
  WorkoutPlanV2OwnershipRecord,
  WorkoutPlanV2Repository,
} from './workout-plan-v2.repository';

@Injectable()
export class PrismaWorkoutPlanV2Gateway implements WorkoutPlanV2Repository {
  constructor(private readonly prisma: PrismaService) {}

  inTransaction<T>(
    operation: (transaction: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(operation, {
      maxWait: 5_000,
      timeout: 15_000,
    });
  }

  async acquireUserLock(
    transaction: Prisma.TransactionClient,
    userId: string,
  ): Promise<void> {
    await transaction.$queryRaw`
      WITH advisory_lock AS (
        SELECT pg_advisory_xact_lock(hashtext(${`workout:${userId}`}))
      )
      SELECT true AS "locked"
      FROM advisory_lock
    `;
  }

  async findOwnership(
    transaction: Prisma.TransactionClient,
    input: {
      readonly userId: string;
      readonly profileId: string;
      readonly aiJobId: string;
    },
  ): Promise<WorkoutPlanV2OwnershipRecord> {
    const [profile, aiJob] = await Promise.all([
      transaction.fitnessProfile.findFirst({
        where: { id: input.profileId, userId: input.userId },
        select: { goal: true },
      }),
      transaction.aIJob.findUnique({
        where: { id: input.aiJobId },
        select: {
          id: true,
          userId: true,
          type: true,
          status: true,
          promptVersionId: true,
          operationKey: true,
        },
      }),
    ]);

    return { profile, aiJob };
  }

  findByAIJobId(
    transaction: Prisma.TransactionClient,
    aiJobId: string,
  ): Promise<PersistedWorkoutPlanRecord | null> {
    return transaction.workoutPlan.findUnique({
      where: { aiJobId },
      include: WORKOUT_PLAN_INCLUDE,
    });
  }

  async archiveActive(
    transaction: Prisma.TransactionClient,
    userId: string,
  ): Promise<void> {
    await transaction.workoutPlan.updateMany({
      where: { userId, status: 'ACTIVE' },
      data: { status: 'ARCHIVED' },
    });
  }

  create(
    transaction: Prisma.TransactionClient,
    input: CreateWorkoutPlanV2Record,
  ): Promise<PersistedWorkoutPlanRecord> {
    return transaction.workoutPlan.create({
      data: {
        userId: input.userId,
        profileId: input.profileId,
        aiJobId: input.aiJobId,
        title: input.title,
        objective: input.objective,
        status: input.status,
        generatedAt: input.generatedAt,
        days: {
          create: input.days.map((day) => ({
            dayNumber: day.dayNumber,
            weekday: day.weekday,
            title: day.title,
            exercises: {
              create: day.exercises.map((exercise) => ({
                exerciseName: exercise.exerciseName,
                sets: exercise.sets,
                reps: exercise.reps,
                restSeconds: exercise.restSeconds,
                notes: exercise.notes,
              })),
            },
          })),
        },
      },
      include: WORKOUT_PLAN_INCLUDE,
    });
  }
}
