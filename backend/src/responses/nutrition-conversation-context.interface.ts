import {
  CoachCoachingStyle,
  CoachTone,
  FitnessGoal,
  MealCategory,
  StageOfChange,
} from '@prisma/client';

export type NutritionConversationCommunicationStyle =
  | 'DIRECT'
  | 'FRIENDLY'
  | 'ANALYTICAL'
  | 'COACHING'
  | 'MOTIVATIONAL'
  | 'BALANCED';

export type NutritionConversationMotivationFocus =
  | 'HEALTH'
  | 'APPEARANCE'
  | 'PERFORMANCE'
  | 'LONGEVITY'
  | 'SELF_ESTEEM'
  | 'ACHIEVEMENT'
  | 'DATA';

export type NutritionConversationTrendDirection =
  | 'IMPROVING'
  | 'STABLE'
  | 'DECLINING';

export interface NutritionConversationConstraint {
  readonly type?: string;
  readonly description: string;
}

export interface NutritionConversationFood {
  readonly name: string;
  readonly estimatedGrams: number;
}

export interface NutritionConversationMealReference {
  readonly occurredAt: string;
  readonly category: MealCategory;
  readonly score: number | null;
  readonly foods: readonly string[];
}

export type NutritionConversationLongitudinalSignal =
  | {
      readonly kind: 'NUTRITION_EVOLUTION';
      readonly direction: NutritionConversationTrendDirection;
    }
  | {
      readonly kind: 'GOAL_PROGRESSION';
      readonly direction: NutritionConversationTrendDirection;
      readonly score: number;
    };

export interface NutritionConversationContext {
  readonly metadata: {
    readonly mealAnalysisId: string;
    readonly recommendationId?: string;
  };
  readonly facts: {
    readonly mealCategory: MealCategory;
    readonly foods: readonly NutritionConversationFood[];
    readonly totalCalories: number | null;
    readonly totalProtein: number | null;
    readonly totalCarbs: number | null;
    readonly totalFat: number | null;
    readonly qualityScore: number | null;
    readonly confidence?: number;
  };
  readonly policies: {
    readonly requiresEstimateQualification: boolean;
  };
  readonly userContext: {
    readonly goal: FitnessGoal | null;
    readonly activityLevel: string | null;
    readonly relevantRestrictions: readonly NutritionConversationConstraint[];
    readonly relevantAllergies: readonly NutritionConversationConstraint[];
    readonly preferredLanguage: string | null;
    readonly timezone: string | null;
    readonly memory?: {
      readonly summary: string;
    };
    readonly recentMeals: readonly NutritionConversationMealReference[];
    readonly insight?: {
      readonly title: string;
      readonly summary: string;
    };
    readonly trend?: {
      readonly windowDays: number;
      readonly averageQualityScore: number;
      readonly direction: string;
      readonly consistencyScore: number;
      readonly goalAdherenceScore: number;
    };
    readonly longitudinalSignal?: NutritionConversationLongitudinalSignal;
  };
  readonly direction: {
    readonly authorizedRecommendation?: {
      readonly title: string;
      readonly action: string;
      readonly rationale?: string;
    };
    readonly supportingEvidence: {
      readonly positiveFactors: readonly string[];
      readonly limitingFactors: readonly string[];
    };
  };
  readonly communication: {
    readonly communicationStyle: NutritionConversationCommunicationStyle;
    readonly coachingStyle: CoachCoachingStyle;
    readonly tone: CoachTone;
    readonly motivationFocus: NutritionConversationMotivationFocus;
    readonly prefersShortMessages: boolean;
    readonly preferredMessageLength: number;
    readonly idealEmojiCount: number;
    readonly fatigue: {
      readonly score: number;
      readonly repeatedThemeScore: number;
      readonly repeatedPhraseScore: number;
    };
    readonly stageOfChange: StageOfChange;
    readonly preferredTopics: readonly string[];
    readonly ignoredTopics: readonly string[];
    readonly shouldAskQuestion: boolean;
  };
}
