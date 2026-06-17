import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BehaviorModule } from '../behavior/behavior.module';
import { EvolutionModule } from '../evolution/evolution.module';
import { NutritionModule } from '../nutrition/nutrition.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { RecommendationModule } from '../recommendations/recommendation.module';
import { LongitudinalModule } from '../longitudinal/longitudinal.module';
import { AdaptiveIntelligenceModule } from '../adaptive-intelligence/adaptive-intelligence.module';
import { AutomationController } from './automation.controller';
import { AutomationService } from './automation.service';
import { CoachAdminController } from './coach-admin.controller';
import { CoachExperienceCalculatorService } from './coach-experience-calculator.service';
import { CoachExperienceService } from './coach-experience.service';
import { CoachIntelligenceService } from './coach-intelligence.service';
import { CoachMetricsService } from './coach-metrics.service';
import { CoachService } from './coach.service';
import { UserGoalEngineService } from './user-goal-engine.service';

@Module({
  imports: [
    AuthModule,
    BehaviorModule,
    EvolutionModule,
    NutritionModule,
    SubscriptionsModule,
    RecommendationModule,
    LongitudinalModule,
    AdaptiveIntelligenceModule,
  ],
  controllers: [AutomationController, CoachAdminController],
  providers: [
    AutomationService,
    CoachService,
    CoachIntelligenceService,
    CoachExperienceCalculatorService,
    CoachExperienceService,
    CoachMetricsService,
    UserGoalEngineService,
  ],
  exports: [
    AutomationService,
    CoachService,
    CoachIntelligenceService,
    CoachExperienceService,
  ],
})
export class AutomationModule {}
