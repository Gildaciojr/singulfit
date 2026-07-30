import { Injectable } from '@nestjs/common';
import type { NutritionPlanningContext } from './nutrition-planning-context.contract';
import type {
  GeneratedNutritionPlanCandidate,
  NutritionPlanFoodItem,
  NutritionPlanValidationIssue,
  NutritionPlanValidationResult,
} from './nutrition-plan-v2.contract';
import type { NutritionPlanningStrategy } from './nutrition-planning-strategy.contract';

const CONSTRAINT_TERMS: Readonly<Record<string, readonly string[]>> =
  Object.freeze({
    LACTOSE: Object.freeze([
      'leite',
      'queijo',
      'iogurte',
      'lactose',
      'requeijao',
    ]),
    MILK: Object.freeze(['leite', 'queijo', 'iogurte', 'requeijao']),
    GLUTEN: Object.freeze(['trigo', 'pao', 'macarrao', 'cevada', 'centeio']),
    PEANUT: Object.freeze(['amendoim']),
    TREE_NUT: Object.freeze(['castanha', 'nozes', 'amendoa']),
    EGG: Object.freeze(['ovo', 'omelete']),
    SOY: Object.freeze(['soja', 'tofu']),
    FISH: Object.freeze(['peixe', 'atum', 'sardinha', 'salmao']),
    SHELLFISH: Object.freeze(['camarao', 'marisco', 'lagosta']),
  });

@Injectable()
export class NutritionPlanV2Validator {
  validate(
    candidate: GeneratedNutritionPlanCandidate,
    context: NutritionPlanningContext,
    strategy: NutritionPlanningStrategy,
  ): NutritionPlanValidationResult {
    const issues: NutritionPlanValidationIssue[] = [];
    if (candidate.artifactType !== strategy.artifactType)
      this.issue(issues, 'ARTIFACT_MISMATCH', 'ERROR', 'artifactType');
    if (candidate.days.length !== strategy.dayCount)
      this.issue(issues, 'DAY_COUNT_MISMATCH', 'ERROR', 'days');
    if (candidate.days.length === 0 && strategy.dayCount > 0)
      this.issue(issues, 'EMPTY_PLAN', 'ERROR', 'days');

    const keys = new Set<string>();
    const items = new Map<string, NutritionPlanFoodItem>();
    for (const day of candidate.days) {
      if (
        strategy.mealCountPerDay.status !== 'NOT_SET' &&
        day.meals.length !== strategy.mealCountPerDay.value
      )
        this.issue(
          issues,
          'MEAL_COUNT_MISMATCH',
          'ERROR',
          `days.${day.dayNumber}.meals`,
        );
      for (const meal of day.meals) {
        this.unique(keys, meal.mealKey, issues, `meal:${meal.mealKey}`);
        for (const item of [...meal.items, ...meal.alternatives]) {
          this.unique(keys, item.itemKey, issues, `item:${item.itemKey}`);
          items.set(item.itemKey, item);
          this.validateItem(item, context, strategy, issues);
        }
      }
      this.validateTotals(
        day.meals.flatMap((meal) => meal.items),
        strategy,
        issues,
        `days.${day.dayNumber}`,
      );
    }
    for (const substitution of candidate.substitutions) {
      this.unique(
        keys,
        substitution.substitutionKey,
        issues,
        `substitution:${substitution.substitutionKey}`,
      );
      const source = items.get(substitution.sourceItemKey);
      const alternative = items.get(substitution.alternativeItemKey);
      if (!source || !alternative) {
        this.issue(
          issues,
          'SUBSTITUTION_REFERENCE_INVALID',
          'ERROR',
          `substitutions.${substitution.substitutionKey}`,
        );
      } else if (
        alternative.allergenTags.some((tag) =>
          strategy.appliedConstraintCodes.includes(tag),
        )
      ) {
        this.issue(
          issues,
          'SUBSTITUTION_UNSAFE',
          'ERROR',
          `substitutions.${substitution.substitutionKey}`,
        );
      }
    }

    const status = issues.some((issue) => issue.severity === 'ERROR')
      ? 'INVALID'
      : issues.length > 0
        ? 'VALID_WITH_WARNINGS'
        : 'VALID';
    return Object.freeze({
      status,
      issues: Object.freeze(issues.map((issue) => Object.freeze(issue))),
    });
  }

