import type { ProfileAcquisitionDecision } from '../../context/coach-adaptive-profile-collector.contract';
import type { CoachProfileSnapshot } from '../../context/coach-profile-snapshot.contract';
import type {
  ConversationGoalPlannerInput,
  ConversationGoalRecentHistory,
} from '../../context/conversation-goal-planner.contract';
import type { ConversationContinuityContext } from './conversation-context.contract';
import type { ConversationUnderstandingResult } from './conversation-understanding.contract';

export const CONVERSATION_GOAL_PREPARATION_VERSION =
  'conversation-goal-preparation:v1' as const;

export interface ConversationGoalPreparationInput {
  readonly understanding: ConversationUnderstandingResult;
  readonly snapshot: CoachProfileSnapshot;
  readonly adaptiveDecision: ProfileAcquisitionDecision;
  readonly progressContextAvailable: boolean;
  readonly confirmationPending: boolean;
  readonly recentHistory: ConversationGoalRecentHistory;
  readonly continuity: ConversationContinuityContext;
  readonly referenceDate: string;
}

export type ConversationGoalPreparationResult = ConversationGoalPlannerInput;

export type ConversationGoalPreparationFailureCode =
  | 'UNDERSTANDING_FAILED'
  | 'UNDERSTANDING_AMBIGUOUS'
  | 'TARGET_PLAN_REQUIRED'
  | 'TARGET_PLAN_CONFLICT'
  | 'INVALID_REFERENCE_DATE'
  | 'INVALID_GOAL_HISTORY';

export class ConversationGoalPreparationError extends Error {
  constructor(
    readonly code: ConversationGoalPreparationFailureCode,
    message: string,
  ) {
    super(message);
    this.name = ConversationGoalPreparationError.name;
  }
}

export interface ConversationUnderstandingToGoalPlannerAdapterInput {
  readonly preparation: ConversationGoalPreparationInput;
  readonly targetPlan: 'DIET' | 'WORKOUT' | 'BOTH' | null;
}
