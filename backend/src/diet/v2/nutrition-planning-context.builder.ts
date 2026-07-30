import { Injectable } from '@nestjs/common';
import { FoodPreferenceKind } from '@prisma/client';
import type {
  CoachProfileConstraint,
  CoachProfileDatum,
} from '../../context/coach-profile-snapshot.contract';
import {
  NUTRITION_CONSTRAINT_CODE,
  type NutritionConstraintCode,
  type NutritionConstraintFact,
  type NutritionFoodPreferenceFact,
  type NutritionPlanningContext,
  type NutritionPlanningContextBuilderInput,
  type NutritionPlanningValue,
} from './nutrition-planning-context.contract';

@Injectable()
export class NutritionPlanningContextBuilder {
  build(input: NutritionPlanningContextBuilderInput): NutritionPlanningContext {
    const constraints = this.constraints(input);
    const preferences = this.preferences(input);
    const nutritionEvidence = Object.freeze(
      [...(input.nutritionEvidence ?? [])]
        .sort((left, right) =>
          `${left.observedAt}:${left.summaryCode}`.localeCompare(
            `${right.observedAt}:${right.summaryCode}`,
          ),
        )
        .map((evidence) =>
          Object.freeze({
            ...evidence,
            values: Object.freeze({ ...evidence.values }),
          }),
        ),
    );

    return Object.freeze({
      schemaVersion: 2,
      artifactType: input.artifactType,
      referenceDate: input.referenceDate.toISOString(),
      profile: Object.freeze({
        sex: this.value(input.snapshot.physical.sex),
        ageYears: this.value(input.snapshot.physical.ageYears),
        heightCm: this.value(input.snapshot.physical.heightCm),
        currentWeightKg: this.value(input.snapshot.physical.currentWeightKg),
        targetWeightKg: this.value(input.snapshot.physical.targetWeightKg),
        activityLevel: this.value(input.snapshot.physical.activityLevel),
        primaryGoal: this.value(input.snapshot.nutrition.primaryGoal),
      }),
      routine: Object.freeze({
        desiredMealCount: this.value(input.snapshot.nutrition.desiredMealCount),
        mealTimes: this.arrayValue(input.snapshot.routine.mealTimes),
        trainingTime: this.value(input.snapshot.routine.trainingTime),
        cookingAvailability: this.value(
          input.snapshot.nutrition.cookingAvailability,
        ),
        mealsAwayFromHome: this.value(
          input.snapshot.nutrition.mealsAwayFromHome,
        ),
        foodBudget: this.value(input.snapshot.nutrition.foodBudget),
        eatingPattern: this.optionalValue(
          input.snapshot.nutrition.dietaryPattern,
        ),
        eatingOutFrequency: this.optionalValue(
          input.snapshot.nutrition.eatingOutFrequency,
        ),
        hydration: this.optionalValue(input.snapshot.nutrition.hydration),
        supplementation: this.optionalArrayValue(
          input.snapshot.nutrition.supplementation,
        ),
      }),
      constraints,
      preferences,
      nutritionEvidence,
      currentWorkoutAvailable: 'value' in input.snapshot.plans.currentWorkout,
      currentDietAvailable: 'value' in input.snapshot.plans.currentDiet,
      previousPlan: input.previousPlan
        ? Object.freeze({
            artifactType: input.previousPlan.artifactType,
            title: input.previousPlan.title,
            objectiveSummary: input.previousPlan.objectiveSummary,
            days: Object.freeze(
              input.previousPlan.days.map((day) =>
                Object.freeze({
                  dayNumber: day.dayNumber,
                  label: day.label,
                  trainingDay: day.trainingDay,
                  meals: Object.freeze(
                    day.meals.map((meal) =>
                      Object.freeze({
                        name: meal.name,
                        period: meal.period,
                        suggestedTime: meal.suggestedTime,
                        items: Object.freeze(
                          meal.items.map((item) =>
                            Object.freeze({
                              foodName: item.foodName,
                              role: item.role,
                              quantity: item.quantity,
                            }),
                          ),
                        ),
                      }),
                    ),
                  ),
                }),
              ),
            ),
            validationStatus: input.previousPlan.validation.status,
          })
        : null,
      requestedChangeReason: input.requestedChangeReason ?? null,
    });
  }

