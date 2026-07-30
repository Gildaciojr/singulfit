import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CONVERSATION_GOAL,
  type ConversationGoalDecision,
} from '../../../context/conversation-goal-planner.contract';

const NUTRITION_SHADOW_RUNTIME_ENABLED_KEY = 'NUTRITION_SHADOW_RUNTIME_ENABLED';
const ENABLED_VALUES = new Set(['1', 'true', 'yes', 'on']);

export type NutritionShadowExecutionPolicyDecision =
  | Readonly<{ enabled: true }>
  | Readonly<{
      enabled: false;
      reason: 'DISABLED' | 'NON_NUTRITION_GOAL';
    }>;

@Injectable()
export class NutritionShadowExecutionPolicy {
  constructor(private readonly config: ConfigService) {}

  evaluate(
    decision: ConversationGoalDecision,
  ): NutritionShadowExecutionPolicyDecision {
    if (
      !this.enabled(
        this.config.get<string>(NUTRITION_SHADOW_RUNTIME_ENABLED_KEY),
      )
    )
      return Object.freeze({ enabled: false, reason: 'DISABLED' as const });

    return this.isNutritionGoal(decision)
      ? Object.freeze({ enabled: true as const })
      : Object.freeze({
          enabled: false as const,
          reason: 'NON_NUTRITION_GOAL' as const,
        });
  }

  private enabled(value: string | undefined): boolean {
    return ENABLED_VALUES.has(value?.trim().toLowerCase() ?? '');
  }

  private isNutritionGoal(decision: ConversationGoalDecision): boolean {
    switch (decision.goal) {
      case CONVERSATION_GOAL.GENERATE_DIET_PLAN:
      case CONVERSATION_GOAL.GENERATE_COMBINED_PLANS:
      case CONVERSATION_GOAL.UPDATE_DIET_PLAN:
      case CONVERSATION_GOAL.REVIEW_PROGRESS:
      case CONVERSATION_GOAL.SHOW_CURRENT_PLAN:
      case CONVERSATION_GOAL.GENERAL_GUIDANCE:
        return true;
      case CONVERSATION_GOAL.ANSWER_MESSAGE:
        return decision.recognizedIntent === 'NUTRITION_QUESTION';
      case CONVERSATION_GOAL.ASK_PROFILE_INFORMATION:
        return decision.targetPlan === 'DIET' || decision.targetPlan === 'BOTH';
      case CONVERSATION_GOAL.GENERATE_WORKOUT_PLAN:
      case CONVERSATION_GOAL.UPDATE_WORKOUT_PLAN:
      case CONVERSATION_GOAL.REQUEST_CONFIRMATION:
      case CONVERSATION_GOAL.SHOW_PLAN_STATUS:
      case CONVERSATION_GOAL.UNKNOWN:
        return false;
    }
  }
}
