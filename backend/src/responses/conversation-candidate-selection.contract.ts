export const CONVERSATION_SELECTION_ROLLOUT_MODE = {
  OFF: 'OFF',
  INTERNAL: 'INTERNAL',
  CANARY: 'CANARY',
  ROLLOUT: 'ROLLOUT',
  PRIMARY: 'PRIMARY',
} as const;

export type ConversationSelectionRolloutMode =
  (typeof CONVERSATION_SELECTION_ROLLOUT_MODE)[keyof typeof CONVERSATION_SELECTION_ROLLOUT_MODE];

export const CONVERSATION_SELECTED_SOURCE = {
  FORMATTER: 'FORMATTER',
  CANDIDATE: 'CANDIDATE',
} as const;

export type ConversationSelectedSource =
  (typeof CONVERSATION_SELECTED_SOURCE)[keyof typeof CONVERSATION_SELECTED_SOURCE];

export const CANDIDATE_SELECTION_STATUS = {
  FORMATTER_SELECTED: 'FORMATTER_SELECTED',
  NO_CANDIDATE: 'NO_CANDIDATE',
  INVALID_CANDIDATE: 'INVALID_CANDIDATE',
  VALID_CANDIDATE_NOT_SELECTED: 'VALID_CANDIDATE_NOT_SELECTED',
  FUTURE_ROLLOUT_DISABLED: 'FUTURE_ROLLOUT_DISABLED',
} as const;

export type CandidateSelectionStatus =
  (typeof CANDIDATE_SELECTION_STATUS)[keyof typeof CANDIDATE_SELECTION_STATUS];

export const CANDIDATE_SELECTION_REASON = {
  CANDIDATE_UNAVAILABLE: 'CANDIDATE_UNAVAILABLE',
  CANDIDATE_VALIDATION_FAILED: 'CANDIDATE_VALIDATION_FAILED',
  ROLLOUT_MODE_OFF: 'ROLLOUT_MODE_OFF',
  FORMATTER_POLICY_ENFORCED: 'FORMATTER_POLICY_ENFORCED',
} as const;

export type CandidateSelectionReason =
  (typeof CANDIDATE_SELECTION_REASON)[keyof typeof CANDIDATE_SELECTION_REASON];

export interface CandidateSelectionComparisonMetrics {
  readonly formatterLength: number;
  readonly candidateLength: number;
  readonly candidateUnitCount: number;
  readonly disclaimerPresent: boolean;
  readonly requiredFactsPresent: boolean;
  readonly structureValid: boolean;
  readonly humanizerScore: number;
  readonly validatorScore: number;
}

export interface SelectedCandidateDecision {
  readonly selectedSource: ConversationSelectedSource;
  readonly reason: CandidateSelectionReason;
  readonly comparisonScore: number;
  readonly promptVersionId: string | null;
  readonly candidateJobId: string | null;
  readonly formatterVersion: string;
  readonly selectionStatus: CandidateSelectionStatus;
  readonly rolloutMode: ConversationSelectionRolloutMode;
  readonly candidateAvailable: boolean;
  readonly candidateValid: boolean;
  readonly timestamp: string;
  readonly metrics: CandidateSelectionComparisonMetrics;
}
