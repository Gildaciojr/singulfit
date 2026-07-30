import type { FitnessGoal } from '@prisma/client';
import type { NutritionArtifactType } from './nutrition-planning-artifact.contract';
import type {
  NutritionConstraintCode,
  NutritionPlanningValue,
} from './nutrition-planning-context.contract';

export type NutritionEnergySource =
  | 'MIFFLIN_ST_JEOR_ESTIMATE'
  | 'NOT_AVAILABLE';

export interface NutritionMacroTargets {
  readonly proteinGrams: number;
  readonly carbohydrateGrams: number;
  readonly fatGrams: number;
}

export interface NutritionPlanningStrategy {
  readonly schemaVersion: 2;
  readonly artifactType: NutritionArtifactType;
  readonly objective: NutritionPlanningValue<FitnessGoal>;
  readonly dayCount: number;
  readonly mealCountPerDay: NutritionPlanningValue<number>;
  readonly mealSchedule: NutritionPlanningValue<readonly string[]>;
  readonly energyTargetKcal: NutritionPlanningValue<number>;
  readonly energySource: NutritionEnergySource;
  readonly macroTargets: NutritionPlanningValue<NutritionMacroTargets>;
  readonly trainingAware: boolean;
  readonly appliedConstraintCodes: readonly NutritionConstraintCode[];
  readonly excludedFoods: readonly string[];
  readonly preferredFoods: readonly string[];
  readonly variationPolicy: 'MINIMAL' | 'DAILY' | 'WEEKLY';
  readonly detailLevel: 'BRIEF' | 'STANDARD' | 'DETAILED';
  readonly factors: readonly NutritionStrategyFactor[];
}

export type NutritionStrategyFactor =
  | 'OBJECTIVE'
  | 'MEAL_COUNT'
  | 'MEAL_SCHEDULE'
  | 'FOOD_CONSTRAINTS'
  | 'FOOD_PREFERENCES'
  | 'TRAINING_CONTEXT'
  | 'COOKING_AVAILABILITY'
  | 'FOOD_BUDGET'
  | 'MEALS_AWAY_FROM_HOME'
  | 'PREVIOUS_PLAN';
