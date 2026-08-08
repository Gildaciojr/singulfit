import { Module } from '@nestjs/common';
import { AIModule } from '../../../ai/ai.module';
import {
  InactiveNutritionPlanV2ProjectionWriter,
  NUTRITION_PLAN_V2_PROJECTION_WRITER,
} from './nutrition-plan-v2-projection.writer';
import { NutritionPlanV2PersistenceService } from './nutrition-plan-v2-persistence.service';
import { NutritionPlanV2PersistenceValidator } from './nutrition-plan-v2-persistence.validator';
import { NUTRITION_PLAN_V2_REPOSITORY } from './nutrition-plan-v2.repository';
import { PrismaNutritionPlanV2Gateway } from './prisma-nutrition-plan-v2.gateway';
import { NutritionPlanOwnershipModule } from '../../ownership/nutrition-plan-ownership.module';

@Module({
  imports: [AIModule, NutritionPlanOwnershipModule],
  providers: [
    NutritionPlanV2PersistenceValidator,
    PrismaNutritionPlanV2Gateway,
    InactiveNutritionPlanV2ProjectionWriter,
    {
      provide: NUTRITION_PLAN_V2_REPOSITORY,
      useExisting: PrismaNutritionPlanV2Gateway,
    },
    {
      provide: NUTRITION_PLAN_V2_PROJECTION_WRITER,
      useExisting: InactiveNutritionPlanV2ProjectionWriter,
    },
    NutritionPlanV2PersistenceService,
  ],
  exports: [NutritionPlanV2PersistenceService],
})
export class NutritionPlanV2InfrastructureModule {}
