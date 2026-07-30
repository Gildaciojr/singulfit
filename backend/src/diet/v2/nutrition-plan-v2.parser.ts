import { BadGatewayException } from '@nestjs/common';
import {
  NUTRITION_ARTIFACT_TYPE,
  type OperationalNutritionPlanArtifactType,
} from './nutrition-planning-artifact.contract';
import {
  NUTRITION_CONSTRAINT_CODE,
  type NutritionConstraintCode,
} from './nutrition-planning-context.contract';
import type {
  GeneratedNutritionPlanCandidate,
  NutritionFoodSubstitution,
  NutritionPlanDay,
  NutritionPlanFoodItem,
  NutritionPlanMeal,
} from './nutrition-plan-v2.contract';

const ARTIFACTS: readonly OperationalNutritionPlanArtifactType[] = [
  NUTRITION_ARTIFACT_TYPE.DAILY_STRUCTURE,
  NUTRITION_ARTIFACT_TYPE.WEEKLY_PLAN,
  NUTRITION_ARTIFACT_TYPE.PLAN_ADAPTATION,
  NUTRITION_ARTIFACT_TYPE.FOOD_SUBSTITUTION,
];
const CONSTRAINTS: readonly NutritionConstraintCode[] = Object.values(
  NUTRITION_CONSTRAINT_CODE,
);
const DIETARY_TAGS: readonly NutritionPlanFoodItem['dietaryTags'][number][] = [
  'VEGETARIAN',
  'VEGAN',
];
const ROLES: readonly NutritionPlanFoodItem['role'][] = [
  'PROTEIN',
  'CARBOHYDRATE',
  'FAT',
  'VEGETABLE',
  'FRUIT',
  'BEVERAGE',
  'OTHER',
];
const PERIODS: readonly NutritionPlanMeal['period'][] = [
  'BREAKFAST',
  'MORNING_SNACK',
  'LUNCH',
  'AFTERNOON_SNACK',
  'DINNER',
  'EVENING_SNACK',
  'FLEXIBLE',
];
const RATIONALES: readonly NutritionFoodSubstitution['rationaleCode'][] = [
  'EQUIVALENT_ROLE',
  'PREFERENCE',
  'AVAILABILITY',
  'VARIETY',
];

export class NutritionPlanV2Parser {
  parse(outputText: string): GeneratedNutritionPlanCandidate {
    let parsed: unknown;
    try {
      parsed = JSON.parse(outputText);
    } catch {
      throw new BadGatewayException(
        'Plano nutricional V2 retornou JSON inválido',
      );
    }
    const root = this.record(parsed, 'plano');
    return Object.freeze({
      artifactType: this.artifact(root.artifactType),
      title: this.text(root.title, 'title'),
      objectiveSummary: this.text(root.objectiveSummary, 'objectiveSummary'),
      guidance: this.textArray(root.guidance, 'guidance'),
      days: Object.freeze(
        this.array(root.days, 'days').map((value, index) =>
          this.day(value, index),
        ),
      ),
      substitutions: Object.freeze(
        this.array(root.substitutions, 'substitutions').map((value, index) =>
          this.substitution(value, index),
        ),
      ),
      adaptationRules: this.textArray(root.adaptationRules, 'adaptationRules'),
      hydrationGuidance: this.textArray(
        root.hydrationGuidance,
        'hydrationGuidance',
      ),
      safetyNotes: this.textArray(root.safetyNotes, 'safetyNotes'),
    });
  }

  private day(value: unknown, index: number): NutritionPlanDay {
    const day = this.record(value, `days.${index}`);
    return Object.freeze({
      dayNumber: this.integer(day.dayNumber, `days.${index}.dayNumber`, 1, 7),
      label: this.text(day.label, `days.${index}.label`),
      trainingDay: this.boolean(day.trainingDay, `days.${index}.trainingDay`),
      meals: Object.freeze(
        this.array(day.meals, `days.${index}.meals`).map((meal, mealIndex) =>
          this.meal(meal, index, mealIndex),
        ),
      ),
    });
  }

  private meal(
    value: unknown,
    dayIndex: number,
    mealIndex: number,
  ): NutritionPlanMeal {
    const path = `days.${dayIndex}.meals.${mealIndex}`;
    const meal = this.record(value, path);
    return Object.freeze({
      mealKey: this.key(meal.mealKey, `${path}.mealKey`),
      name: this.text(meal.name, `${path}.name`),
      period: this.enumValue(meal.period, PERIODS, `${path}.period`),
      suggestedTime:
        meal.suggestedTime === null
          ? null
          : this.time(meal.suggestedTime, `${path}.suggestedTime`),
      items: Object.freeze(
        this.array(meal.items, `${path}.items`).map((item, itemIndex) =>
          this.item(item, `${path}.items.${itemIndex}`),
        ),
      ),
      alternatives: Object.freeze(
        this.array(meal.alternatives, `${path}.alternatives`).map(
          (item, itemIndex) =>
            this.item(item, `${path}.alternatives.${itemIndex}`),
        ),
      ),
    });
  }

