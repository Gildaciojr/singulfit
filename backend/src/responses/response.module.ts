import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AutomationModule } from '../automation/automation.module';
import { BehaviorModule } from '../behavior/behavior.module';
import { NutritionModule } from '../nutrition/nutrition.module';
import { AIQualityModule } from '../ai-quality/ai-quality.module';
import { RecommendationModule } from '../recommendations/recommendation.module';
import { LongitudinalModule } from '../longitudinal/longitudinal.module';
import { ConversationRealizationModule } from './conversation-realization.module';
import { NutritionResponseFormatter } from './nutrition-response.formatter';
import { ResponseBuilderService } from './response-builder.service';
import { ResponseController } from './response.controller';
import { NutritionConversationContextBuilder } from './nutrition-conversation-context.builder';
import { NutritionConversationDecisionEngine } from './nutrition-conversation-decision-engine';
import { NutritionConversationDecisionScoringPolicy } from './nutrition-conversation-decision-scoring-policy';
import { NutritionConversationComposer } from './nutrition-conversation-composer';
import { NutritionConversationAuthorizedFactsBuilder } from './nutrition-conversation-authorized-facts.builder';
import { SanitizedConversationPayloadBuilder } from './sanitized-conversation-payload.builder';
import { NutritionConversationShadowPipelineService } from './nutrition-conversation-shadow-pipeline.service';
import { ConversationShadowDiagnosticsService } from './conversation-shadow-diagnostics.service';
import { NutritionConversationEpisodicMemoryCaptureEngine } from './nutrition-conversation-episodic-memory-capture.engine';
import { NutritionConversationEpisodicMemoryIntegrationService } from './nutrition-conversation-episodic-memory-integration.service';
import { NutritionConversationEpisodicMemoryPersistenceService } from './nutrition-conversation-episodic-memory-persistence.service';

@Module({
  imports: [
    AuthModule,
    AutomationModule,
    BehaviorModule,
    NutritionModule,
    AIQualityModule,
    RecommendationModule,
    LongitudinalModule,
    ConversationRealizationModule,
  ],
  controllers: [ResponseController],
  providers: [
    ResponseBuilderService,
    NutritionResponseFormatter,
    NutritionConversationContextBuilder,
    NutritionConversationDecisionEngine,
    NutritionConversationDecisionScoringPolicy,
    NutritionConversationComposer,
    NutritionConversationAuthorizedFactsBuilder,
    SanitizedConversationPayloadBuilder,
    ConversationShadowDiagnosticsService,
    NutritionConversationShadowPipelineService,
    NutritionConversationEpisodicMemoryCaptureEngine,
    NutritionConversationEpisodicMemoryPersistenceService,
    NutritionConversationEpisodicMemoryIntegrationService,
  ],
  exports: [ResponseBuilderService, NutritionResponseFormatter],
})
export class ResponseModule {}
