import type { AuthorizedFactId } from './conversation-authorized-facts.contract';
import type {
  ConversationLanguageUnit,
  ConversationLanguageUnitOmissionReason,
  OmittedConversationLanguageUnit,
} from './conversation-language-unit.contract';
import type { SanitizedConversationDecision } from './sanitized-conversation-payload.contract';

export type LanguageRealizationStatus =
  | 'COMPLETED'
  | 'PARTIALLY_COMPLETED'
  | 'FALLBACK'
  | 'INVALID_STRUCTURE'
  | 'FAILED'
  | 'TIMED_OUT'
  | 'EMPTY';

export type LanguageRealizationOmissionReason =
  ConversationLanguageUnitOmissionReason;

export type LanguageRealizationFallbackReason =
  | 'PROVIDER_FAILURE'
  | 'TIMEOUT'
  | 'EMPTY_RESPONSE'
  | 'VALIDATION_REJECTED'
  | 'INVALID_STRUCTURE';

export interface LanguageRealizationFactOmission {
  readonly fact: AuthorizedFactId;
  readonly reason: LanguageRealizationOmissionReason;
}

export interface LanguageRealizationDecisionOmission {
  readonly decision: SanitizedConversationDecision;
  readonly reason: LanguageRealizationOmissionReason;
}

interface LanguageRealizationAudit {
  readonly candidateText: string | null;
  readonly candidateTextSource: 'VALIDATED_UNITS';
  readonly realizedUnits: readonly ConversationLanguageUnit[];
  readonly omittedUnits: readonly OmittedConversationLanguageUnit[];
  readonly realizedFacts: readonly AuthorizedFactId[];
  readonly omittedFacts: readonly LanguageRealizationFactOmission[];
  readonly realizedDecisions: readonly SanitizedConversationDecision[];
  readonly omittedDecisions: readonly LanguageRealizationDecisionOmission[];
  readonly disclaimerRealized: boolean;
  readonly questionRealized: boolean;
  readonly closingRealized: boolean;
  readonly producedLength: number;
  readonly producedQuestionCount: number;
  readonly warningCodes: readonly string[];
}

interface LanguageRealizationReference {
  readonly id: string;
  readonly sanitizedPayloadReference: string;
}

export type LanguageRealizationResult =
  | (LanguageRealizationReference &
      LanguageRealizationAudit & {
        readonly status: 'COMPLETED';
        readonly fallbackReason?: never;
        readonly failureCode?: never;
      })
  | (LanguageRealizationReference &
      LanguageRealizationAudit & {
        readonly status: 'PARTIALLY_COMPLETED';
        readonly fallbackReason?: never;
        readonly failureCode?: never;
      })
  | (LanguageRealizationReference &
      LanguageRealizationAudit & {
        readonly status: 'FALLBACK';
        readonly fallbackReason: LanguageRealizationFallbackReason;
        readonly failureCode?: string;
      })
  | (LanguageRealizationReference &
      LanguageRealizationAudit & {
        readonly status: 'INVALID_STRUCTURE';
        readonly candidateText: null;
        readonly fallbackReason: 'INVALID_STRUCTURE';
        readonly failureCode: string;
      })
  | (LanguageRealizationReference &
      LanguageRealizationAudit & {
        readonly status: 'FAILED' | 'TIMED_OUT' | 'EMPTY';
        readonly fallbackReason?: LanguageRealizationFallbackReason;
        readonly failureCode: string;
      });
