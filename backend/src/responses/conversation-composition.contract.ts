import type { AuthorizedFactId } from './conversation-authorized-facts.contract';
import type { ConversationDecisionId } from './conversation-decision.contract';

export type ConversationBlockId = string;

export type ConversationBlockType =
  | 'DIRECT_OPENING'
  | 'CONTEXTUAL_OPENING'
  | 'THREAD_RESUMPTION'
  | 'FACTUAL_ACKNOWLEDGEMENT'
  | 'EMOTIONAL_ACKNOWLEDGEMENT'
  | 'EFFORT_ACKNOWLEDGEMENT'
  | 'CELEBRATION'
  | 'DIRECT_ANSWER'
  | 'PRIMARY_OBSERVATION'
  | 'INTERPRETATION'
  | 'UNCERTAINTY_QUALIFICATION'
  | 'CAUSAL_EXPLANATION'
  | 'NUTRITION_EDUCATION'
  | 'CORRECTION'
  | 'PRIMARY_GUIDANCE'
  | 'PRACTICAL_ALTERNATIVE'
  | 'LIMITED_OPTIONS'
  | 'HISTORICAL_COMPARISON'
  | 'TREND'
  | 'RELATIONAL_MEMORY'
  | 'NORMALIZATION'
  | 'REFRAMING'
  | 'EVIDENCE_BASED_MOTIVATION'
  | 'AUTONOMY_REINFORCEMENT'
  | 'PROFESSIONAL_BOUNDARY'
  | 'REFERRAL'
  | 'CLARIFYING_QUESTION'
  | 'EXPERIENTIAL_QUESTION'
  | 'REFLECTIVE_QUESTION'
  | 'TOPIC_TRANSITION'
  | 'CONFIRMATION'
  | 'FACTUAL_REASSURANCE'
  | 'NEXT_STEP'
  | 'CONTINUITY_INVITATION'
  | 'CONFIRMING_CLOSURE'
  | 'REASSURING_CLOSURE'
  | 'OPEN_CLOSURE'
  | 'MINIMAL_CLOSURE';

export type ConversationPresentation = 'PROSE' | 'BULLETS' | 'NUMBERED_LIST';

export interface ConversationBlock {
  readonly id: ConversationBlockId;
  readonly type: ConversationBlockType;
  readonly decisionIds: readonly ConversationDecisionId[];
  readonly factIds: readonly AuthorizedFactId[];
  readonly order: number;
  readonly paragraph: number;
  readonly presentation: ConversationPresentation;
  readonly required: boolean;
  readonly maximumLength: number;
}

export type ConversationDepth =
  | 'MINIMAL'
  | 'BRIEF'
  | 'MODERATE'
  | 'DEEP'
  | 'EXTENSIVE';

export type ConversationDensity = 'LOW' | 'MEDIUM' | 'HIGH';

export type ConversationRhythm =
  | 'FAST'
  | 'WARM'
  | 'EXPLANATORY'
  | 'PROGRESSIVE'
  | 'DELIBERATIVE';

export type ConversationCentralIntent =
  | 'RECOGNIZE'
  | 'ADJUST'
  | 'CLARIFY'
  | 'TEACH'
  | 'RECOVER'
  | 'CELEBRATE'
  | 'FOLLOW_UP'
  | 'REASSURE'
  | 'ANALYZE';

export type ConversationDialogueProfile =
  | 'ACKNOWLEDGE_ONLY'
  | 'ACKNOWLEDGE_AND_ADJUST'
  | 'REFLECT_AND_ASK'
  | 'TEACH_BRIEFLY'
  | 'RECOVERY'
  | 'CELEBRATE'
  | 'DETAILED_ANALYSIS'
  | 'CLARIFY_BEFORE_ANALYSIS'
  | 'REASSURE_AND_SIMPLIFY'
  | 'CONTINUITY_CHECK';

export type ConversationClosingRequirement =
  | 'REQUIRED'
  | 'OPTIONAL'
  | 'PROHIBITED';

export interface ConversationProfileBudgets {
  readonly maximumPerceptibleDecisions: number;
  readonly maximumFactCount: number;
  readonly maximumBlockCount: number;
  readonly maximumParagraphCount: number;
  readonly maximumQuestions: number;
  readonly maximumActions: number;
  readonly maximumEmojiCount: number;
  readonly maximumLength: number;
}

export interface ConversationDialogueProfileDefinition {
  readonly profile: ConversationDialogueProfile;
  readonly centralIntent: ConversationCentralIntent;
  readonly allowedBlocks: readonly ConversationBlockType[];
  readonly prohibitedBlocks: readonly ConversationBlockType[];
  readonly depth: ConversationDepth;
  readonly density: ConversationDensity;
  readonly rhythm: ConversationRhythm;
  readonly budgets: ConversationProfileBudgets;
  readonly emojiAllowed: boolean;
  readonly closingRequirement: ConversationClosingRequirement;
  readonly eligibilityCodes: readonly string[];
}

export interface CompositionPlan {
  readonly id: string;
  readonly decisionPlanId: string;
  readonly blocks: readonly ConversationBlock[];
  readonly dialogueProfile: ConversationDialogueProfile;
  readonly centralIntent: ConversationCentralIntent;
  readonly profileBudgets: ConversationProfileBudgets;
  readonly closingRequirement: ConversationClosingRequirement;
  readonly depth: ConversationDepth;
  readonly density: ConversationDensity;
  readonly rhythm: ConversationRhythm;
  readonly presentation: ConversationPresentation;
  readonly paragraphCount: number;
  readonly maximumLength: number;
  readonly emojiAllowed: boolean;
  readonly maximumEmojiCount: number;
  readonly questionBlockId?: ConversationBlockId;
  readonly closingBlockId?: ConversationBlockId;
}
