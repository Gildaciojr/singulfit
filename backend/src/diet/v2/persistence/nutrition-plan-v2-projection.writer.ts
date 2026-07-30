import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { PersistedNutritionPlanV2Aggregate } from './nutrition-plan-v2-persistence.contract';

export const NUTRITION_PLAN_V2_PROJECTION_WRITER = Symbol(
  'NUTRITION_PLAN_V2_PROJECTION_WRITER',
);

export interface NutritionPlanV2ProjectionWriter {
  prepareInTransaction(
    transaction: Prisma.TransactionClient,
    aggregate: PersistedNutritionPlanV2Aggregate,
  ): Promise<void>;
}

@Injectable()
export class InactiveNutritionPlanV2ProjectionWriter implements NutritionPlanV2ProjectionWriter {
  prepareInTransaction(
    transaction: Prisma.TransactionClient,
    aggregate: PersistedNutritionPlanV2Aggregate,
  ): Promise<void> {
    void transaction;
    void aggregate;
    return Promise.resolve();
  }
}
