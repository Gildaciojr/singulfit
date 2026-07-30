import { Injectable } from '@nestjs/common';
import type {
  CoachProfileDatum,
  CoachProfileSnapshot,
} from '../../context/coach-profile-snapshot.contract';
import {
  NUTRITION_ARTIFACT_TYPE,
  type NutritionArtifactType,
  type NutritionPlanningReadiness,
  type NutritionReadinessField,
  type NutritionSafetyFlag,
} from './nutrition-planning-artifact.contract';

const BASIC_PLAN_FIELDS: readonly NutritionReadinessField[] = Object.freeze([
  'PRIMARY_GOAL',
  'AGE',
  'SEX',
  'HEIGHT',
  'CURRENT_WEIGHT',
  'ACTIVITY_LEVEL',
  'FOOD_RESTRICTIONS',
  'ALLERGIES',
  'MEDICAL_CONDITIONS',
  'MEAL_COUNT',
]);

@Injectable()
export class NutritionPlanningReadinessService {
  evaluate(
    snapshot: CoachProfileSnapshot,
    artifactType: NutritionArtifactType,
    previousPlanAvailable: boolean,
  ): NutritionPlanningReadiness {
    const requiredFields = this.requiredFields(artifactType);
    const availableFields: NutritionReadinessField[] = [];
    const missingFields: NutritionReadinessField[] = [];
    const confirmationRequiredFields: NutritionReadinessField[] = [];

    for (const field of requiredFields) {
      const datum = this.datum(snapshot, field, previousPlanAvailable);
      if (datum === 'AVAILABLE') availableFields.push(field);
      if (datum === 'MISSING') missingFields.push(field);
      if (datum === 'CONFIRMATION') confirmationRequiredFields.push(field);
    }

    const safetyFlags: NutritionSafetyFlag[] = [];
    if (this.hasValues(snapshot.restrictions.medicalConditions)) {
      safetyFlags.push('MEDICAL_CONTEXT_PRESENT');
    }
    if (snapshot.conflicts.length > 0) {
      safetyFlags.push('PROFILE_CONFLICT_PRESENT');
    }
    const unclassifiedRestriction = this.hasUnclassifiedConstraint(
      snapshot.restrictions.foodRestrictions,
    );
    const unclassifiedAllergy = this.hasUnclassifiedConstraint(
      snapshot.restrictions.allergies,
    );
    if (unclassifiedRestriction || unclassifiedAllergy) {
      safetyFlags.push('CUSTOM_CONSTRAINT_REQUIRES_CONFIRMATION');
      if (
        unclassifiedRestriction &&
        !confirmationRequiredFields.includes('FOOD_RESTRICTIONS')
      ) {
        confirmationRequiredFields.push('FOOD_RESTRICTIONS');
      }
      if (
        unclassifiedAllergy &&
        !confirmationRequiredFields.includes('ALLERGIES')
      ) {
        confirmationRequiredFields.push('ALLERGIES');
      }
    }
    if (
      artifactType !== NUTRITION_ARTIFACT_TYPE.POINT_GUIDANCE &&
      this.energyFieldsMissing(snapshot)
    ) {
      safetyFlags.push('ENERGY_ESTIMATE_UNAVAILABLE');
    }
    if (
      this.requiresCurrentPlanContent(artifactType) &&
      !previousPlanAvailable
    ) {
      safetyFlags.push('CURRENT_PLAN_CONTENT_UNAVAILABLE');
    }

    const status =
      missingFields.length > 0
        ? 'BLOCKED'
        : confirmationRequiredFields.length > 0
          ? 'REQUIRES_CONFIRMATION'
          : safetyFlags.length > 0
            ? 'READY_WITH_LIMITS'
            : 'READY';

    return Object.freeze({
      artifactType,
      status,
      requiredFields: Object.freeze([...requiredFields]),
      availableFields: Object.freeze(availableFields),
      missingFields: Object.freeze(missingFields),
      confirmationRequiredFields: Object.freeze(confirmationRequiredFields),
      safetyFlags: Object.freeze(safetyFlags),
    });
  }

  private requiredFields(
    artifactType: NutritionArtifactType,
  ): readonly NutritionReadinessField[] {
    if (artifactType === NUTRITION_ARTIFACT_TYPE.POINT_GUIDANCE) {
      return Object.freeze(['FOOD_RESTRICTIONS', 'ALLERGIES']);
    }
    if (artifactType === NUTRITION_ARTIFACT_TYPE.MEAL_SUGGESTION) {
      return Object.freeze([
        'PRIMARY_GOAL',
        'FOOD_RESTRICTIONS',
        'ALLERGIES',
        'MEDICAL_CONDITIONS',
      ]);
    }
    if (artifactType === NUTRITION_ARTIFACT_TYPE.WEEKLY_PLAN) {
      return Object.freeze([
        ...BASIC_PLAN_FIELDS,
        'MEAL_TIMES',
        'EATING_PATTERN',
        'FOOD_INTOLERANCES',
        'DECLARED_FOOD_PREFERENCES',
        'DECLARED_FOOD_REJECTIONS',
        'COOKING_AVAILABILITY',
        'EATING_OUT_FREQUENCY',
        'FOOD_BUDGET',
        'HYDRATION',
      ]);
    }
    if (this.requiresCurrentPlanContent(artifactType)) {
      return Object.freeze([
        'FOOD_RESTRICTIONS',
        'ALLERGIES',
        'MEDICAL_CONDITIONS',
        'CURRENT_DIET',
        'CURRENT_PLAN_CONTENT',
      ]);
    }
    return BASIC_PLAN_FIELDS;
  }

