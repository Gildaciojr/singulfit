import { Module } from '@nestjs/common';
import { ContextModule } from '../../context/context.module';
import { ObservabilityModule } from '../../observability/observability.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { ConversationModule } from '../conversation.module';
import { ConversationExecutionBridgeService } from './conversation-execution-bridge.service';
import { ConversationLanguageRealizerService } from './conversation-language-realizer.service';
import { ConversationOfficialSelectionService } from './conversation-official-selection.service';
import { ConversationResponseFormatterService } from './conversation-response-formatter.service';
import { ConversationResponsePayloadBuilder } from './conversation-response-payload.builder';
import { ConversationResponseValidatorService } from './conversation-response-validator.service';
import { ConversationRuntimeAuditService } from './conversation-runtime-audit.service';
import { ConversationRuntimeIntegrationService } from './conversation-runtime-integration.service';
import { ConversationRuntimeOperationalConfigService } from './conversation-runtime-operational-config.service';
import { ConversationRuntimeService } from './conversation-runtime.service';
import { ConversationShadowComparatorService } from './conversation-shadow-comparator.service';
import { ConversationTurnContextBuilderService } from './conversation-turn-context-builder.service';
import { AIModule } from '../../ai/ai.module';
import { DietModule } from '../../diet/diet.module';
import { ConversationCurrentNutritionContextService } from './conversation-current-nutrition-context.service';
import { ConversationPublicAnswerBoundaryService } from './conversation-public-answer-boundary.service';
import { ConversationQAExecutorService } from './conversation-qa-executor.service';
import { ConversationQAFollowUpContextService } from './conversation-qa-follow-up-context.service';

@Module({
  imports: [
    PrismaModule,
    ObservabilityModule,
    ContextModule,
    ConversationModule,
    AIModule,
    DietModule,
  ],
  providers: [
    ConversationRuntimeOperationalConfigService,
    ConversationTurnContextBuilderService,
    ConversationRuntimeService,
    ConversationResponsePayloadBuilder,
    ConversationLanguageRealizerService,
    ConversationResponseFormatterService,
    ConversationResponseValidatorService,
    ConversationExecutionBridgeService,
    ConversationOfficialSelectionService,
    ConversationShadowComparatorService,
    ConversationRuntimeAuditService,
    ConversationRuntimeIntegrationService,
    ConversationCurrentNutritionContextService,
    ConversationPublicAnswerBoundaryService,
    ConversationQAExecutorService,
    ConversationQAFollowUpContextService,
  ],
  exports: [
    ConversationRuntimeOperationalConfigService,
    ConversationRuntimeService,
    ConversationExecutionBridgeService,
    ConversationOfficialSelectionService,
    ConversationRuntimeIntegrationService,
  ],
})
export class ConversationRuntimeModule {}
