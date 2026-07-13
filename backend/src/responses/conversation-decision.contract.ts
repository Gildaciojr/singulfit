import type { AuthorizedFactId } from './conversation-authorized-facts.contract';

export type ConversationDecisionId = string;
export type ConversationDecisionCode = string;

export type ConversationDecisionCategory =
  | 'SAFETY'
  | 'INTENT'
  | 'RECOGNITION'
  | 'EMPATHY'
  | 'CELEBRATION'
  | 'CORRECTION'
  | 'EDUCATION'
  | 'MOTIVATION'
  | 'MEMORY'
  | 'CONTINUITY'
  | 'CURIOSITY'
  | 'CLOSURE'
  | 'PRESENTATION';

export type ConversationDecisionIntrinsicPriority =
  | 'P0'
  | 'P1'
  | 'P2'
  | 'P3'
  | 'P4'
  | 'P5';

export interface DecisionCandidate {
  readonly id: ConversationDecisionId;
  readonly code: ConversationDecisionCode;
  readonly category: ConversationDecisionCategory;
  readonly intrinsicPriority: ConversationDecisionIntrinsicPriority;
  readonly required: boolean;
  readonly prohibited: boolean;
  readonly factIds: readonly AuthorizedFactId[];
  readonly dependencyIds: readonly ConversationDecisionId[];
  readonly complementaryIds: readonly ConversationDecisionId[];
  readonly conflictingIds: readonly ConversationDecisionId[];
  readonly objectiveCode: string;
}

export interface SelectedDecision {
  readonly candidateId: ConversationDecisionId;
  readonly code: ConversationDecisionCode;
  readonly intrinsicPriority: ConversationDecisionIntrinsicPriority;
  readonly order: number;
  readonly factIds: readonly AuthorizedFactId[];
  readonly rationaleCodes: readonly string[];
}

export type DecisionSuppressionReason =
  | 'PROHIBITED'
  | 'CONFLICT'
  | 'REDUNDANT'
  | 'FATIGUE'
  | 'LOW_RELEVANCE'
  | 'BUDGET_EXCEEDED'
  | 'MISSING_DEPENDENCY'
  | 'INSUFFICIENT_CONFIDENCE'
  | 'CONTEXT_MISMATCH';

export interface SuppressedDecision {
  readonly candidateId: ConversationDecisionId;
  readonly code: ConversationDecisionCode;
  readonly reason: DecisionSuppressionReason;
  readonly conflictingDecisionId?: ConversationDecisionId;
  readonly rationaleCodes: readonly string[];
}

export interface DecisionPlan {
  readonly id: string;
  readonly primaryDecisionId: ConversationDecisionId;
  readonly selectedDecisions: readonly SelectedDecision[];
  readonly suppressedDecisions: readonly SuppressedDecision[];
  readonly mandatoryDecisionIds: readonly ConversationDecisionId[];
  readonly prohibitedDecisionCodes: readonly ConversationDecisionCode[];
  readonly maximumCommunicativeDecisions: number;
  readonly maximumQuestions: number;
  readonly maximumActions: number;
}
