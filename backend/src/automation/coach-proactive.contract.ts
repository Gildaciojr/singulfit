import type { AutomationRuleCode } from './automation.constants';

export const COACH_PROACTIVE_SOURCE = 'COACH_PROACTIVE_V1' as const;

export const COACH_PROACTIVE_INTENTS = {
  GOOD_MORNING: 'GOOD_MORNING',
  HYDRATION_CHECK: 'HYDRATION_CHECK',
  MEAL_PLAN_CHECK: 'MEAL_PLAN_CHECK',
  LUNCH_CHECK: 'LUNCH_CHECK',
  DINNER_CHECK: 'DINNER_CHECK',
  WORKOUT_CHECK: 'WORKOUT_CHECK',
  DAILY_CHECK_IN: 'DAILY_CHECK_IN',
} as const;

export type CoachProactiveIntent =
  (typeof COACH_PROACTIVE_INTENTS)[keyof typeof COACH_PROACTIVE_INTENTS];

export interface CoachProactiveSlot {
  readonly intent: CoachProactiveIntent;
  readonly slotKey: string;
  readonly ruleCode: AutomationRuleCode;
  readonly scheduledFor: Date;
  readonly localTime: string;
}

export interface CoachProactivePreferences {
  readonly timezone?: string | null;
  readonly preferredWakeUpTime?: string | null;
  readonly preferredSleepTime?: string | null;
  readonly preferredTrainingTime?: string | null;
  readonly preferredMealTimes?: unknown;
}

export interface CoachProactiveRealizationInput {
  readonly userId: string;
  readonly operationKey: string;
  readonly preferredName: string | null;
  readonly intent: CoachProactiveIntent;
  readonly slotKey: string;
  readonly localTime: string;
  readonly goal: string | null;
  readonly nutritionPlanSummary: string | null;
  readonly workoutPlanSummary: string | null;
  readonly trainingTime: string | null;
  readonly mealTimes: unknown;
  readonly fallback: string;
}
