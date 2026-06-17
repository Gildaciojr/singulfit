import {
  CoachAdaptationMode,
  FoodPreferenceKind,
  GoalProgressionState,
  LongitudinalDirection,
  NutritionRelapseSeverity,
  UserGoalType,
} from '@prisma/client';

export interface LongitudinalDimensionScores {
  quality: number;
  hydration: number;
  vegetables: number;
  ultraProcessed: number;
  sugar: number;
  protein: number;
}

export interface LongitudinalEvolutionResult {
  current: LongitudinalDimensionScores;
  previous: LongitudinalDimensionScores;
  directions: Record<keyof LongitudinalDimensionScores, LongitudinalDirection>;
  overallDirection: LongitudinalDirection;
}

export interface LongitudinalResponseContext {
  profile: {
    historySize: number;
    adherenceScore: number;
    consistencyScore: number;
  } | null;
  preferences: Array<{
    foodName: string;
    kind: FoodPreferenceKind;
    confidence: number;
  }>;
  evolution: {
    overallDirection: LongitudinalDirection;
    scores: LongitudinalDimensionScores;
  } | null;
  relapse: {
    severity: NutritionRelapseSeverity;
    reasons: string[];
  } | null;
  goalProgression: {
    goal: UserGoalType;
    state: GoalProgressionState;
    score: number;
  } | null;
  coachAdaptation: {
    mode: CoachAdaptationMode;
    reason: string;
  } | null;
  memories: Array<{
    kind: string;
    title: string;
    summary: string;
  }>;
  monthlyReview: {
    monthStart: Date;
    direction: LongitudinalDirection;
    content: string;
  } | null;
}

export interface LongitudinalMealSignal {
  calculatedAt: Date;
  score: number;
  goalAdherenceScore: number;
  proteinScore: number;
  sugarScore: number;
  ultraProcessedScore: number;
  mealAnalysis: {
    hydrationMl: { toNumber(): number } | null;
    vegetableGrams: { toNumber(): number } | null;
    totalProtein: { toNumber(): number } | null;
    totalSugar: { toNumber(): number } | null;
    ultraProcessedRatio: { toNumber(): number } | null;
    items: Array<{
      foodName: string;
      isUltraProcessed: boolean;
      isVegetable: boolean;
    }>;
  };
}
