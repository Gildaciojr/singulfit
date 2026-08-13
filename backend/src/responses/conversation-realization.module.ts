import { Module } from '@nestjs/common';
import { AIModule } from '../ai/ai.module';
import { ConversationLayerOperationalConfigService } from './conversation-layer-operational-config.service';
import { ConversationSelectionConfigService } from './conversation-selection-config.service';
import { NutritionConversationCandidateSelectionAuditService } from './nutrition-conversation-candidate-selection-audit.service';
import { NutritionConversationCandidateSelectorService } from './nutrition-conversation-candidate-selector.service';
import { NutritionConversationComparator } from './nutrition-conversation-comparator';
import { NutritionConversationLanguageRealizer } from './nutrition-conversation-language-realizer';
import { NutritionConversationLegacyCandidateAdapter } from './nutrition-conversation-legacy-candidate.adapter';
import { NutritionConversationRealizationExecutorService } from './nutrition-conversation-realization-executor.service';
import { ConversationReasoningBridgeService } from './reasoning-bridge/conversation-reasoning-bridge.service';
import { NutritionConversationInternalEligibilityService } from './nutrition-conversation-internal-eligibility.service';

const PROVIDERS = [
  ConversationLayerOperationalConfigService,
  ConversationSelectionConfigService,
  NutritionConversationInternalEligibilityService,
  NutritionConversationLanguageRealizer,
  NutritionConversationRealizationExecutorService,
  NutritionConversationLegacyCandidateAdapter,
  NutritionConversationComparator,
  NutritionConversationCandidateSelectorService,
  NutritionConversationCandidateSelectionAuditService,
  ConversationReasoningBridgeService,
] as const;

@Module({
  imports: [AIModule],
  providers: [...PROVIDERS],
  exports: [...PROVIDERS],
})
export class ConversationRealizationModule {}
