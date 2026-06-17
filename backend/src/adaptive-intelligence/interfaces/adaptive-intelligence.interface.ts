import {
  AdaptiveCommunicationProfile,
  DietaryPatternType,
  EarlyChurnLevel,
  FoodQualityClass,
  NutritionTrendDirection,
} from '@prisma/client';

export interface AdaptiveIntelligenceSignals {
  nutritionEvidence: {
    score: number;
    vegetableScore: number;
    proteinScore: number;
    ultraProcessedScore: number;
    sugarScore: number;
    fiberScore: number;
    hydrationScore: number;
    mealsAnalyzed: number;
  };
  foodQuality: {
    qualityClass: FoodQualityClass;
    score: number;
    positiveFactors: string[];
    limitingFactors: string[];
    explanation: string;
  } | null;
  dietaryPatterns: Array<{
    pattern: DietaryPatternType;
    confidence: number;
  }>;
  learning: {
    acceptedCount: number;
    ignoredCount: number;
    rejectedCount: number;
    shortChallengeScore: number;
    preferredTopics: string[];
    ignoredTopics: string[];
    topicScores: Record<string, number>;
    confidence: number;
  };
  communication: {
    profile: AdaptiveCommunicationProfile;
    confidence: number;
    idealLength: number;
    structurePreference: string;
  };
  earlyChurn: {
    score: number;
    level: EarlyChurnLevel;
    reasons: string[];
  };
  recommendationRanking: Array<{
    recommendationId: string;
    rank: number;
    adaptiveScore: number;
  }>;
  evolution: Array<{
    windowDays: number;
    score: number;
    previousScore: number | null;
    direction: NutritionTrendDirection;
  }>;
  coachMemory: Array<{
    kind: string;
    title: string;
    summary: string;
  }>;
}
