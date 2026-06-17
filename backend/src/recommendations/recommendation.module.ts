import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LongitudinalModule } from '../longitudinal/longitudinal.module';
import { BehavioralRecommendationEngineService } from './behavioral-recommendation-engine.service';
import { NutritionRecommendationEngineService } from './nutrition-recommendation-engine.service';
import { RecommendationAdminController } from './recommendation-admin.controller';
import { RecommendationScoringService } from './recommendation-scoring.service';
import { RecommendationService } from './recommendation.service';
import { RetentionRecommendationEngineService } from './retention-recommendation-engine.service';

@Module({
  imports: [AuthModule, LongitudinalModule],
  controllers: [RecommendationAdminController],
  providers: [
    RecommendationScoringService,
    NutritionRecommendationEngineService,
    BehavioralRecommendationEngineService,
    RetentionRecommendationEngineService,
    RecommendationService,
  ],
  exports: [RecommendationService],
})
export class RecommendationModule {}
