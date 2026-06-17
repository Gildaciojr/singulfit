import { FitnessGoal, MealCategory } from '@prisma/client';

export interface NutritionContextMeal {
  id: string;
  createdAt: Date;
  category: MealCategory;
  score: number | null;
  foods: string[];
}

export interface NutritionUserContext {
  userId: string;
  goal: FitnessGoal | null;
  activityLevel: string | null;
  restrictions: unknown[];
  allergies: unknown[];
  preferences: {
    preferredMealTimes: unknown;
    preferredLanguage: string;
    timezone: string;
  } | null;
  latestSnapshot: unknown;
  memories: Array<{
    summary: string;
    content: unknown;
  }>;
  statistics: {
    nutritionAnalysesCount: number;
    adherenceScore: number | null;
    messagesLast7Days: number;
    messagesLast30Days: number;
  };
  recentMeals: NutritionContextMeal[];
  activeInsights: Array<{
    id: string;
    type: string;
    title: string;
    summary: string;
    occurrences: number;
  }>;
  trends: Array<{
    windowDays: number;
    averageQualityScore: number;
    direction: string;
    consistencyScore: number;
    goalAdherenceScore: number;
  }>;
}
