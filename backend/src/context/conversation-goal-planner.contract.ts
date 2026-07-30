import type {
  ProfileAcquisitionDecision,
  ProfileAcquisitionField,
  ProfileAcquisitionPlan,
} from './coach-adaptive-profile-collector.contract';
import type {
  CoachProfileCompletionState,
  CoachProfileCompletionStatus,
  CoachProfileSnapshot,
} from './coach-profile-snapshot.contract';

export const CONVERSATION_RECOGNIZED_INTENT = {
  COMMON_MESSAGE: 'COMMON_MESSAGE',
  NUTRITION_QUESTION: 'NUTRITION_QUESTION',
  DIET_PLAN_REQUEST: 'DIET_PLAN_REQUEST',
  WORKOUT_PLAN_REQUEST: 'WORKOUT_PLAN_REQUEST',
  COMBINED_PLAN_REQUEST: 'COMBINED_PLAN_REQUEST',
  DIET_PLAN_UPDATE_REQUEST: 'DIET_PLAN_UPDATE_REQUEST',
  WORKOUT_PLAN_UPDATE_REQUEST: 'WORKOUT_PLAN_UPDATE_REQUEST',
  PROGRESS_REVIEW_REQUEST: 'PROGRESS_REVIEW_REQUEST',
  CONFIRMATION_REQUIRED: 'CONFIRMATION_REQUIRED',
  CURRENT_PLAN_REQUEST: 'CURRENT_PLAN_REQUEST',
  PLAN_STATUS_REQUEST: 'PLAN_STATUS_REQUEST',
  GENERAL_GUIDANCE_REQUEST: 'GENERAL_GUIDANCE_REQUEST',
  UNKNOWN: 'UNKNOWN',
} as const;

export type ConversationRecognizedIntent =
  (typeof CONVERSATION_RECOGNIZED_INTENT)[keyof typeof CONVERSATION_RECOGNIZED_INTENT];

export const CONVERSATION_GOAL = {
  ANSWER_MESSAGE: 'ANSWER_MESSAGE',
  ASK_PROFILE_INFORMATION: 'ASK_PROFILE_INFORMATION',
  GENERATE_DIET_PLAN: 'GENERATE_DIET_PLAN',
  GENERATE_WORKOUT_PLAN: 'GENERATE_WORKOUT_PLAN',
  GENERATE_COMBINED_PLANS: 'GENERATE_COMBINED_PLANS',
  UPDATE_DIET_PLAN: 'UPDATE_DIET_PLAN',
  UPDATE_WORKOUT_PLAN: 'UPDATE_WORKOUT_PLAN',
  REVIEW_PROGRESS: 'REVIEW_PROGRESS',
  REQUEST_CONFIRMATION: 'REQUEST_CONFIRMATION',
  SHOW_CURRENT_PLAN: 'SHOW_CURRENT_PLAN',
  SHOW_PLAN_STATUS: 'SHOW_PLAN_STATUS',
  GENERAL_GUIDANCE: 'GENERAL_GUIDANCE',
  UNKNOWN: 'UNKNOWN',
} as const;

export type ConversationGoal =
  (typeof CONVERSATION_GOAL)[keyof typeof CONVERSATION_GOAL];

export type ConversationGoalPlanTarget = ProfileAcquisitionPlan | 'BOTH';

export interface ConversationGoalContext {
  readonly planTarget?: ConversationGoalPlanTarget;
  readonly progressContextAvailable: boolean;
  readonly confirmationRequired: boolean;
}

export type ConversationGoalHistoryStatus =
  | 'PLANNED'
  | 'EXECUTING'
  | 'COMPLETED'
  | 'FAILED';

export interface ConversationGoalHistoryEntry {
  readonly goal: ConversationGoal;
  readonly status: ConversationGoalHistoryStatus;
  readonly logicalTurn: number;
}

export interface ConversationGoalRecentHistory {
  readonly currentLogicalTurn: number;
  readonly entries: readonly ConversationGoalHistoryEntry[];
}

export type ConversationGoalPrecondition =
  | {
      readonly kind: 'PLAN_PROFILE_READY';
      readonly plan: ProfileAcquisitionPlan;
    }
  | {
      readonly kind: 'PROFILE_FIELD_AVAILABLE';
      readonly field: ProfileAcquisitionField;
    }
  | {
      readonly kind: 'CURRENT_PLAN_AVAILABLE';
      readonly plan: ProfileAcquisitionPlan;
    }
  | {
      readonly kind: 'PROGRESS_CONTEXT_AVAILABLE';
    }
  | {
      readonly kind: 'CONFIRMATION_CONTEXT_AVAILABLE';
    }
  | {
      readonly kind: 'PLAN_TARGET_AVAILABLE';
    }
  | {
      readonly kind: 'NO_PENDING_EQUIVALENT_GOAL';
      readonly goal: ConversationGoal;
    };

export type ConversationGoalReason =
  | 'DIRECT_MESSAGE_RESPONSE'
  | 'NUTRITION_GUIDANCE_REQUESTED'
  | 'GENERAL_GUIDANCE_REQUESTED'
  | 'PROFILE_INFORMATION_REQUIRED'
  | 'DIET_PROFILE_READY'
  | 'WORKOUT_PROFILE_READY'
  | 'COMBINED_PROFILE_READY'
  | 'CURRENT_DIET_READY_FOR_UPDATE'
  | 'CURRENT_WORKOUT_READY_FOR_UPDATE'
  | 'DIET_PLAN_MISSING_GENERATION_REQUIRED'
  | 'WORKOUT_PLAN_MISSING_GENERATION_REQUIRED'
  | 'PROGRESS_REVIEW_REQUESTED'
  | 'PROGRESS_CONTEXT_MISSING'
  | 'CONFIRMATION_REQUIRED'
  | 'CONFIRMATION_NOT_PENDING'
  | 'CURRENT_PLAN_AVAILABLE'
  | 'CURRENT_PLAN_MISSING'
  | 'PLAN_TARGET_REQUIRED'
  | 'PLAN_STATUS_REQUESTED'
  | 'EQUIVALENT_GOAL_ALREADY_PENDING'
  | 'INTENT_NOT_RECOGNIZED';

export type ConversationGoalConfidence = 'HIGH' | 'MEDIUM' | 'LOW';

export interface ConversationGoalDecision {
  readonly recognizedIntent: ConversationRecognizedIntent;
  readonly goal: ConversationGoal;
  readonly reason: ConversationGoalReason;
  readonly targetPlan: ConversationGoalPlanTarget | null;
  readonly profileCompletionState: CoachProfileCompletionState;
  readonly canExecute: boolean;
  readonly confidence: ConversationGoalConfidence;
  readonly selectedProfileField: ProfileAcquisitionField | null;
  readonly metPreconditions: readonly ConversationGoalPrecondition[];
  readonly missingPreconditions: readonly ConversationGoalPrecondition[];
  readonly pendingDependencies: readonly ConversationGoalPrecondition[];
}

export interface ConversationGoalPlannerInput {
  readonly snapshot: CoachProfileSnapshot;
  readonly adaptiveDecision: ProfileAcquisitionDecision;
  readonly recognizedIntent: ConversationRecognizedIntent;
  readonly completion: CoachProfileCompletionStatus;
  readonly conversationContext: ConversationGoalContext;
  readonly recentHistory: ConversationGoalRecentHistory;
}
