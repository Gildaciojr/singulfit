export interface GeneratedDietMealItem {
  readonly foodName: string;
  readonly quantity: string;
  readonly calories: number;
  readonly protein: number;
  readonly carbs: number;
  readonly fat: number;
  readonly substitutionGroup: string | null;
}

export interface GeneratedDietMeal {
  readonly name: string;
  readonly order: number;
  readonly caloriesTarget: number;
  readonly notes: string | null;
  readonly items: readonly GeneratedDietMealItem[];
}

export interface GeneratedDietPlan {
  readonly title: string;
  readonly dailyCaloriesTarget: number;
  readonly proteinTarget: number;
  readonly carbsTarget: number;
  readonly fatTarget: number;
  readonly meals: readonly GeneratedDietMeal[];
}
