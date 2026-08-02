import type {
  ProfileAcquisitionDecisionReason,
  ProfileAcquisitionField,
  ProfileAcquisitionIntent,
} from '../../context/coach-adaptive-profile-collector.contract';
import type {
  CoachProfileCompletionState,
  CoachProfileField,
} from '../../context/coach-profile-snapshot.contract';

export type ConversationChannel =
  | 'WHATSAPP'
  | 'API'
  | 'APP'
  | 'DASHBOARD'
  | 'OTHER';

export interface ConversationHistoryEntry {
  readonly logicalTurn: number;
  readonly direction: 'INBOUND' | 'OUTBOUND';
  readonly text: string;
  readonly occurredAt: string;
}

export interface ConversationProfileContext {
  readonly completion: CoachProfileCompletionState;
  readonly missingFields: readonly CoachProfileField[];
  readonly confirmationRequiredFields: readonly CoachProfileField[];
  readonly currentPlans: {
    readonly dietAvailable: boolean;
    readonly workoutAvailable: boolean;
  };
  readonly progressContextAvailable: boolean;
  readonly safetyContextPresent: boolean;
  readonly conflictCount: number;
  readonly referenceDate: string;
}

export interface ConversationCollectorContext {
  readonly intent: ProfileAcquisitionIntent;
  readonly shouldAsk: boolean;
  readonly selectedField: ProfileAcquisitionField | null;
  readonly readyPlans: readonly ('DIET' | 'WORKOUT')[];
  readonly blockedPlans: readonly ('DIET' | 'WORKOUT')[];
  readonly reason: ProfileAcquisitionDecisionReason;
}

export interface ConversationContinuityContext {
  readonly currentLogicalTurn: number;
  readonly activeProfileField: ProfileAcquisitionField | null;
  readonly pendingConfirmation: boolean;
  readonly targetPlan: 'DIET' | 'WORKOUT' | 'BOTH' | null;
}
