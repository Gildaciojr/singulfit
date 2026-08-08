import type {
  LegacyCurrentNutritionPlan,
  V2CurrentNutritionPlan,
} from './current-nutrition-plan-reader.contract';

export type CanonicalNutritionPlanDto =
  | LegacyCurrentNutritionPlan
  | V2CurrentNutritionPlan;
