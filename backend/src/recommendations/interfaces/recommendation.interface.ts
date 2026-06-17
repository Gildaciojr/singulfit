import {
  BehavioralMotivationStyle,
  FitnessGoal,
  MotivationTriggerType,
  NutritionInsightType,
  NutritionTrendDirection,
  Prisma,
  RecommendationCategory,
  RecommendationPriority,
  StageOfChange,
  UserGoalType,
} from '@prisma/client';

export interface RecommendationConfidenceInput {
  contextSources: number;
  historyDepth: number;
  recurrence: number;
  signalStrength: number;
}

export interface RecommendationCandidate {
  category: RecommendationCategory;
  priority: RecommendationPriority;
  signalKey: string;
  title: string;
  description: string;
  reason: string;
  evidence: Prisma.InputJsonObject;
  confidence: RecommendationConfidenceInput;
}

export interface NutritionRecommendationEngineInput {
  goal: FitnessGoal | UserGoalType | null;
  restrictionsCount: number;
  insights: Array<{
    type: NutritionInsightType;
    title: string;
    occurrences: number;
  }>;
  trends: Array<{
    windowDays: number;
    mealsAnalyzed: number;
    direction: NutritionTrendDirection;
    consistencyScore: number;
    goalAdherenceScore: number;
  }>;
  patterns: Array<{
    category: string;
    mealCount: number;
    frequencyPerWeek: number;
    averageQualityScore: number;
  }>;
}

export interface BehavioralRecommendationEngineInput {
  profile: {
    communicationStyle: string;
    motivationStyle: BehavioralMotivationStyle;
    adherenceStyle: string;
    confidenceScore: number;
  } | null;
  motivations: Array<{
    type: BehavioralMotivationStyle;
    weight: number;
  }>;
  adherence: {
    score: number;
    consistencyScore: number;
    responseScore: number;
  } | null;
  stage: StageOfChange | null;
  triggers: Array<{
    type: MotivationTriggerType;
    weight: number;
  }>;
}

export interface RetentionRecommendationEngineInput {
  engagement: {
    score: number;
    messagesLast7Days: number;
    analysesLast7Days: number;
  } | null;
  consistency: {
    score: number;
    continuityScore: number;
  } | null;
  churn: {
    level: string;
    daysInactive: number;
    activityDrop: number;
  } | null;
}
