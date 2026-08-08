import { Module } from '@nestjs/common';
import { NutritionPlanOwnershipService } from './nutrition-plan-ownership.service';
import { NUTRITION_PLAN_OWNERSHIP_REPOSITORY } from './nutrition-plan-ownership.repository';
import { PrismaNutritionPlanOwnershipRepository } from './prisma-nutrition-plan-ownership.repository';

@Module({
  providers: [
    PrismaNutritionPlanOwnershipRepository,
    {
      provide: NUTRITION_PLAN_OWNERSHIP_REPOSITORY,
      useExisting: PrismaNutritionPlanOwnershipRepository,
    },
    NutritionPlanOwnershipService,
  ],
  exports: [NutritionPlanOwnershipService],
})
export class NutritionPlanOwnershipModule {}
