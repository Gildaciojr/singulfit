import {
  AIResponseEvaluationType,
  AIResponseRiskLevel,
  Prisma,
} from '@prisma/client';

export const AI_SAFETY_FLAG = {
  CURE_PROMISE: 'CURE_PROMISE',
  MEDICAL_DIAGNOSIS: 'MEDICAL_DIAGNOSIS',
  MEDICAL_PRESCRIPTION: 'MEDICAL_PRESCRIPTION',
  EXTREME_DIET: 'EXTREME_DIET',
  EXTREME_FASTING: 'EXTREME_FASTING',
  AGGRESSIVE_WEIGHT_LOSS: 'AGGRESSIVE_WEIGHT_LOSS',
  DANGEROUS_LANGUAGE: 'DANGEROUS_LANGUAGE',
  MISSING_PROFESSIONAL_WARNING: 'MISSING_PROFESSIONAL_WARNING',
  OUT_OF_SCOPE: 'OUT_OF_SCOPE',
} as const;

export const AI_QUALITY_FLAG = {
  GENERIC_RESPONSE: 'GENERIC_RESPONSE',
  LOW_PERSONALIZATION: 'LOW_PERSONALIZATION',
  NO_PRACTICAL_ACTION: 'NO_PRACTICAL_ACTION',
  WHATSAPP_TOO_LONG: 'WHATSAPP_TOO_LONG',
  LOW_CLARITY: 'LOW_CLARITY',
} as const;

export type AISafetyFlag = (typeof AI_SAFETY_FLAG)[keyof typeof AI_SAFETY_FLAG];
export type AIQualityFlag =
  (typeof AI_QUALITY_FLAG)[keyof typeof AI_QUALITY_FLAG];

export interface AISafetyResult {
  safetyScore: number;
  riskLevel: AIResponseRiskLevel;
  flags: AISafetyFlag[];
  criticalFlags: AISafetyFlag[];
}

export interface AIQualityContext {
  goal: string | null;
  memoryCount: number;
  recentMealCount: number;
  insightCount: number;
  recommendationCount: number;
  behaviorStage: string | null;
  adherenceScore: number | null;
}

export interface AIQualityResult {
  qualityScore: number;
  personalizationScore: number;
  usefulnessScore: number;
  clarityScore: number;
  flags: AIQualityFlag[];
}

export interface AIResponseDecision {
  originalContent: string;
  finalContent: string;
  evaluationType: AIResponseEvaluationType;
  quality: AIQualityResult;
  safety: AISafetyResult;
  flags: string[];
  blocked: boolean;
  fallbackUsed: boolean;
}

export interface PersistAIResponseEvaluationInput {
  userId: string;
  aiJobId: string | null;
  messageId: string | null;
  responseId: string;
  promptVersionId: string | null;
  estimatedCost: Prisma.Decimal;
  evaluatedAt?: Date;
  decision: AIResponseDecision;
}
