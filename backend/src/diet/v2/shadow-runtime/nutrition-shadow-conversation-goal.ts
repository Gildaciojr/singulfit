import {
  CONVERSATION_GOAL,
  type ConversationGoal,
} from '../../../context/conversation-goal-planner.contract';

export function parseNutritionShadowConversationGoal(
  value: string | null,
): ConversationGoal | null {
  switch (value) {
    case null:
      return null;
    case CONVERSATION_GOAL.ANSWER_MESSAGE:
    case CONVERSATION_GOAL.ASK_PROFILE_INFORMATION:
    case CONVERSATION_GOAL.GENERATE_DIET_PLAN:
    case CONVERSATION_GOAL.GENERATE_WORKOUT_PLAN:
    case CONVERSATION_GOAL.GENERATE_COMBINED_PLANS:
    case CONVERSATION_GOAL.UPDATE_DIET_PLAN:
    case CONVERSATION_GOAL.UPDATE_WORKOUT_PLAN:
    case CONVERSATION_GOAL.REVIEW_PROGRESS:
    case CONVERSATION_GOAL.REQUEST_CONFIRMATION:
    case CONVERSATION_GOAL.SHOW_CURRENT_PLAN:
    case CONVERSATION_GOAL.SHOW_PLAN_STATUS:
    case CONVERSATION_GOAL.GENERAL_GUIDANCE:
    case CONVERSATION_GOAL.UNKNOWN:
      return value;
    default:
      throw new Error('ConversationGoal persistido no Shadow está inválido');
  }
}

export function requireNutritionShadowConversationGoal(
  value: string,
): ConversationGoal {
  const goal = parseNutritionShadowConversationGoal(value);
  if (goal === null)
    throw new Error('ConversationGoal persistido no Shadow está ausente');
  return goal;
}
