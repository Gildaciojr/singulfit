import { Injectable } from '@nestjs/common';
import { ActivityLevel, FitnessGoal, Gender } from '@prisma/client';
import { NUTRITION_ARTIFACT_TYPE } from './nutrition-planning-artifact.contract';
import type {
  NutritionPlanningContext,
  NutritionPlanningValue,
} from './nutrition-planning-context.contract';
import type {
  NutritionMacroTargets,
  NutritionPlanningStrategy,
  NutritionStrategyFactor,
} from './nutrition-planning-strategy.contract';

const ACTIVITY_FACTOR: Readonly<Record<ActivityLevel, number>> = Object.freeze({
  [ActivityLevel.SEDENTARY]: 1.2,
  [ActivityLevel.LIGHT]: 1.375,
  [ActivityLevel.MODERATE]: 1.55,
  [ActivityLevel.HIGH]: 1.725,
  [ActivityLevel.ATHLETE]: 1.9,
});

@Injectable()
export class NutritionPlanningStrategyService {
  build(context: NutritionPlanningContext): NutritionPlanningStrategy {
    const factors: NutritionStrategyFactor[] = [];
    if (context.profile.primaryGoal.status !== 'NOT_SET')
      factors.push('OBJECTIVE');
    if (context.routine.desiredMealCount.status !== 'NOT_SET')
      factors.push('MEAL_COUNT');
    if (context.routine.mealTimes.status !== 'NOT_SET')
      factors.push('MEAL_SCHEDULE');
    if (context.constraints.length > 0) factors.push('FOOD_CONSTRAINTS');
    if (context.preferences.length > 0) factors.push('FOOD_PREFERENCES');
    if (context.currentWorkoutAvailable) factors.push('TRAINING_CONTEXT');
    if (context.routine.cookingAvailability.status !== 'NOT_SET')
      factors.push('COOKING_AVAILABILITY');
    if (context.routine.foodBudget.status !== 'NOT_SET')
      factors.push('FOOD_BUDGET');
    if (context.routine.mealsAwayFromHome.status !== 'NOT_SET')
      factors.push('MEALS_AWAY_FROM_HOME');
    if (context.previousPlan) factors.push('PREVIOUS_PLAN');

    const energy = this.energyTarget(context);
    const macroTargets = this.macroTargets(context, energy);
    const preferredFoods = context.preferences
      .filter(
        (preference) =>
          preference.disposition === 'PREFERRED' ||
          preference.disposition === 'FREQUENT',
      )
      .map((preference) => preference.foodName);
    const excludedFoods = context.preferences
      .filter(
        (preference) =>
          preference.disposition === 'AVOIDED' ||
          preference.disposition === 'REJECTED',
      )
      .map((preference) => preference.foodName);

    return Object.freeze({
      schemaVersion: 2,
      artifactType: context.artifactType,
      objective: Object.freeze({ ...context.profile.primaryGoal }),
      dayCount: this.dayCount(context.artifactType),
      mealCountPerDay: Object.freeze({ ...context.routine.desiredMealCount }),
      mealSchedule:
        context.routine.mealTimes.status === 'NOT_SET'
          ? Object.freeze({ status: 'NOT_SET' })
          : Object.freeze({
              ...context.routine.mealTimes,
              value: Object.freeze([...context.routine.mealTimes.value]),
            }),
      energyTargetKcal: energy,
      energySource:
        energy.status === 'NOT_SET'
          ? 'NOT_AVAILABLE'
          : 'MIFFLIN_ST_JEOR_ESTIMATE',
      macroTargets,
      trainingAware: context.currentWorkoutAvailable,
      appliedConstraintCodes: Object.freeze(
        [
          ...new Set(context.constraints.map((constraint) => constraint.code)),
        ].sort(),
      ),
      excludedFoods: Object.freeze([...new Set(excludedFoods)].sort()),
      preferredFoods: Object.freeze([...new Set(preferredFoods)].sort()),
      variationPolicy:
        context.artifactType === NUTRITION_ARTIFACT_TYPE.WEEKLY_PLAN
          ? 'WEEKLY'
          : context.artifactType === NUTRITION_ARTIFACT_TYPE.DAILY_STRUCTURE
            ? 'DAILY'
            : 'MINIMAL',
      detailLevel:
        context.artifactType === NUTRITION_ARTIFACT_TYPE.POINT_GUIDANCE
          ? 'BRIEF'
          : context.artifactType === NUTRITION_ARTIFACT_TYPE.WEEKLY_PLAN
            ? 'DETAILED'
            : 'STANDARD',
      factors: Object.freeze(factors),
    });
  }