  private value<T>(datum: CoachProfileDatum<T>): NutritionPlanningValue<T> {
    if (!('value' in datum)) return Object.freeze({ status: 'NOT_SET' });
    return Object.freeze({
      status:
        datum.status === 'KNOWN'
          ? 'CONFIRMED'
          : datum.status === 'INFERRED'
            ? 'INFERRED'
            : 'REQUIRES_CONFIRMATION',
      value: datum.value,
    });
  }

  private arrayValue<T>(
    datum: CoachProfileDatum<readonly T[]>,
  ): NutritionPlanningValue<readonly T[]> {
    if (!('value' in datum)) return Object.freeze({ status: 'NOT_SET' });
    return Object.freeze({
      status:
        datum.status === 'KNOWN'
          ? 'CONFIRMED'
          : datum.status === 'INFERRED'
            ? 'INFERRED'
            : 'REQUIRES_CONFIRMATION',
      value: Object.freeze([...datum.value]),
    });
  }

  private optionalValue<T>(
    datum: CoachProfileDatum<T> | undefined,
  ): NutritionPlanningValue<T> {
    return datum ? this.value(datum) : Object.freeze({ status: 'NOT_SET' });
  }

  private optionalArrayValue<T>(
    datum: CoachProfileDatum<readonly T[]> | undefined,
  ): NutritionPlanningValue<readonly T[]> {
    return datum
      ? this.arrayValue(datum)
      : Object.freeze({ status: 'NOT_SET' });
  }

  private constraints(
    input: NutritionPlanningContextBuilderInput,
  ): readonly NutritionConstraintFact[] {
    const collected: NutritionConstraintFact[] = [];
    this.collectConstraints(
      collected,
      input.snapshot.restrictions.foodRestrictions,
      'RESTRICTION',
    );
    this.collectConstraints(
      collected,
      input.snapshot.restrictions.allergies,
      'ALLERGY',
    );
    if (input.snapshot.nutrition.foodIntolerances) {
      this.collectConstraints(
        collected,
        input.snapshot.nutrition.foodIntolerances,
        'RESTRICTION',
      );
    }
    if ('value' in input.snapshot.nutrition.dietaryPattern) {
      const label = input.snapshot.nutrition.dietaryPattern.value.trim();
      if (label) {
        collected.push(
          Object.freeze({
            code: this.constraintCode(label),
            label: label.slice(0, 120),
            kind: 'DIETARY_PATTERN',
            status: this.factStatus(
              input.snapshot.nutrition.dietaryPattern.status,
            ),
          }),
        );
      }
    }
    const unique = new Map<string, NutritionConstraintFact>();
    for (const fact of collected) {
      unique.set(`${fact.kind}:${fact.code}:${fact.label.toLowerCase()}`, fact);
    }
    return Object.freeze(
      [...unique.values()].sort((left, right) =>
        `${left.kind}:${left.code}:${left.label}`.localeCompare(
          `${right.kind}:${right.code}:${right.label}`,
        ),
      ),
    );
  }

  private collectConstraints(
    target: NutritionConstraintFact[],
    datum: CoachProfileDatum<readonly CoachProfileConstraint[]>,
    kind: NutritionConstraintFact['kind'],
  ): void {
    if (!('value' in datum)) return;
    for (const constraint of datum.value) {
      const label = constraint.description.trim();
      if (!label) continue;
      const code = this.constraintCode(`${constraint.type ?? ''} ${label}`);
      target.push(
        Object.freeze({
          code,
          label: label.slice(0, 120),
          kind,
          status:
            code === NUTRITION_CONSTRAINT_CODE.CUSTOM
              ? 'REQUIRES_CONFIRMATION'
              : this.factStatus(datum.status),
        }),
      );
    }
  }

