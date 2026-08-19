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
import { ConversationRealizationModule } from '../responses/conversation-realization.module';
import { NutritionKnowledgeResolverService } from '../nutrition-knowledge/nutrition-knowledge-resolver.service';
import { NutritionReasoningEngineService } from '../nutrition-reasoning/nutrition-reasoning-engine.service';
import { WorkoutKnowledgeResolverService } from '../workout-knowledge/workout-knowledge-resolver.service';
import { WorkoutReasoningEngineService } from '../workout-reasoning/workout-reasoning-engine.service';
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
import { ConversationRuntimeModule } from '../conversation/runtime/conversation-runtime.module';
import { CoachPlanningConversationResponseService } from './coach-planning-conversation-response.service';
import { PlanningExecutionRoutePolicyService } from './planning-execution-route-policy.service';
import { CoachPlanningBothApplicationExecutorService } from './coach-planning-both-application-executor.service';
import { CurrentGoalCommitService } from './current-goal-commit.service';
import { PendingConversationActionService } from './pending-conversation-action.service';
import { AIModule } from '../ai/ai.module';
import { CoachProactiveSchedulePolicy } from './coach-proactive-schedule.policy';
import { CoachProactiveRealizerService } from './coach-proactive-realizer.service';
import { CoachProactiveResponseService } from './coach-proactive-response.service';

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
    ConversationRuntimeModule,
    ConversationRealizationModule,
    AIModule,
  ],
  controllers: [AutomationController, CoachAdminController],
  providers: [
    AutomationService,
    CoachPlanningExecutionDispatcherService,
    CoachPlanningExecutionService,
    CoachPlanningConversationResponseService,
    CoachCommandService,
    CoachService,
    CoachIntelligenceService,
    CoachExperienceCalculatorService,
    CoachExperienceService,
    CoachMetricsService,
    UserGoalEngineService,
    NutritionKnowledgeResolverService,
    NutritionReasoningEngineService,
    WorkoutKnowledgeResolverService,
    WorkoutReasoningEngineService,
    ConversationGoalShadowConfigService,
    LegacyCoachIntentAdapter,
    ConversationGoalShadowComparator,
    ConversationGoalShadowPipelineService,
    NutritionV2PilotConfigService,
    NutritionV2PilotService,
    PlanningExecutionRoutePolicyService,
    CoachPlanningBothApplicationExecutorService,
    CurrentGoalCommitService,
    PendingConversationActionService,
    CoachProactiveSchedulePolicy,
    CoachProactiveRealizerService,
    CoachProactiveResponseService,
  ],
  exports: [
    AutomationService,
    CoachCommandService,
    CoachService,
    CoachIntelligenceService,
    CoachExperienceService,
    CoachProactiveResponseService,
  ],
})
export class AutomationModule {}
