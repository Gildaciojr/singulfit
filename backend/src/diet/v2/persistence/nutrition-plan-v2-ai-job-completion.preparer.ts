import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { NutritionPlanningAIJobCompletion } from '../nutrition-planning-generation.contract';

export const NUTRITION_PLAN_V2_AI_JOB_COMPLETION_PREPARER = Symbol(
  'NUTRITION_PLAN_V2_AI_JOB_COMPLETION_PREPARER',
);

export interface NutritionPlanV2AIJobCompletionPreparer {
  prepareInTransaction(
    transaction: Prisma.TransactionClient,
    completion: NutritionPlanningAIJobCompletion,
  ): Promise<'PENDING'>;
}

@Injectable()
export class InactiveNutritionPlanV2AIJobCompletionPreparer implements NutritionPlanV2AIJobCompletionPreparer {
  prepareInTransaction(
    transaction: Prisma.TransactionClient,
    completion: NutritionPlanningAIJobCompletion,
  ): Promise<'PENDING'> {
    void transaction;
    void completion;
    return Promise.resolve('PENDING');
  }
}
