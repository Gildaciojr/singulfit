import { Module } from '@nestjs/common';
import { AIModule } from '../../../ai/ai.module';
import { DietModule } from '../../diet.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import { NutritionShadowRunnerService } from './nutrition-shadow-runner.service';
import { PrismaNutritionShadowGateway } from './prisma-nutrition-shadow.gateway';
import { PrismaNutritionShadowActivePlanAdapter } from './prisma-nutrition-shadow-active-plan.adapter';
import { NUTRITION_SHADOW_REPOSITORY } from './nutrition-shadow.repository';
import { NUTRITION_SHADOW_ACTIVE_PLAN_PORT } from './nutrition-shadow-active-plan.port';

@Module({
  imports: [AIModule, DietModule, PrismaModule],
  providers: [
    NutritionShadowRunnerService,
    PrismaNutritionShadowGateway,
    PrismaNutritionShadowActivePlanAdapter,
    {
      provide: NUTRITION_SHADOW_REPOSITORY,
      useExisting: PrismaNutritionShadowGateway,
    },
    {
      provide: NUTRITION_SHADOW_ACTIVE_PLAN_PORT,
      useExisting: PrismaNutritionShadowActivePlanAdapter,
    },
  ],
  exports: [NutritionShadowRunnerService],
})
export class NutritionShadowModule {}
