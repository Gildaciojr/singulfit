import type { LanguageRealizationStatus } from './conversation-language-realization.contract';

export type ConversationComparableOrigin = 'LEGACY' | 'CANDIDATE';

export interface ConversationComparableResponse {
  readonly origin: ConversationComparableOrigin;
  readonly content: string | null;
  readonly available: boolean;
  readonly eligible: boolean;
  readonly status: 'OFFICIAL' | LanguageRealizationStatus;
  readonly rejectionCode?: string;
  readonly characterCount: number;
}

export interface LegacyCandidateComparisonEnvelope {
  readonly legacy: ConversationComparableResponse;
  readonly candidate: ConversationComparableResponse;
  readonly selectedOrigin: 'LEGACY';
  readonly sanitizedPayloadReference: string | null;
}
