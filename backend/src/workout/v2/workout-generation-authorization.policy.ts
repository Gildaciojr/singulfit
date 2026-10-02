import {
  CONVERSATION_GOAL,
  type ConversationGoalDecision,
} from '../../context/conversation-goal-planner.contract';

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
