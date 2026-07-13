import type { AuthorizedFactId } from './conversation-authorized-facts.contract';
import type { SanitizedConversationDecision } from './sanitized-conversation-payload.contract';

export type ConversationLanguageUnitOmissionReason =
  | 'COMMUNICATIVE_BUDGET'
  | 'FACT_UNAVAILABLE'
  | 'STRUCTURE_CONFLICT'
  | 'SAFETY_RESTRICTION'
  | 'REALIZATION_FAILURE';

export type ConversationLanguageUnitType =
  | 'FACTUAL'
  | 'RELATIONAL'
  | 'TRANSITION'
  | 'DISCLAIMER'
  | 'QUESTION'
  | 'CLOSING';

export interface ConversationLanguageUnitClaims {
  readonly numbers: readonly number[];
  readonly foods: readonly string[];
  readonly usesMemory: boolean;
  readonly usesRecommendation: boolean;
}

export interface ConversationLanguageUnit {
  readonly blockKey: string;
  readonly unitType: ConversationLanguageUnitType;
  readonly decisionCodes: readonly SanitizedConversationDecision[];
  readonly factKeys: readonly AuthorizedFactId[];
  readonly text: string;
  readonly claims: ConversationLanguageUnitClaims;
}

export interface OmittedConversationLanguageUnit {
  readonly blockKey: string;
  readonly decisionCodes: readonly SanitizedConversationDecision[];
  readonly factKeys: readonly AuthorizedFactId[];
  readonly reason: ConversationLanguageUnitOmissionReason;
}

export type ConversationLanguageUnitViolationCode =
  | 'BLOCK_NOT_AUTHORIZED'
  | 'DECISION_NOT_AUTHORIZED'
  | 'FACT_NOT_AUTHORIZED'
  | 'FACT_NOT_LINKED_TO_BLOCK'
  | 'FACTUAL_UNIT_WITHOUT_FACTS'
  | 'NUMBER_NOT_AUTHORIZED'
  | 'FOOD_NOT_AUTHORIZED'
  | 'MEMORY_NOT_AUTHORIZED'
  | 'RECOMMENDATION_NOT_AUTHORIZED'
  | 'DUPLICATE_BLOCK_UNIT';

export interface ConversationLanguageUnitValidationResult {
  readonly valid: boolean;
  readonly units: readonly ConversationLanguageUnit[];
  readonly violations: readonly ConversationLanguageUnitViolationCode[];
}
