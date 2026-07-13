import type {
  ConversationCandidateFactory,
  ConversationCorpusScenario,
} from './conversation-offline-corpus.contract';
import type { LanguageRealizationResult } from './conversation-language-realization.contract';
import { NutritionConversationLanguageRealizer } from './nutrition-conversation-language-realizer';

export class NutritionConversationLanguageRealizerCorpusFactory implements ConversationCandidateFactory {
  constructor(
    private readonly languageRealizer: NutritionConversationLanguageRealizer,
  ) {}

  realize(
    scenario: ConversationCorpusScenario,
  ): Promise<LanguageRealizationResult> {
    return this.languageRealizer.realize(scenario.payload);
  }
}
