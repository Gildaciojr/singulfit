import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AutomationModule } from '../automation/automation.module';
import { BehaviorModule } from '../behavior/behavior.module';
import { NutritionModule } from '../nutrition/nutrition.module';
import { AIQualityModule } from '../ai-quality/ai-quality.module';
import { RecommendationModule } from '../recommendations/recommendation.module';
import { LongitudinalModule } from '../longitudinal/longitudinal.module';
import { AIModule } from '../ai/ai.module';
import { NutritionResponseFormatter } from './nutrition-response.formatter';
import { ResponseBuilderService } from './response-builder.service';
import { ResponseController } from './response.controller';
import { NutritionConversationContextBuilder } from './nutrition-conversation-context.builder';
import { ConversationLayerOperationalConfigService } from './conversation-layer-operational-config.service';
import { NutritionConversationDecisionEngine } from './nutrition-conversation-decision-engine';
import { NutritionConversationDecisionScoringPolicy } from './nutrition-conversation-decision-scoring-policy';
import { NutritionConversationComposer } from './nutrition-conversation-composer';
import { NutritionConversationAuthorizedFactsBuilder } from './nutrition-conversation-authorized-facts.builder';
import { SanitizedConversationPayloadBuilder } from './sanitized-conversation-payload.builder';
import { NutritionConversationLanguageRealizer } from './nutrition-conversation-language-realizer';
import { NutritionConversationShadowPipelineService } from './nutrition-conversation-shadow-pipeline.service';
import { NutritionConversationLegacyCandidateAdapter } from './nutrition-conversation-legacy-candidate.adapter';
import { NutritionConversationComparator } from './nutrition-conversation-comparator';
import { ConversationShadowDiagnosticsService } from './conversation-shadow-diagnostics.service';

@Module({
  imports: [
    AuthModule,
    AutomationModule,
    BehaviorModule,
    NutritionModule,
    AIQualityModule,
    RecommendationModule,
    LongitudinalModule,
    AIModule,
  ],
  controllers: [ResponseController],
  providers: [
    ResponseBuilderService,
    NutritionResponseFormatter,
    NutritionConversationContextBuilder,
    ConversationLayerOperationalConfigService,
    NutritionConversationDecisionEngine,
    NutritionConversationDecisionScoringPolicy,
    NutritionConversationComposer,
    NutritionConversationAuthorizedFactsBuilder,
    SanitizedConversationPayloadBuilder,
    NutritionConversationLanguageRealizer,
    NutritionConversationLegacyCandidateAdapter,
    NutritionConversationComparator,
    ConversationShadowDiagnosticsService,
    NutritionConversationShadowPipelineService,
  ],
  exports: [ResponseBuilderService, NutritionResponseFormatter],
})
export class ResponseModule {}
