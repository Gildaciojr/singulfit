import type { NutritionPlanOwnership, Prisma } from '@prisma/client';
import type { NutritionPlanOwnershipTarget } from './nutrition-plan-ownership.contract';

export const NUTRITION_PLAN_OWNERSHIP_REPOSITORY = Symbol(
  'NUTRITION_PLAN_OWNERSHIP_REPOSITORY',
);

export interface NutritionPlanOwnershipRepository {
  acquireCanonicalLock(
    transaction: Prisma.TransactionClient,
    userId: string,
  ): Promise<void>;
  findByUserId(
    transaction: Prisma.TransactionClient,
    userId: string,
  ): Promise<NutritionPlanOwnership | null>;
  targetExists(
    transaction: Prisma.TransactionClient,
    target: NutritionPlanOwnershipTarget,
  ): Promise<boolean>;
  upsert(
    transaction: Prisma.TransactionClient,
    target: NutritionPlanOwnershipTarget,
  ): Promise<NutritionPlanOwnership>;
}
