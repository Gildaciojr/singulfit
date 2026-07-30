import type {
  AuthorizedFactId,
  AuthorizedFactSource,
  AuthorizedFactValue,
} from './conversation-authorized-facts.contract';
import type {
  ConversationBlockType,
  ConversationCentralIntent,
  ConversationClosingRequirement,
  ConversationDialogueProfile,
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
import type { NutritionConversationCoachStyle } from './nutrition-conversation-coach-style.contract';

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
  | 'USE_EMOJI'
  | 'ACKNOWLEDGE_EFFORT'
  | 'ACKNOWLEDGE_PROGRESS'
  | 'ACKNOWLEDGE_RECOVERY'
  | 'ACKNOWLEDGE_SMALL_WIN'
  | 'ACKNOWLEDGE_CONSISTENCY'
  | 'ACKNOWLEDGE_STRATEGY'
  | 'ACKNOWLEDGE_DISCIPLINE'
  | 'ACKNOWLEDGE_IMPROVEMENT'
  | 'VALIDATE_FRUSTRATION'
  | 'REINFORCE_CONFIDENCE'
  | 'REDUCE_COGNITIVE_LOAD'
  | 'NORMALIZE_SETBACK'
  | 'SIMPLIFY_GUIDANCE'
  | 'ENCOURAGE_CONTINUITY'
  | 'ANSWER_CURIOSITY'
  | 'CLARIFY_BEFORE_ANALYSIS'
  | 'TEACH_BRIEFLY'
  | 'DETAIL_ANALYSIS'
  | 'FOLLOW_UP_COMMITMENT'
  | 'FOLLOW_UP_EPISODE'
  | 'CONTINUE_STRATEGY'
  | 'CHECK_COMMITMENT'
  | 'RECALL_SUCCESS'
  | 'RECALL_SETBACK'
  | 'RECALL_DIFFICULTY'
  | 'RECALL_GOAL';

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
    readonly dialogueProfile: ConversationDialogueProfile;
    readonly centralIntent: ConversationCentralIntent;
    readonly blocks: readonly SanitizedConversationBlock[];
    readonly depth: ConversationDepth;
    readonly density: ConversationDensity;
    readonly rhythm: ConversationRhythm;
    readonly presentation: ConversationPresentation;
    readonly paragraphCount: number;
  };
  readonly style: {
    readonly coach: NutritionConversationCoachStyle;
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
    readonly maximumFacts: number;
    readonly maximumBlocks: number;
    readonly maximumParagraphs: number;
  };
  readonly policies: {
    readonly estimateQualificationRequired: boolean;
    readonly emojiAllowed: boolean;
    readonly closingRequirement: ConversationClosingRequirement;
  };
}