  private dayCount(artifactType: NutritionPlanningContext['artifactType']) {
    if (artifactType === NUTRITION_ARTIFACT_TYPE.WEEKLY_PLAN) return 7;
    if (
      artifactType === NUTRITION_ARTIFACT_TYPE.POINT_GUIDANCE ||
      artifactType === NUTRITION_ARTIFACT_TYPE.PLAN_REVIEW ||
      artifactType === NUTRITION_ARTIFACT_TYPE.CURRENT_PLAN_PRESENTATION
    ) {
      return 0;
    }
    return 1;
  }

  private energyTarget(
    context: NutritionPlanningContext,
  ): NutritionPlanningValue<number> {
    if (
      context.artifactType === NUTRITION_ARTIFACT_TYPE.POINT_GUIDANCE ||
      context.profile.sex.status === 'NOT_SET' ||
      context.profile.ageYears.status === 'NOT_SET' ||
      context.profile.heightCm.status === 'NOT_SET' ||
      context.profile.currentWeightKg.status === 'NOT_SET' ||
      context.profile.activityLevel.status === 'NOT_SET' ||
      context.profile.primaryGoal.status === 'NOT_SET'
    ) {
      return Object.freeze({ status: 'NOT_SET' });
    }

    const sexOffset = context.profile.sex.value === Gender.MALE ? 5 : -161;
    const restingEnergy =
      10 * context.profile.currentWeightKg.value +
      6.25 * context.profile.heightCm.value -
      5 * context.profile.ageYears.value +
      sexOffset;
    const goalFactor =
      context.profile.primaryGoal.value === FitnessGoal.WEIGHT_LOSS
        ? 0.9
        : context.profile.primaryGoal.value === FitnessGoal.MUSCLE_GAIN
          ? 1.1
          : 1;
    const estimated =
      restingEnergy *
      ACTIVITY_FACTOR[context.profile.activityLevel.value] *
      goalFactor;
    const minimum = context.profile.sex.value === Gender.MALE ? 1500 : 1200;
    const bounded = Math.min(4500, Math.max(minimum, estimated));

    return Object.freeze({
      status: 'ESTIMATED',
      value: Math.round(bounded / 10) * 10,
    });
  }

  private macroTargets(
    context: NutritionPlanningContext,
    energy: NutritionPlanningValue<number>,
  ): NutritionPlanningValue<NutritionMacroTargets> {
    if (
      energy.status === 'NOT_SET' ||
      context.profile.currentWeightKg.status === 'NOT_SET' ||
      context.profile.primaryGoal.status === 'NOT_SET'
    ) {
      return Object.freeze({ status: 'NOT_SET' });
    }
    const proteinFactor =
      context.profile.primaryGoal.value === FitnessGoal.MUSCLE_GAIN ? 1.6 : 1.4;
    const protein = Math.round(
      context.profile.currentWeightKg.value * proteinFactor,
    );
    const fat = Math.round((energy.value * 0.25) / 9);
    const carbohydrate = Math.max(
      0,
      Math.round((energy.value - protein * 4 - fat * 9) / 4),
    );
    return Object.freeze({
      status: 'ESTIMATED',
      value: Object.freeze({
        proteinGrams: protein,
        carbohydrateGrams: carbohydrate,
        fatGrams: fat,
      }),
    });
  }
}
