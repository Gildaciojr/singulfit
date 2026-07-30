import type { NutritionShadowComparisonSnapshot } from '../shadow-comparison/nutrition-shadow-comparison.contract';

export const NUTRITION_SHADOW_RUNTIME_RESULT_READER = Symbol(
  'NUTRITION_SHADOW_RUNTIME_RESULT_READER',
);

export interface NutritionShadowRuntimeResultReader {
  findSucceeded(
    shadowRunId: string,
  ): Promise<NutritionShadowComparisonSnapshot | null>;
}