  private requiresCurrentPlanContent(artifactType: NutritionArtifactType) {
    return (
      artifactType === NUTRITION_ARTIFACT_TYPE.PLAN_REVIEW ||
      artifactType === NUTRITION_ARTIFACT_TYPE.PLAN_ADAPTATION ||
      artifactType === NUTRITION_ARTIFACT_TYPE.FOOD_SUBSTITUTION ||
      artifactType === NUTRITION_ARTIFACT_TYPE.CURRENT_PLAN_PRESENTATION
    );
  }

  private datum(
    snapshot: CoachProfileSnapshot,
    field: NutritionReadinessField,
    previousPlanAvailable: boolean,
  ): 'AVAILABLE' | 'MISSING' | 'CONFIRMATION' {
    if (field === 'CURRENT_PLAN_CONTENT') {
      return previousPlanAvailable ? 'AVAILABLE' : 'MISSING';
    }
    const datum = this.profileDatum(snapshot, field);
    if (
      !datum ||
      datum.status === 'UNKNOWN' ||
      datum.status === 'NOT_APPLICABLE'
    ) {
      return 'MISSING';
    }
    return datum.status === 'REQUIRES_CONFIRMATION'
      ? 'CONFIRMATION'
      : 'AVAILABLE';
  }

  private profileDatum(
    snapshot: CoachProfileSnapshot,
    field: NutritionReadinessField,
  ): CoachProfileDatum<unknown> | null {
    const values: Readonly<
      Partial<Record<NutritionReadinessField, CoachProfileDatum<unknown>>>
    > = {
      PRIMARY_GOAL: snapshot.nutrition.primaryGoal,
      AGE: snapshot.physical.ageYears,
      SEX: snapshot.physical.sex,
      HEIGHT: snapshot.physical.heightCm,
      CURRENT_WEIGHT: snapshot.physical.currentWeightKg,
      ACTIVITY_LEVEL: snapshot.physical.activityLevel,
      FOOD_RESTRICTIONS: snapshot.restrictions.foodRestrictions,
      ALLERGIES: snapshot.restrictions.allergies,
      MEDICAL_CONDITIONS: snapshot.restrictions.medicalConditions,
      MEAL_COUNT: snapshot.nutrition.desiredMealCount,
      MEAL_TIMES: snapshot.routine.mealTimes,
      EATING_PATTERN: snapshot.nutrition.dietaryPattern,
      FOOD_INTOLERANCES: snapshot.nutrition.foodIntolerances,
      DECLARED_FOOD_PREFERENCES: snapshot.nutrition.declaredFoodPreferences,
      DECLARED_FOOD_REJECTIONS: snapshot.nutrition.declaredFoodRejections,
      COOKING_AVAILABILITY: snapshot.nutrition.cookingAvailability,
      EATING_OUT_FREQUENCY: snapshot.nutrition.eatingOutFrequency,
      FOOD_BUDGET: snapshot.nutrition.foodBudget,
      HYDRATION: snapshot.nutrition.hydration,
      CURRENT_DIET: snapshot.plans.currentDiet,
    };
    return values[field] ?? null;
  }

  private hasValues<T>(datum: CoachProfileDatum<readonly T[]>): boolean {
    return 'value' in datum && datum.value.length > 0;
  }

  private energyFieldsMissing(snapshot: CoachProfileSnapshot): boolean {
    return [
      snapshot.physical.ageYears,
      snapshot.physical.sex,
      snapshot.physical.heightCm,
      snapshot.physical.currentWeightKg,
      snapshot.physical.activityLevel,
    ].some((datum) => !('value' in datum));
  }

  private hasUnclassifiedConstraint(
    datum: CoachProfileDatum<
      readonly import('../../context/coach-profile-snapshot.contract').CoachProfileConstraint[]
    >,
  ): boolean {
    if (!('value' in datum)) return datum.status === 'UNKNOWN';
    return datum.value.some((constraint) => {
      const normalized = `${constraint.type ?? ''} ${constraint.description}`
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
      return !/(lactose|leite|gluten|amendoim|castanha|nozes|amendoa|ovo|soja|marisco|camarao|crustaceo|peixe|vegano|vegetar)/.test(
        normalized,
      );
    });
  }
}
