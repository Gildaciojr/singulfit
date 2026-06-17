export interface GeneratedDietMealItem {
  foodName: string;
  quantity: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  substitutionGroup: string | null;
}

export interface GeneratedDietMeal {
  name: string;
  order: number;
  caloriesTarget: number;
  notes: string | null;
  items: GeneratedDietMealItem[];
}

export interface GeneratedDietPlan {
  title: string;
  dailyCaloriesTarget: number;
  proteinTarget: number;
  carbsTarget: number;
  fatTarget: number;
  meals: GeneratedDietMeal[];
}
