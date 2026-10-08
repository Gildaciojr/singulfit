import {
  CONVERSATION_GOAL,
  type ConversationGoalDecision,
} from '../../context/conversation-goal-planner.contract';
import { explicitPlanningIntent } from '../../conversation/understanding/explicit-planning-intent';
import { affirmativePlanningText } from '../../conversation/understanding/planning-request-polarity.policy';

export interface WorkoutEffectAuthorization {
  readonly effect: 'GENERATE' | 'UPDATE';
  readonly requestQuote: string;
}

/** Subject/profile recognition is never permission to create or replace a plan. */
export function isWorkoutEffectAuthorized(
  text: string | undefined,
  semantic?: WorkoutEffectAuthorization,
): boolean {
  if (!text?.trim()) return false;
  const request = semantic ? semantic.requestQuote : text;
  if (!request.trim() || !text.includes(request)) return false;
  if (
    semantic &&
    (!affirmativePlanningText(request) ||
      !affirmativePlanningText(text).includes(affirmativePlanningText(request)))
  )
    return false;
  // A quote proposes the request span; the established operation/domain policy
  // must independently recognize the requested effect. Modality is not consent.
  const intent = explicitPlanningIntent(request);
  const currentIntent =
    text === request ? intent : explicitPlanningIntent(text);
  if (
    ![
      'WORKOUT_PLAN_REQUEST',
      'WORKOUT_PLAN_UPDATE_REQUEST',
      'COMBINED_PLAN_REQUEST',
    ].includes(currentIntent)
  )
    return false;
  return semantic?.effect === 'UPDATE'
    ? intent === 'WORKOUT_PLAN_UPDATE_REQUEST'
    : [
        'WORKOUT_PLAN_REQUEST',
        'WORKOUT_PLAN_UPDATE_REQUEST',
        'COMBINED_PLAN_REQUEST',
      ].includes(intent);
}

export function canGenerateWorkout(
  decision: ConversationGoalDecision | null | undefined,
  mutationReady = false,
): boolean {
  return (
    decision?.canExecute === true &&
    (decision.goal === CONVERSATION_GOAL.GENERATE_WORKOUT_PLAN ||
      decision.goal === CONVERSATION_GOAL.GENERATE_COMBINED_PLANS ||
      (decision.goal === CONVERSATION_GOAL.UPDATE_WORKOUT_PLAN &&
        mutationReady))
  );
}
