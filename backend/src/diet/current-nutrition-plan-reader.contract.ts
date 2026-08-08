import type {
  DietPlanStatus,
  FitnessGoal,
  NutritionArtifactType,
  NutritionPlanLifecycleReason,
  NutritionPlanStatus,
} from '@prisma/client';
import type { NutritionPlanV2 } from './v2/nutrition-plan-v2.contract';

export type NutritionPlanImplementation = 'LEGACY' | 'V2';

interface CurrentNutritionPlanBase {
  readonly id: string;
  readonly userId: string;
  readonly profileId: string;
  readonly aiJobId: string;
  readonly title: string;
  readonly generatedAt: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface LegacyNutritionPlanMealItem {
  readonly id: string;
  readonly foodName: string;
  readonly quantity: string;
  readonly calories: number;
  readonly protein: number;
  readonly carbs: number;
  readonly fat: number;
  readonly substitutionGroup: string | null;
}

export interface LegacyNutritionPlanMeal {
  readonly id: string;
  readonly name: string;
  readonly order: number;
  readonly caloriesTarget: number;
  readonly notes: string | null;
  readonly items: readonly LegacyNutritionPlanMealItem[];
}

export interface LegacyCurrentNutritionPlan extends CurrentNutritionPlanBase {
  readonly implementation: 'LEGACY';
  readonly status: DietPlanStatus;
  readonly objective: FitnessGoal;
  readonly dailyCaloriesTarget: number;
  readonly proteinTarget: number;
  readonly carbsTarget: number;
  readonly fatTarget: number;
  readonly meals: readonly LegacyNutritionPlanMeal[];
}

export interface V2CurrentNutritionPlan extends CurrentNutritionPlanBase {
  readonly implementation: 'V2';
  readonly status: NutritionPlanStatus;
  readonly schemaVersion: number;
  readonly engineVersion: number;
  readonly artifactType: NutritionArtifactType;
  readonly lifecycleReason: NutritionPlanLifecycleReason;
  readonly replacesPlanReference: string | null;
  readonly objectiveSummary: string;
  readonly document: NutritionPlanV2;
}

export type CurrentNutritionPlan =
  | LegacyCurrentNutritionPlan
  | V2CurrentNutritionPlan;

export type NutritionPlanReference = Readonly<
  | { implementation: 'LEGACY'; id: string }
  | { implementation: 'V2'; id: string }
>;

export const CANONICAL_NUTRITION_READ_CONFLICT =
  'CANONICAL_NUTRITION_READ_CONFLICT' as const;