  private validateItem(
    item: NutritionPlanFoodItem,
    context: NutritionPlanningContext,
    strategy: NutritionPlanningStrategy,
    issues: NutritionPlanValidationIssue[],
  ): void {
    const normalized = this.normalize(item.foodName);
    for (const code of strategy.appliedConstraintCodes) {
      const tagged = item.allergenTags.includes(code);
      const termMatched = (CONSTRAINT_TERMS[code] ?? []).some((term) =>
        normalized.includes(term),
      );
      if (tagged || termMatched)
        this.issue(
          issues,
          'FORBIDDEN_CONSTRAINT',
          'ERROR',
          `items.${item.itemKey}`,
        );
    }
    for (const food of strategy.excludedFoods) {
      if (normalized.includes(this.normalize(food)))
        this.issue(issues, 'REJECTED_FOOD', 'ERROR', `items.${item.itemKey}`);
    }
    if (item.caloriesKcal !== null && item.caloriesKcal > 2000)
      this.issue(
        issues,
        'EXTREME_VALUE',
        'ERROR',
        `items.${item.itemKey}.caloriesKcal`,
      );
    if (
      context.constraints.some(
        (constraint) =>
          constraint.code === 'VEGAN' && !item.dietaryTags.includes('VEGAN'),
      )
    )
      this.issue(
        issues,
        'FORBIDDEN_CONSTRAINT',
        'ERROR',
        `items.${item.itemKey}.dietaryTags`,
      );
  }

  private validateTotals(
    items: readonly NutritionPlanFoodItem[],
    strategy: NutritionPlanningStrategy,
    issues: NutritionPlanValidationIssue[],
    path: string,
  ): void {
    if (
      strategy.energyTargetKcal.status !== 'NOT_SET' &&
      items.every((item) => item.caloriesKcal !== null)
    ) {
      const total = items.reduce(
        (sum, item) => sum + (item.caloriesKcal ?? 0),
        0,
      );
      if (
        Math.abs(total - strategy.energyTargetKcal.value) /
          strategy.energyTargetKcal.value >
        0.25
      )
        this.issue(issues, 'ENERGY_INCOHERENT', 'ERROR', path);
    }
    if (
      strategy.macroTargets.status !== 'NOT_SET' &&
      items.every(
        (item) =>
          item.macros.proteinGrams !== null &&
          item.macros.carbohydrateGrams !== null &&
          item.macros.fatGrams !== null,
      )
    ) {
      const totals = items.reduce(
        (sum, item) => ({
          proteinGrams: sum.proteinGrams + (item.macros.proteinGrams ?? 0),
          carbohydrateGrams:
            sum.carbohydrateGrams + (item.macros.carbohydrateGrams ?? 0),
          fatGrams: sum.fatGrams + (item.macros.fatGrams ?? 0),
        }),
        { proteinGrams: 0, carbohydrateGrams: 0, fatGrams: 0 },
      );
      const target = strategy.macroTargets.value;
      if (
        this.deviation(totals.proteinGrams, target.proteinGrams) > 0.3 ||
        this.deviation(totals.carbohydrateGrams, target.carbohydrateGrams) >
          0.3 ||
        this.deviation(totals.fatGrams, target.fatGrams) > 0.3
      )
        this.issue(issues, 'MACROS_INCOHERENT', 'ERROR', path);
    }
  }

  private deviation(value: number, target: number): number {
    return target === 0
      ? value === 0
        ? 0
        : 1
      : Math.abs(value - target) / target;
  }

  private unique(
    keys: Set<string>,
    key: string,
    issues: NutritionPlanValidationIssue[],
    path: string,
  ): void {
    if (keys.has(key)) this.issue(issues, 'DUPLICATE_KEY', 'ERROR', path);
    keys.add(key);
  }

  private issue(
    issues: NutritionPlanValidationIssue[],
    code: NutritionPlanValidationIssue['code'],
    severity: NutritionPlanValidationIssue['severity'],
    path: string,
  ): void {
    issues.push({ code, severity, path });
  }

  private normalize(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  }
}
