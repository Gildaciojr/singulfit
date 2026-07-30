import { Injectable } from '@nestjs/common';
import type {
  NutritionPlanV2 as PersistedNutritionPlanV2,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  CreateNutritionPlanV2Record,
  NutritionPlanV2OwnershipRecord,
  NutritionPlanV2Repository,
} from './nutrition-plan-v2.repository';

@Injectable()
export class PrismaNutritionPlanV2Gateway implements NutritionPlanV2Repository {
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
        SELECT pg_advisory_xact_lock(
          hashtext(${`nutrition-plan-v2:${userId}`})
        )
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
  ): Promise<NutritionPlanV2OwnershipRecord> {
    const [profile, aiJob] = await Promise.all([
      transaction.fitnessProfile.findFirst({
        where: {
          id: input.profileId,
          userId: input.userId,
        },
        select: {
          id: true,
        },
      }),
      transaction.aIJob.findUnique({
        where: {
          id: input.aiJobId,
        },
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

    return {
      profileOwned: profile !== null,
      aiJob,
    };
  }

  findByAIJobId(
    transaction: Prisma.TransactionClient,
    aiJobId: string,
  ): Promise<PersistedNutritionPlanV2 | null> {
    return transaction.nutritionPlanV2.findUnique({
      where: {
        aiJobId,
      },
    });
  }

  async archiveActive(
    transaction: Prisma.TransactionClient,
    userId: string,
  ): Promise<void> {
    await transaction.nutritionPlanV2.updateMany({
      where: {
        userId,
        status: 'ACTIVE',
      },
      data: {
        status: 'ARCHIVED',
      },
    });
  }

  create(
    transaction: Prisma.TransactionClient,
    input: CreateNutritionPlanV2Record,
  ): Promise<PersistedNutritionPlanV2> {
    return transaction.nutritionPlanV2.create({
      data: input,
    });
  }
}
