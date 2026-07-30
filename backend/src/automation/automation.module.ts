import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BehaviorModule } from '../behavior/behavior.module';
import { EvolutionModule } from '../evolution/evolution.module';
import { NutritionModule } from '../nutrition/nutrition.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { DietModule } from '../diet/diet.module';
import { RecommendationModule } from '../recommendations/recommendation.module';
import { LongitudinalModule } from '../longitudinal/longitudinal.module';
import { AdaptiveIntelligenceModule } from '../adaptive-intelligence/adaptive-intelligence.module';
import { ContextModule } from '../context/context.module';
import { ConversationLayerOperationalConfigService } from '../responses/conversation-layer-operational-config.service';
import { WorkoutModule } from '../workout/workout.module';
import { AutomationController } from './automation.controller';
import { AutomationService } from './automation.service';
import { CoachCommandService } from './coach-command.service';
import { CoachAdminController } from './coach-admin.controller';
import { CoachExperienceCalculatorService } from './coach-experience-calculator.service';
import { CoachExperienceService } from './coach-experience.service';
import { CoachIntelligenceService } from './coach-intelligence.service';
import { CoachMetricsService } from './coach-metrics.service';
import { CoachPlanningExecutionDispatcherService } from './coach-planning-execution-dispatcher.service';
import { CoachPlanningExecutionService } from './coach-planning-execution.service';
import { CoachService } from './coach.service';
import { UserGoalEngineService } from './user-goal-engine.service';
import { ConversationGoalShadowComparator } from './conversation-goal-shadow-comparator';
import { ConversationGoalShadowConfigService } from './conversation-goal-shadow-config.service';
import { ConversationGoalShadowPipelineService } from './conversation-goal-shadow-pipeline.service';
import { LegacyCoachIntentAdapter } from './legacy-coach-intent.adapter';
import { NutritionShadowRuntimeModule } from '../diet/v2/shadow-runtime/nutrition-shadow-runtime.module';
import { NutritionExecutionModule } from '../diet/v2/execution/nutrition-execution.module';
import { NutritionV2PilotConfigService } from './nutrition-v2-pilot-config.service';
import { NutritionV2PilotService } from './nutrition-v2-pilot.service';

@Module({
  imports: [
    AuthModule,
    BehaviorModule,
    EvolutionModule,
    NutritionModule,
    SubscriptionsModule,
    DietModule,
    WorkoutModule,
    RecommendationModule,
    LongitudinalModule,
    AdaptiveIntelligenceModule,
    ContextModule,
    NutritionShadowRuntimeModule,
    NutritionExecutionModule,
  ],
  controllers: [AutomationController, CoachAdminController],
  providers: [
    AutomationService,
    CoachPlanningExecutionDispatcherService,
    CoachPlanningExecutionService,
    CoachCommandService,
    CoachService,
    CoachIntelligenceService,
    CoachExperienceCalculatorService,
    CoachExperienceService,
    CoachMetricsService,
    UserGoalEngineService,
    ConversationLayerOperationalConfigService,
    ConversationGoalShadowConfigService,
    LegacyCoachIntentAdapter,
    ConversationGoalShadowComparator,
    ConversationGoalShadowPipelineService,
    NutritionV2PilotConfigService,
    NutritionV2PilotService,
  ],
  exports: [
    AutomationService,
    CoachCommandService,
    CoachService,
    CoachIntelligenceService,
    CoachExperienceService,
  ],
})
export class AutomationModule {}
