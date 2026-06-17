import { MealCategory, Prisma } from '@prisma/client';

export interface NutritionFoodResult {
  foodName: string;
  estimatedGrams: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  sugar: number;
  isUltraProcessed: boolean;
  isVegetable: boolean;
}

export interface NutritionAnalysisResult {
  foods: NutritionFoodResult[];
  totalCalories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  sugar: number;
  ultraProcessedRatio: number;
  vegetableGrams: number;
  hydrationMl: number;
  mealCategory: MealCategory;
  confidence: number;
}

export interface ParsedNutritionAnalysis {
  result: NutritionAnalysisResult;
  rawResponse: Prisma.InputJsonObject;
}