  private item(value: unknown, path: string): NutritionPlanFoodItem {
    const item = this.record(value, path);
    const macros = this.record(item.macros, `${path}.macros`);
    return Object.freeze({
      itemKey: this.key(item.itemKey, `${path}.itemKey`),
      foodName: this.text(item.foodName, `${path}.foodName`),
      role: this.enumValue(item.role, ROLES, `${path}.role`),
      quantity: this.text(item.quantity, `${path}.quantity`),
      caloriesKcal: this.nullableNumber(
        item.caloriesKcal,
        `${path}.caloriesKcal`,
      ),
      macros: Object.freeze({
        proteinGrams: this.nullableNumber(
          macros.proteinGrams,
          `${path}.macros.proteinGrams`,
        ),
        carbohydrateGrams: this.nullableNumber(
          macros.carbohydrateGrams,
          `${path}.macros.carbohydrateGrams`,
        ),
        fatGrams: this.nullableNumber(
          macros.fatGrams,
          `${path}.macros.fatGrams`,
        ),
      }),
      allergenTags: Object.freeze(
        this.array(item.allergenTags, `${path}.allergenTags`).map((tag) =>
          this.constraint(tag, `${path}.allergenTags`),
        ),
      ),
      dietaryTags: Object.freeze(
        this.array(item.dietaryTags, `${path}.dietaryTags`).map((tag) =>
          this.enumValue(tag, DIETARY_TAGS, `${path}.dietaryTags`),
        ),
      ),
    });
  }

  private substitution(
    value: unknown,
    index: number,
  ): NutritionFoodSubstitution {
    const path = `substitutions.${index}`;
    const item = this.record(value, path);
    return Object.freeze({
      substitutionKey: this.key(
        item.substitutionKey,
        `${path}.substitutionKey`,
      ),
      sourceItemKey: this.key(item.sourceItemKey, `${path}.sourceItemKey`),
      alternativeItemKey: this.key(
        item.alternativeItemKey,
        `${path}.alternativeItemKey`,
      ),
      rationaleCode: this.enumValue(
        item.rationaleCode,
        RATIONALES,
        `${path}.rationaleCode`,
      ),
    });
  }

  private record(value: unknown, path: string): Record<string, unknown> {
    if (!this.isRecord(value)) this.invalid(path);
    return value;
  }

  private array(value: unknown, path: string): readonly unknown[] {
    if (!Array.isArray(value)) this.invalid(path);
    return value;
  }

  private text(value: unknown, path: string): string {
    if (typeof value !== 'string' || !value.trim() || value.length > 500)
      this.invalid(path);
    return value.trim();
  }

  private key(value: unknown, path: string): string {
    const key = this.text(value, path);
    if (!/^[a-z0-9][a-z0-9_-]{0,79}$/i.test(key)) this.invalid(path);
    return key;
  }

  private textArray(value: unknown, path: string): readonly string[] {
    return Object.freeze(
      this.array(value, path).map((item, index) =>
        this.text(item, `${path}.${index}`),
      ),
    );
  }

  private boolean(value: unknown, path: string): boolean {
    if (typeof value !== 'boolean') this.invalid(path);
    return value;
  }

  private integer(
    value: unknown,
    path: string,
    minimum: number,
    maximum: number,
  ): number {
    if (
      !Number.isInteger(value) ||
      typeof value !== 'number' ||
      value < minimum ||
      value > maximum
    )
      this.invalid(path);
    return value;
  }

  private nullableNumber(value: unknown, path: string): number | null {
    if (value === null) return null;
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      value < 0 ||
      value > 5000
    )
      this.invalid(path);
    return value;
  }

  private time(value: unknown, path: string): string {
    const time = this.text(value, path);
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) this.invalid(path);
    return time;
  }

  private artifact(value: unknown): OperationalNutritionPlanArtifactType {
    return this.enumValue(value, ARTIFACTS, 'artifactType');
  }

  private constraint(value: unknown, path: string): NutritionConstraintCode {
    return this.enumValue(value, CONSTRAINTS, path);
  }

  private enumValue<T extends string>(
    value: unknown,
    values: readonly T[],
    path: string,
  ): T {
    if (typeof value !== 'string') this.invalid(path);
    const matched = values.find((candidate) => candidate === value);
    if (!matched) this.invalid(path);
    return matched;
  }

  private invalid(path: string): never {
    throw new BadGatewayException(`Plano nutricional V2 inválido em ${path}`);
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
