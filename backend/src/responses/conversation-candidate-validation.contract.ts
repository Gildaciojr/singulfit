import type { AuthorizedFactId } from './conversation-authorized-facts.contract';
import type { ConversationDecisionId } from './conversation-decision.contract';

export type CandidateValidationSeverity = 'INFO' | 'WARNING' | 'CRITICAL';

export type CandidateValidationCategory =
  | 'FACTUALITY'
  | 'DECISION_COVERAGE'
  | 'COMPOSITION_ADHERENCE'
  | 'SAFETY'
  | 'LENGTH'
  | 'QUESTION'
  | 'NUMBER'
  | 'MEMORY'
  | 'DISCLAIMER';

export interface CandidateValidationViolation {
  readonly code: string;
  readonly category: CandidateValidationCategory;
  readonly severity: CandidateValidationSeverity;
  readonly factId?: AuthorizedFactId;
  readonly decisionId?: ConversationDecisionId;
  readonly blockId?: string;
}

export interface CandidateValidationResult {
  readonly realizationId: string;
  readonly eligible: boolean;
  readonly fallbackRequired: boolean;
  readonly violations: readonly CandidateValidationViolation[];
  readonly validatedFactIds: readonly AuthorizedFactId[];
  readonly coveredDecisionIds: readonly ConversationDecisionId[];
}
