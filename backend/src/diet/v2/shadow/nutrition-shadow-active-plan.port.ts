export const NUTRITION_SHADOW_ACTIVE_PLAN_PORT = Symbol(
  'NUTRITION_SHADOW_ACTIVE_PLAN_PORT',
);

export interface NutritionShadowActivePlanReference {
  readonly id: string;
  readonly artifactType:
    | 'DAILY_STRUCTURE'
    | 'WEEKLY_PLAN'
    | 'PLAN_ADAPTATION'
    | 'FOOD_SUBSTITUTION';
  readonly generatedAt: Date;
}

export interface NutritionShadowActivePlanPort {
  find(userId: string): Promise<NutritionShadowActivePlanReference | null>;
}
