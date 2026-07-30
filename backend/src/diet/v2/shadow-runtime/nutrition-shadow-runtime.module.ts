import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../../../prisma/prisma.module';
import { NutritionShadowComparatorModule } from '../shadow-comparison/nutrition-shadow-comparator.module';
import { NutritionShadowModule } from '../shadow/nutrition-shadow.module';
import { NutritionShadowExecutionPolicy } from './nutrition-shadow-execution.policy';
import { NutritionShadowRuntimeOrchestratorService } from './nutrition-shadow-runtime-orchestrator.service';
import { NUTRITION_SHADOW_RUNTIME_RESULT_READER } from './nutrition-shadow-runtime-result.reader';
import { PrismaNutritionShadowRuntimeResultReader } from './prisma-nutrition-shadow-runtime-result.reader';
import { NUTRITION_SHADOW_RUNTIME_DECISION_REPOSITORY } from './nutrition-shadow-runtime-decision.repository';
import { PrismaNutritionShadowRuntimeDecisionGateway } from './prisma-nutrition-shadow-runtime-decision.gateway';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    NutritionShadowModule,
    NutritionShadowComparatorModule,
  ],
  providers: [
    NutritionShadowExecutionPolicy,
    NutritionShadowRuntimeOrchestratorService,
    PrismaNutritionShadowRuntimeResultReader,
    PrismaNutritionShadowRuntimeDecisionGateway,
    {
      provide: NUTRITION_SHADOW_RUNTIME_RESULT_READER,
      useExisting: PrismaNutritionShadowRuntimeResultReader,
    },
    {
      provide: NUTRITION_SHADOW_RUNTIME_DECISION_REPOSITORY,
      useExisting: PrismaNutritionShadowRuntimeDecisionGateway,
    },
  ],
  exports: [NutritionShadowRuntimeOrchestratorService],
})
export class NutritionShadowRuntimeModule {}
