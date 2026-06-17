import {
  ChurnRiskLevel,
  CoachCommunicationStyle,
  CoachCoachingStyle,
  CoachMotivationStyle,
  CoachTone,
  UserGoalType,
} from '@prisma/client';
import { NutritionUserContext } from '../../nutrition/interfaces/nutrition-context.interface';
import { LongitudinalResponseContext } from '../../longitudinal/interfaces/longitudinal.interface';
import { CoachExperienceSignals } from './coach-experience.interface';
import { AdaptiveIntelligenceSignals } from '../../adaptive-intelligence/interfaces/adaptive-intelligence.interface';

export interface CoachContext {
  userId: string;
  name: string;
  nutrition: NutritionUserContext;
  fitnessProfile: {
    goal: string;
    activityLevel: string;
    currentWeightKg: { toNumber(): number };
    targetWeightKg: { toNumber(): number };
  } | null;
  mealPatterns: Array<{
    category: string;
    mealCount: number;
    frequencyPerWeek: { toNumber(): number };
    averageQualityScore: number;
    recurringFoods: unknown;
  }>;
  recommendations: Array<{
    title: string;
    rationale: string;
    action: string;
    priority: number;
  }>;
  coachProfile: {
    communicationStyle: CoachCommunicationStyle;
    coachingStyle: CoachCoachingStyle;
    tone: CoachTone;
    motivationStyle: CoachMotivationStyle;
  } | null;
  goalClassification: {
    goal: UserGoalType;
    confidence: { toNumber(): number };
  } | null;
  longitudinal: LongitudinalResponseContext;
}

export interface CoachResponseSignals {
  goal: UserGoalType;
  communicationStyle: CoachCommunicationStyle;
  coachingStyle: CoachCoachingStyle;
  tone: CoachTone;
  motivationStyle: CoachMotivationStyle;
  consistencyScore: number;
  engagementScore: number;
  churnRisk: ChurnRiskLevel;
  activeDays: number;
  consecutiveDays: number;
  motivation: string;
  experience: CoachExperienceSignals;
  adaptive: AdaptiveIntelligenceSignals;
}
