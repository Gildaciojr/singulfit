import type {
  CoachProfileAcquisitionField,
  ProfileAcquisitionMode,
} from './profile-acquisition.contract';

export type ProfileAcquisitionRolloutReason =
  | 'MODE_OFF'
  | 'USER_NOT_INTERNAL'
  | 'USER_NOT_ELIGIBLE'
  | 'OUTBOUND_NOT_FOUND'
  | 'OUTBOUND_NOT_SENT'
  | 'OUTBOUND_NOT_ELIGIBLE'
  | 'QUESTION_ALREADY_ACTIVE'
  | 'QUESTION_PREPARED'
  | 'QUESTION_RESUMED'
  | 'NO_ELIGIBLE_FIELD'
  | 'PLANNER_DID_NOT_REQUEST_ACQUISITION'
  | 'QUESTION_MAPPING_UNAVAILABLE'
  | 'MESSAGE_NOT_FOUND'
  | 'NO_ACTIVE_QUESTION'
  | 'QUESTION_NOT_SENT'
  | 'QUESTION_EXPIRED'
  | 'ANSWER_INVALID'
  | 'ANSWER_UNRELATED'
  | 'ANSWER_PERSISTED'
  | 'ANSWER_DECLINED'
  | 'ANSWER_DEFERRED'
  | 'CONFIRMATION_REQUESTED'
  | 'CONFIRMATION_COMPLETED'
  | 'CONFIRMATION_REJECTED'
  | 'CONFLICT'
  | 'DUPLICATE'
  | 'CONCURRENT_RESPONSE'
  | 'ROLLOUT_FAILURE';

export interface ProfileAcquisitionRolloutResult {
  readonly executed: boolean;
  readonly questionCreated: boolean;
  readonly reason: ProfileAcquisitionRolloutReason;
  readonly mode: ProfileAcquisitionMode;
  readonly cycleId: string | null;
  readonly field: CoachProfileAcquisitionField | null;
}

export interface ProfileAcquisitionCaptureResult {
  readonly handled: boolean;
  readonly duplicated: boolean;
  readonly persisted: boolean;
  readonly reason: ProfileAcquisitionRolloutReason;
  readonly cycleId: string | null;
  readonly field: CoachProfileAcquisitionField | null;
  readonly continuationMessageId?: string;
  readonly originalRequestMessageId?: string;
}

export interface ProfileAcquisitionRuntimeEvaluation {
  readonly logicalTurn: number;
  readonly selectedField: CoachProfileAcquisitionField | null;
  readonly canAsk: boolean;
  readonly reason:
    | 'READY'
    | 'NO_ELIGIBLE_FIELD'
    | 'PLANNER_DID_NOT_REQUEST_ACQUISITION'
    | 'QUESTION_MAPPING_UNAVAILABLE';
}

export interface ProfileAcquisitionInternalEligibility {
  readonly internal: boolean;
  readonly eligible: boolean;
  readonly reason:
    | 'INTERNAL_ELIGIBLE'
    | 'USER_NOT_INTERNAL'
    | 'USER_INACTIVE'
    | 'ONBOARDING_INCOMPLETE'
    | 'USER_NOT_FOUND';
}
