import type { ConversationUnderstandingInput } from './conversation-understanding.contract';
import type {
  ConversationEntity,
  ConversationReference,
} from './conversation-entity.contract';
import type {
  ConversationConfidence,
  ConversationDomain,
  ConversationIntent,
  ConversationOperation,
} from './conversation-intent.contract';
import type {
  ConversationAmbiguity,
  ConversationSafety,
} from './conversation-understanding.contract';

export interface NormalizedConversationMessage {
  readonly original: string;
  readonly canonical: string;
  readonly folded: string;
  readonly hasLexicalContent: boolean;
  readonly question: boolean;
}

export interface TokenizedConversationMessage {
  readonly tokens: readonly string[];
  readonly uniqueTokens: readonly string[];
}

export interface ConversationReferenceResolution {
  readonly references: readonly ConversationReference[];
  readonly usedRecentHistory: boolean;
  readonly usedContinuity: boolean;
  readonly usedProfile: boolean;
}

export interface ConversationEntityRecognition {
  readonly entities: readonly ConversationEntity[];
}

export interface ConversationOperationResolution {
  readonly operation: ConversationOperation;
  readonly candidates: readonly ConversationOperation[];
  readonly explicit: boolean;
}

export interface ConversationDomainResolution {
  readonly domain: ConversationDomain;
  readonly candidates: readonly ConversationDomain[];
  readonly contextual: boolean;
}

export interface ConversationIntentResolution {
  readonly intent: ConversationIntent;
  readonly confidence: ConversationConfidence;
}

export interface ConversationAmbiguityResolution {
  readonly ambiguity: ConversationAmbiguity;
}

export interface ConversationSafetyDetection {
  readonly safety: ConversationSafety;
  readonly entities: readonly ConversationEntity[];
}

export interface ConversationUnderstandingPipelineContext {
  readonly input: ConversationUnderstandingInput;
  readonly normalized: NormalizedConversationMessage;
  readonly tokenized: TokenizedConversationMessage;
  readonly references: ConversationReferenceResolution;
  readonly entities: ConversationEntityRecognition;
  readonly operation: ConversationOperationResolution;
  readonly domain: ConversationDomainResolution;
  readonly intent: ConversationIntentResolution;
  readonly ambiguity: ConversationAmbiguityResolution;
  readonly safety: ConversationSafetyDetection;
}
