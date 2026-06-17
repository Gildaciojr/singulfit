import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AutomationModule } from '../automation/automation.module';
import { BehaviorModule } from '../behavior/behavior.module';
import { NutritionModule } from '../nutrition/nutrition.module';
import { AIQualityModule } from '../ai-quality/ai-quality.module';
import { RecommendationModule } from '../recommendations/recommendation.module';
import { LongitudinalModule } from '../longitudinal/longitudinal.module';
import { NutritionResponseFormatter } from './nutrition-response.formatter';
import { ResponseBuilderService } from './response-builder.service';
import { ResponseController } from './response.controller';

@Module({
  imports: [
    AuthModule,
    AutomationModule,
    BehaviorModule,
    NutritionModule,
    AIQualityModule,
    RecommendationModule,
    LongitudinalModule,
  ],
  controllers: [ResponseController],
  providers: [ResponseBuilderService, NutritionResponseFormatter],
  exports: [ResponseBuilderService, NutritionResponseFormatter],
})
export class ResponseModule {}
