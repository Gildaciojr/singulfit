import { BadGatewayException } from '@nestjs/common';
import type {
  GeneratedNutritionPlanCandidate,
  NutritionPlanV2,
} from './nutrition-plan-v2.contract';

export interface NutritionMutationTarget {
  readonly dayNumber: number;
  readonly mealKey: string;
  readonly itemKey: string | null;
  readonly request: string;
  readonly sourcePlanId: string;
}

/** Provider output is an edit proposal. Everything outside the target comes from the source document. */
export function applyNutritionTargetedMutation(
  candidate: GeneratedNutritionPlanCandidate,
  source: NutritionPlanV2,
  target: NutritionMutationTarget,
): GeneratedNutritionPlanCandidate {
  const original = source.days.flatMap((day) =>
    day.dayNumber === target.dayNumber
      ? day.meals.filter((meal) => meal.mealKey === target.mealKey)
      : [],
  );
  const proposed = candidate.days.flatMap((day) =>
    day.dayNumber === target.dayNumber
      ? day.meals.filter((meal) => meal.mealKey === target.mealKey)
      : [],
  );
  if (original.length !== 1 || proposed.length !== 1)
    throw new BadGatewayException('Nutrition mutation target mismatch');
  const replacement = target.itemKey
    ? proposed[0].items.filter((item) => item.itemKey === target.itemKey)
    : [];
  if (
    target.itemKey &&
    (replacement.length !== 1 ||
      original[0].items.filter((item) => item.itemKey === target.itemKey)
        .length !== 1)
  )
    throw new BadGatewayException('Nutrition mutation item mismatch');
  const edited = {
    ...original[0],
    items: target.itemKey
      ? original[0].items.map((item) =>
          item.itemKey === target.itemKey ? replacement[0] : item,
        )
      : proposed[0].items,
    alternatives: target.itemKey
      ? original[0].alternatives
      : proposed[0].alternatives,
  };
  if (JSON.stringify(edited.items) === JSON.stringify(original[0].items))
    throw new BadGatewayException(
      'Nutrition mutation did not change its target',
    );
  return Object.freeze({
    ...candidate,
    artifactType: target.itemKey ? 'FOOD_SUBSTITUTION' : 'PLAN_ADAPTATION',
    title: source.title,
    objectiveSummary: source.objectiveSummary,
    guidance: source.guidance,
    substitutions: source.substitutions,
    adaptationRules: source.adaptationRules,
    hydrationGuidance: source.hydrationGuidance,
    safetyNotes: source.safetyNotes,
    days: Object.freeze(
      source.days.map((day) =>
        day.dayNumber !== target.dayNumber
          ? day
          : Object.freeze({
              ...day,
              meals: Object.freeze(
                day.meals.map((meal) =>
                  meal.mealKey === target.mealKey
                    ? Object.freeze(edited)
                    : meal,
                ),
              ),
            }),
      ),
    ),
  });
}