  private preferences(
    input: NutritionPlanningContextBuilderInput,
  ): readonly NutritionFoodPreferenceFact[] {
    const datum = input.snapshot.preferences.foodPreferences;
    const values: NutritionFoodPreferenceFact[] = [];
    if ('value' in datum) {
      values.push(
        ...[...datum.value]
          .sort((left, right) => left.foodName.localeCompare(right.foodName))
          .map((preference) =>
            Object.freeze({
              foodName: preference.foodName.trim().slice(0, 120),
              disposition:
                preference.kind === FoodPreferenceKind.FREQUENT
                  ? 'FREQUENT'
                  : preference.kind === FoodPreferenceKind.ACCEPTED
                    ? 'PREFERRED'
                    : preference.kind === FoodPreferenceKind.AVOIDED
                      ? 'AVOIDED'
                      : 'REJECTED',
              confidence: preference.confidence,
            }),
          ),
      );
    }
    this.collectDeclaredPreferences(
      values,
      input.snapshot.nutrition.declaredFoodPreferences,
      'PREFERRED',
    );
    this.collectDeclaredPreferences(
      values,
      input.snapshot.nutrition.declaredFoodRejections,
      'REJECTED',
    );
    const unique = new Map<string, NutritionFoodPreferenceFact>();
    for (const value of values) {
      unique.set(value.disposition + ':' + value.foodName.toLowerCase(), value);
    }
    return Object.freeze(
      [...unique.values()].sort((left, right) =>
        left.foodName.localeCompare(right.foodName),
      ),
    );
  }

  private collectDeclaredPreferences(
    target: NutritionFoodPreferenceFact[],
    datum: CoachProfileDatum<readonly string[]> | undefined,
    disposition: NutritionFoodPreferenceFact['disposition'],
  ): void {
    if (!datum || !('value' in datum)) return;
    for (const foodName of datum.value) {
      const normalized = foodName.trim().slice(0, 120);
      if (!normalized) continue;
      target.push(
        Object.freeze({
          foodName: normalized,
          disposition,
          confidence: datum.status === 'KNOWN' ? 1 : 0.75,
        }),
      );
    }
  }

  private factStatus(
    status: 'KNOWN' | 'INFERRED' | 'REQUIRES_CONFIRMATION',
  ): NutritionConstraintFact['status'] {
    return status === 'KNOWN'
      ? 'CONFIRMED'
      : status === 'INFERRED'
        ? 'INFERRED'
        : 'REQUIRES_CONFIRMATION';
  }

  private constraintCode(value: string): NutritionConstraintCode {
    const normalized = value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
    if (normalized.includes('lactose'))
      return NUTRITION_CONSTRAINT_CODE.LACTOSE;
    if (normalized.includes('leite')) return NUTRITION_CONSTRAINT_CODE.MILK;
    if (normalized.includes('gluten')) return NUTRITION_CONSTRAINT_CODE.GLUTEN;
    if (normalized.includes('amendoim'))
      return NUTRITION_CONSTRAINT_CODE.PEANUT;
    if (/(castanha|nozes|amendoa)/.test(normalized))
      return NUTRITION_CONSTRAINT_CODE.TREE_NUT;
    if (/(ovo|egg)/.test(normalized)) return NUTRITION_CONSTRAINT_CODE.EGG;
    if (/(soja|soy)/.test(normalized)) return NUTRITION_CONSTRAINT_CODE.SOY;
    if (/(marisco|camarao|crustaceo)/.test(normalized))
      return NUTRITION_CONSTRAINT_CODE.SHELLFISH;
    if (/(peixe|fish)/.test(normalized)) return NUTRITION_CONSTRAINT_CODE.FISH;
    if (normalized.includes('vegano')) return NUTRITION_CONSTRAINT_CODE.VEGAN;
    if (normalized.includes('vegetar'))
      return NUTRITION_CONSTRAINT_CODE.VEGETARIAN;
    return NUTRITION_CONSTRAINT_CODE.CUSTOM;
  }
}
