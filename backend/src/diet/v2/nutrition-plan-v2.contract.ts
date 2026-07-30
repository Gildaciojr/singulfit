import type { OperationalNutritionPlanArtifactType } from './nutrition-planning-artifact.contract';
import type { NutritionConstraintCode } from './nutrition-planning-context.contract';
import type { NutritionPlanningStrategy } from './nutrition-planning-strategy.contract';

export type NutritionPlanLifecycleReason =
  | 'CREATION'
  | 'REPLACEMENT'
  | 'ADAPTATION'
  | 'REVIEW'
  | 'REACTIVATION';

export interface NutritionPlanMacroEstimate {
  readonly proteinGrams: number | null;
  readonly carbohydrateGrams: number | null;
  readonly fatGrams: number | null;
}

export interface NutritionPlanFoodItem {
  readonly itemKey: string;
  readonly foodName: string;
  readonly role:
    | 'PROTEIN'
    | 'CARBOHYDRATE'
    | 'FAT'
    | 'VEGETABLE'
    | 'FRUIT'
    | 'BEVERAGE'
    | 'OTHER';
  readonly quantity: string;
  readonly caloriesKcal: number | null;
  readonly macros: NutritionPlanMacroEstimate;
  readonly allergenTags: readonly NutritionConstraintCode[];
  readonly dietaryTags: readonly ('VEGETARIAN' | 'VEGAN')[];
}

export interface NutritionPlanMeal {
  readonly mealKey: string;
  readonly name: string;
  readonly period:
    | 'BREAKFAST'
    | 'MORNING_SNACK'
    | 'LUNCH'
    | 'AFTERNOON_SNACK'
    | 'DINNER'
    | 'EVENING_SNACK'
    | 'FLEXIBLE';
  readonly suggestedTime: string | null;
  readonly items: readonly NutritionPlanFoodItem[];
  readonly alternatives: readonly NutritionPlanFoodItem[];
}

export interface NutritionPlanDay {
  readonly dayNumber: number;
  readonly label: string;
  readonly trainingDay: boolean;
  readonly meals: readonly NutritionPlanMeal[];
}

export interface NutritionFoodSubstitution {
  readonly substitutionKey: string;
  readonly sourceItemKey: string;
  readonly alternativeItemKey: string;
  readonly rationaleCode:
    | 'EQUIVALENT_ROLE'
    | 'PREFERENCE'
    | 'AVAILABILITY'
    | 'VARIETY';
}

export interface NutritionPlanValidationIssue {
  readonly code:
    | 'ARTIFACT_MISMATCH'
    | 'DAY_COUNT_MISMATCH'
    | 'MEAL_COUNT_MISMATCH'
    | 'DUPLICATE_KEY'
    | 'FORBIDDEN_CONSTRAINT'
    | 'REJECTED_FOOD'
    | 'ENERGY_INCOHERENT'
    | 'MACROS_INCOHERENT'
    | 'SUBSTITUTION_REFERENCE_INVALID'
    | 'SUBSTITUTION_UNSAFE'
    | 'EMPTY_PLAN'
    | 'EXTREME_VALUE';
  readonly severity: 'ERROR' | 'WARNING';
  readonly path: string;
}

export interface NutritionPlanValidationResult {
  readonly status: 'VALID' | 'VALID_WITH_WARNINGS' | 'INVALID';
  readonly issues: readonly NutritionPlanValidationIssue[];
}

export interface NutritionPlanGenerationMetadata {
  readonly engineVersion: 2;
  readonly promptVersionId: string;
  readonly aiJobId: string;
  readonly operationKey: string;
  readonly model: string;
  readonly generatedAt: string;
  readonly reused: boolean;
}

export interface NutritionPlanV2 {
  readonly schemaVersion: 2;
  readonly artifactType: OperationalNutritionPlanArtifactType;
  readonly lifecycleReason: NutritionPlanLifecycleReason;
  readonly replacesPlanReference: string | null;
  readonly title: string;
  readonly objectiveSummary: string;
  readonly strategy: NutritionPlanningStrategy;
  readonly guidance: readonly string[];
  readonly days: readonly NutritionPlanDay[];
  readonly substitutions: readonly NutritionFoodSubstitution[];
  readonly adaptationRules: readonly string[];
  readonly hydrationGuidance: readonly string[];
  readonly safetyNotes: readonly string[];
  readonly generation: NutritionPlanGenerationMetadata;
  readonly validation: NutritionPlanValidationResult;
}

export interface GeneratedNutritionPlanCandidate {
  readonly artifactType: OperationalNutritionPlanArtifactType;
  readonly title: string;
  readonly objectiveSummary: string;
  readonly guidance: readonly string[];
  readonly days: readonly NutritionPlanDay[];
  readonly substitutions: readonly NutritionFoodSubstitution[];
  readonly adaptationRules: readonly string[];
  readonly hydrationGuidance: readonly string[];
  readonly safetyNotes: readonly string[];
}
