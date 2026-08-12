export interface PublicNutritionMacroTargets {
  readonly proteinGrams?: number;
  readonly carbohydrateGrams?: number;
  readonly fatGrams?: number;
}

export interface PublicNutritionFoodItem {
  readonly name: string;
  readonly quantity: string;
}

export interface PublicNutritionMeal {
  readonly name: string;
  readonly time?: string;
  readonly items: readonly PublicNutritionFoodItem[];
}

export interface PublicNutritionDay {
  readonly label?: string;
  readonly meals: readonly PublicNutritionMeal[];
}

export interface PublicNutritionSubstitution {
  readonly source: string;
  readonly alternative: string;
}

export interface PublicNutritionResponse {
  readonly userFirstName?: string;
  readonly title: string;
  readonly summary: string;
  readonly goal?: string;
  readonly energyTargetKcal?: number;
  readonly macroTargets?: PublicNutritionMacroTargets;
  readonly days: readonly PublicNutritionDay[];
  readonly substitutions: readonly PublicNutritionSubstitution[];
  readonly hydrationGuidance: readonly string[];
  readonly generalGuidance: readonly string[];
  readonly adaptationGuidance: readonly string[];
  readonly safetyGuidance: readonly string[];
}
