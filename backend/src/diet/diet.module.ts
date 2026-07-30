import { Module } from '@nestjs/common';
import { AIModule } from '../ai/ai.module';
import { AuthModule } from '../auth/auth.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { DietGeneratorService } from './diet-generator.service';
import { DietController } from './diet.controller';
import { DietService } from './diet.service';
import { GenerateNutritionPlanV2InputBuilder } from './v2/generate-nutrition-plan-v2-input.builder';
import { NutritionArtifactResolverService } from './v2/nutrition-artifact-resolver.service';
import { NutritionPlanV2Formatter } from './v2/nutrition-plan-v2.formatter';
import { NutritionPlanV2Validator } from './v2/nutrition-plan-v2.validator';
import { NutritionPlanningContextBuilder } from './v2/nutrition-planning-context.builder';
import { NutritionPlanningEngineV2Service } from './v2/nutrition-planning-engine-v2.service';
import { NutritionPlanningReadinessService } from './v2/nutrition-planning-readiness.service';
import { NutritionPlanningSafetyService } from './v2/nutrition-planning-safety.service';
import { NutritionPlanningStrategyService } from './v2/nutrition-planning-strategy.service';
import { NutritionConversationalArtifactValidator } from './v2/nutrition-conversational-artifact.validator';
import { NutritionGenerationRunnerV2Service } from './v2/nutrition-generation-runner-v2.service';

@Module({
  imports: [AuthModule, AIModule, SubscriptionsModule],
  controllers: [DietController],
  providers: [
    DietService,
    DietGeneratorService,
    NutritionArtifactResolverService,
    GenerateNutritionPlanV2InputBuilder,
    NutritionPlanningReadinessService,
    NutritionPlanningContextBuilder,
    NutritionPlanningStrategyService,
    NutritionPlanningSafetyService,
    NutritionPlanV2Validator,
    NutritionConversationalArtifactValidator,
    NutritionGenerationRunnerV2Service,
    NutritionPlanV2Formatter,
    NutritionPlanningEngineV2Service,
    NutritionGenerationRunnerV2Service,
  ],
  exports: [
    DietService,
    DietGeneratorService,
    GenerateNutritionPlanV2InputBuilder,
    NutritionPlanningEngineV2Service,
    NutritionPlanV2Formatter,
  ],
})
export class DietModule {}
