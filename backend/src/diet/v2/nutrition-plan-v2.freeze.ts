import type {
  NutritionPlanDay,
  NutritionPlanFoodItem,
  NutritionPlanMeal,
  NutritionPlanV2,
} from './nutrition-plan-v2.contract';

function freezeItem(item: NutritionPlanFoodItem): NutritionPlanFoodItem {
  return Object.freeze({
    ...item,
    macros: Object.freeze({ ...item.macros }),
    allergenTags: Object.freeze([...item.allergenTags]),
    dietaryTags: Object.freeze([...item.dietaryTags]),
  });
}

function freezeMeal(meal: NutritionPlanMeal): NutritionPlanMeal {
  return Object.freeze({
    ...meal,
    items: Object.freeze(meal.items.map(freezeItem)),
    alternatives: Object.freeze(meal.alternatives.map(freezeItem)),
  });
}

function freezeDay(day: NutritionPlanDay): NutritionPlanDay {
  return Object.freeze({
    ...day,
    meals: Object.freeze(day.meals.map(freezeMeal)),
  });
}

export function freezeNutritionPlanV2(plan: NutritionPlanV2): NutritionPlanV2 {
  return Object.freeze({
    ...plan,
    strategy: Object.freeze({
      ...plan.strategy,
      objective: Object.freeze({ ...plan.strategy.objective }),
      mealCountPerDay: Object.freeze({ ...plan.strategy.mealCountPerDay }),
      mealSchedule:
        plan.strategy.mealSchedule.status === 'NOT_SET'
          ? Object.freeze({ status: 'NOT_SET' as const })
          : Object.freeze({
              ...plan.strategy.mealSchedule,
              value: Object.freeze([...plan.strategy.mealSchedule.value]),
            }),
      energyTargetKcal: Object.freeze({ ...plan.strategy.energyTargetKcal }),
      macroTargets:
        plan.strategy.macroTargets.status === 'NOT_SET'
          ? Object.freeze({ status: 'NOT_SET' as const })
          : Object.freeze({
              ...plan.strategy.macroTargets,
              value: Object.freeze({ ...plan.strategy.macroTargets.value }),
            }),
      appliedConstraintCodes: Object.freeze([
        ...plan.strategy.appliedConstraintCodes,
      ]),
      excludedFoods: Object.freeze([...plan.strategy.excludedFoods]),
      preferredFoods: Object.freeze([...plan.strategy.preferredFoods]),
      factors: Object.freeze([...plan.strategy.factors]),
    }),
    guidance: Object.freeze([...plan.guidance]),
    days: Object.freeze(plan.days.map(freezeDay)),
    substitutions: Object.freeze(
      plan.substitutions.map((substitution) =>
        Object.freeze({ ...substitution }),
      ),
    ),
    adaptationRules: Object.freeze([...plan.adaptationRules]),
    hydrationGuidance: Object.freeze([...plan.hydrationGuidance]),
    safetyNotes: Object.freeze([...plan.safetyNotes]),
    generation: Object.freeze({ ...plan.generation }),
    validation: Object.freeze({
      ...plan.validation,
      issues: Object.freeze(
        plan.validation.issues.map((issue) => Object.freeze({ ...issue })),
      ),
    }),
  });
}
