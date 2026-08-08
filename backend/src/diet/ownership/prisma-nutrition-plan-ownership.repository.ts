import { Injectable } from '@nestjs/common';
import {
  DietPlanStatus,
  NutritionPlanImplementation,
  NutritionPlanStatus,
  type NutritionPlanOwnership,
  type Prisma,
} from '@prisma/client';
import type { NutritionPlanOwnershipTarget } from './nutrition-plan-ownership.contract';
import type { NutritionPlanOwnershipRepository } from './nutrition-plan-ownership.repository';

@Injectable()
export class PrismaNutritionPlanOwnershipRepository implements NutritionPlanOwnershipRepository {
  async acquireCanonicalLock(
    transaction: Prisma.TransactionClient,
    userId: string,
  ): Promise<void> {
    await transaction.$queryRaw`
      WITH advisory_lock AS (
        SELECT pg_advisory_xact_lock(hashtext(${`diet:${userId}`}))
      )
      SELECT true AS "locked"
      FROM advisory_lock
    `;
  }

  findByUserId(
    transaction: Prisma.TransactionClient,
    userId: string,
  ): Promise<NutritionPlanOwnership | null> {
    return transaction.nutritionPlanOwnership.findUnique({
      where: { userId },
    });
  }

  async targetExists(
    transaction: Prisma.TransactionClient,
    target: NutritionPlanOwnershipTarget,
  ): Promise<boolean> {
    switch (target.implementation) {
      case NutritionPlanImplementation.LEGACY:
        return (
          (await transaction.dietPlan.count({
            where: {
              id: target.planId,
              userId: target.userId,
              profileId: target.profileId,
              aiJobId: target.aiJobId,
              status: DietPlanStatus.ACTIVE,
            },
          })) === 1
        );
      case NutritionPlanImplementation.V2:
        return (
          (await transaction.nutritionPlanV2.count({
            where: {
              id: target.planId,
              userId: target.userId,
              profileId: target.profileId,
              aiJobId: target.aiJobId,
              status: NutritionPlanStatus.ACTIVE,
            },
          })) === 1
        );
    }
  }

  upsert(
    transaction: Prisma.TransactionClient,
    target: NutritionPlanOwnershipTarget,
  ): Promise<NutritionPlanOwnership> {
    const data = {
      profileId: target.profileId,
      implementation: target.implementation,
      planId: target.planId,
    };
    return transaction.nutritionPlanOwnership.upsert({
      where: { userId: target.userId },
      create: { userId: target.userId, ...data },
      update: data,
    });
  }
}
