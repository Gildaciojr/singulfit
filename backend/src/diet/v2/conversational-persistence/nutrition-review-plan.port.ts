import type { NutritionPlanV2 } from '../nutrition-plan-v2.contract';

export const NUTRITION_REVIEW_PLAN_PORT = Symbol('NUTRITION_REVIEW_PLAN_PORT');
export interface NutritionReviewPlanReference {
  readonly id: string;
  readonly userId: string;
  readonly document: NutritionPlanV2;
}
export interface NutritionReviewPlanPort {
  resolveActive(userId: string): Promise<NutritionReviewPlanReference | null>;
}
