import type { ProfileAcquisitionField } from '../context/coach-adaptive-profile-collector.contract';
import type { CoachProfileCompletionState } from '../context/coach-profile-snapshot.contract';
import type {
  ConversationGoal,
  ConversationGoalPlanTarget,
  ConversationGoalReason,
  ConversationRecognizedIntent,
} from '../context/conversation-goal-planner.contract';
import type { CoachCommandIntent } from './coach-command.service';

export const CONVERSATION_GOAL_SHADOW_COMPARISON_CATEGORY = {
  EXACT_MATCH: 'EXACT_MATCH',
  COMPATIBLE: 'COMPATIBLE',
  PLANNER_MORE_SPECIFIC: 'PLANNER_MORE_SPECIFIC',
  LEGACY_MORE_SPECIFIC: 'LEGACY_MORE_SPECIFIC',
  PROFILE_GAP: 'PROFILE_GAP',
  CONFIRMATION_GAP: 'CONFIRMATION_GAP',
  UNSUPPORTED_LEGACY_INTENT: 'UNSUPPORTED_LEGACY_INTENT',
  UNSUPPORTED_PLANNER_GOAL: 'UNSUPPORTED_PLANNER_GOAL',
  CONFLICT: 'CONFLICT',
  UNKNOWN: 'UNKNOWN',
} as const;

export type ConversationGoalShadowComparisonCategory =
  (typeof CONVERSATION_GOAL_SHADOW_COMPARISON_CATEGORY)[keyof typeof CONVERSATION_GOAL_SHADOW_COMPARISON_CATEGORY];

export const CONVERSATION_GOAL_SHADOW_COMPARATOR_VERSION =
  'conversation-goal-shadow-comparator:v1';

export interface ConversationGoalShadowComparison {
  readonly legacyDecision: CoachCommandIntent;
  readonly plannerGoal: ConversationGoal;
  readonly agreement: boolean;
  readonly category: ConversationGoalShadowComparisonCategory;
  readonly canExecute: boolean;
  readonly missingProfileField: ProfileAcquisitionField | null;
  readonly adaptedIntent: ConversationRecognizedIntent;
  readonly targetPlan: ConversationGoalPlanTarget | null;
  readonly profileCompletionState: CoachProfileCompletionState;
  readonly sanitizedReason: ConversationGoalReason;
  readonly adapterVersion: string;
  readonly plannerVersion: string;
  readonly comparatorVersion: typeof CONVERSATION_GOAL_SHADOW_COMPARATOR_VERSION;
  readonly referenceTimestamp: string;
}
