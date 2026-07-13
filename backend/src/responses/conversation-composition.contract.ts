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

export interface CompositionPlan {
  readonly id: string;
  readonly decisionPlanId: string;
  readonly blocks: readonly ConversationBlock[];
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
