export type ConversationComparisonOutcome = 'LEGACY_PREFERRED';

export type ConversationCandidateState =
  | 'NOT_EXECUTED'
  | 'GENERATED'
  | 'ELIGIBLE'
  | 'INELIGIBLE'
  | 'PARTIAL'
  | 'FALLBACK'
  | 'TIMEOUT'
  | 'PROVIDER_FAILURE'
  | 'INVALID_STRUCTURE';

export type ConversationComparisonCheckCode =
  | 'CANDIDATE_AVAILABLE'
  | 'CANDIDATE_ELIGIBLE'
  | 'AUTHORIZED_FACTS_PRESERVED'
  | 'AUTHORIZED_NUMBERS_PRESERVED'
  | 'DISCLAIMER_PRESERVED'
  | 'QUESTION_AUTHORIZED'
  | 'CLOSING_PRESERVED'
  | 'LENGTH_WITHIN_LIMIT'
  | 'PARAGRAPH_COUNT_WITHIN_PLAN'
  | 'LIST_PRESENTATION_VALID'
  | 'QUESTION_COUNT_VALID'
  | 'EMOJI_COUNT_VALID'
  | 'NO_TECHNICAL_TITLE'
  | 'NO_REPORT_STRUCTURE'
  | 'DECISIONS_COVERED'
  | 'BLOCKS_COVERED'
  | 'NO_UNDECLARED_OMISSIONS'
  | 'NO_STRUCTURAL_REPETITION';

export interface ConversationComparisonCheck {
  readonly code: ConversationComparisonCheckCode;
  readonly passed: boolean;
  readonly warning: boolean;
}

export interface ConversationComparisonMetrics {
  readonly legacyCharacters: number;
  readonly candidateCharacters: number;
  readonly legacyParagraphs: number;
  readonly candidateParagraphs: number;
  readonly legacyQuestions: number;
  readonly candidateQuestions: number;
  readonly legacyEmojis: number;
  readonly candidateEmojis: number;
  readonly candidateOmissions: number;
  readonly incrementalLatencyMs: number;
  readonly promptTokens: number | null;
  readonly completionTokens: number | null;
  readonly totalTokens: number | null;
}

export interface ConversationComparisonResult {
  readonly outcome: ConversationComparisonOutcome;
  readonly selectedOrigin: 'LEGACY';
  readonly candidateState: ConversationCandidateState;
  readonly candidateEligible: boolean;
  readonly ineligibilityCode?: string;
  readonly passedChecks: readonly ConversationComparisonCheckCode[];
  readonly failedChecks: readonly ConversationComparisonCheckCode[];
  readonly warnings: readonly ConversationComparisonCheckCode[];
  readonly divergenceCodes: readonly string[];
  readonly checks: readonly ConversationComparisonCheck[];
  readonly metrics: ConversationComparisonMetrics;
}
