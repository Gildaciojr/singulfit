import type {
  AuthorizedFactId,
  AuthorizedFactSource,
  AuthorizedFactValue,
} from './conversation-authorized-facts.contract';
import type {
  ConversationBlockType,
  ConversationDensity,
  ConversationDepth,
  ConversationPresentation,
  ConversationRhythm,
} from './conversation-composition.contract';
import type {
  NutritionConversationCommunicationStyle,
  NutritionConversationContext,
  NutritionConversationMotivationFocus,
} from './nutrition-conversation-context.interface';

export type SanitizedConversationDecision =
  | 'RESPOND_TO_MEAL'
  | 'QUALIFY_ESTIMATES'
  | 'ACKNOWLEDGE_MEAL'
  | 'SHOW_CALORIES'
  | 'SHOW_PROTEIN'
  | 'SHOW_CARBOHYDRATES'
  | 'SHOW_FAT'
  | 'SHOW_QUALITY'
  | 'MENTION_GOAL'
  | 'USE_MEMORY'
  | 'COMPARE_HISTORY'
  | 'MENTION_INSIGHT'
  | 'MENTION_TREND'
  | 'MENTION_LONGITUDINAL'
  | 'PROVIDE_RECOMMENDATION'
  | 'ACKNOWLEDGE_POSITIVE'
  | 'CORRECT_LIMITING_FACTOR'
  | 'CELEBRATE_IMPROVEMENT'
  | 'MOTIVATE_WITH_EVIDENCE'
  | 'ASK_QUESTION'
  | 'CLOSE_WITHOUT_QUESTION'
  | 'RESPOND_BRIEFLY'
  | 'REDUCE_CONVERSATIONAL_LOAD'
  | 'USE_EMOJI';

export interface SanitizedConversationFact {
  readonly key: AuthorizedFactId;
  readonly source: AuthorizedFactSource;
  readonly value: AuthorizedFactValue;
  readonly confidence?: number;
  readonly estimated: boolean;
}
export interface SanitizedConversationBlock {
  readonly key: string;
  readonly type: ConversationBlockType;
  readonly decisions: readonly SanitizedConversationDecision[];
  readonly facts: readonly AuthorizedFactId[];
  readonly order: number;
  readonly paragraph: number;
  readonly presentation: ConversationPresentation;
  readonly required: boolean;
  readonly maximumLength: number;
}

export interface SanitizedConversationPayload {
  readonly facts: {
    readonly allowed: readonly SanitizedConversationFact[];
    readonly sensitive: readonly SanitizedConversationFact[];
    readonly disclaimerRequired: readonly AuthorizedFactId[];
  };
  readonly selectedDecisions: readonly SanitizedConversationDecision[];
  readonly structure: {
    readonly blocks: readonly SanitizedConversationBlock[];
    readonly depth: ConversationDepth;
    readonly density: ConversationDensity;
    readonly rhythm: ConversationRhythm;
    readonly presentation: ConversationPresentation;
    readonly paragraphCount: number;
  };
  readonly style: {
    readonly communication: NutritionConversationCommunicationStyle;
    readonly coaching: NutritionConversationContext['communication']['coachingStyle'];
    readonly tone: NutritionConversationContext['communication']['tone'];
    readonly motivationFocus: NutritionConversationMotivationFocus;
    readonly stageOfChange: NutritionConversationContext['communication']['stageOfChange'];
  };
  readonly limits: {
    readonly maximumLength: number;
    readonly maximumEmojiCount: number;
    readonly maximumQuestions: number;
    readonly maximumActions: number;
  };
  readonly policies: {
    readonly estimateQualificationRequired: boolean;
    readonly emojiAllowed: boolean;
  };
}
