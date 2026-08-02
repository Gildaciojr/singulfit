import type { ProfileAcquisitionField } from '../../context/coach-adaptive-profile-collector.contract';
import {
  CONVERSATION_UNDERSTANDING_VERSION,
  type ConversationUnderstandingInput,
} from '../contracts/conversation-understanding.contract';
import type { ConversationHistoryEntry } from '../contracts/conversation-context.contract';

export const UNDERSTANDING_REFERENCE_DATE = '2026-08-01T12:00:00.000Z';

export interface UnderstandingInputOptions {
  readonly pendingConfirmation?: boolean;
  readonly targetPlan?: 'DIET' | 'WORKOUT' | 'BOTH' | null;
  readonly activeProfileField?: ProfileAcquisitionField | null;
  readonly recentHistory?: readonly ConversationHistoryEntry[];
  readonly dietAvailable?: boolean;
  readonly workoutAvailable?: boolean;
  readonly messageId?: string;
}

export function understandingInput(
  text: string,
  options: UnderstandingInputOptions = {},
): ConversationUnderstandingInput {
  return Object.freeze({
    contractVersion: CONVERSATION_UNDERSTANDING_VERSION,
    userId: 'user-id',
    conversationId: 'conversation-id',
    messageId: options.messageId ?? 'message-id',
    channel: 'WHATSAPP',
    text,
    receivedAt: UNDERSTANDING_REFERENCE_DATE,
    profile: Object.freeze({
      completion: 'COMPLETE',
      missingFields: Object.freeze([]),
      confirmationRequiredFields: Object.freeze([]),
      currentPlans: Object.freeze({
        dietAvailable: options.dietAvailable ?? false,
        workoutAvailable: options.workoutAvailable ?? false,
      }),
      progressContextAvailable: false,
      safetyContextPresent: false,
      conflictCount: 0,
      referenceDate: UNDERSTANDING_REFERENCE_DATE,
    }),
    collector: null,
    recentHistory: Object.freeze([...(options.recentHistory ?? [])]),
    continuity: Object.freeze({
      currentLogicalTurn: 3,
      activeProfileField: options.activeProfileField ?? null,
      pendingConfirmation: options.pendingConfirmation ?? false,
      targetPlan: options.targetPlan ?? null,
    }),
  });
}

export function historyEntry(
  text: string,
  logicalTurn = 2,
): ConversationHistoryEntry {
  return Object.freeze({
    logicalTurn,
    direction: 'OUTBOUND',
    text,
    occurredAt: UNDERSTANDING_REFERENCE_DATE,
  });
}
