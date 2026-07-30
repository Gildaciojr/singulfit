import type {
  NutritionArtifactType,
  NutritionShadowComparisonDivergence,
  NutritionShadowOutputKind,
} from '@prisma/client';
import type { ConversationGoal } from '../../../context/conversation-goal-planner.contract';

export const NUTRITION_SHADOW_COMPARISON_WEIGHTS = Object.freeze({
  structural: 1 / 3,
  semantic: 1 / 3,
  operational: 1 / 3,
});

export const NUTRITION_SHADOW_CONTENT_OVERLAP_THRESHOLD = 0.5;

export interface NutritionLegacyComparisonSnapshot {
  readonly conversationId: string;
  readonly messageId: string;
  readonly response: string;
  readonly responseType?: string;
  readonly durationMs: number | null;
  readonly provider: string | null;
  readonly model: string | null;
  readonly totalTokens: number | null;
  readonly estimatedCostUsd: string | null;
  readonly attempts: number;
  readonly parserSucceeded: boolean;
  readonly validationSucceeded: boolean;
}

export interface NutritionShadowComparisonSnapshot {
  readonly shadowRunId: string;
  readonly conversationGoal: ConversationGoal | null;
  readonly artifactType: NutritionArtifactType;
  readonly kind: NutritionShadowOutputKind;
  readonly document: object;
  readonly documentHash: string;
  readonly durationMs: number;
  readonly provider: string | null;
  readonly model: string | null;
  readonly totalTokens: number;
  readonly estimatedCostUsd: string | null;
  readonly attempts: number;
  readonly parserSucceeded: boolean;
  readonly validationSucceeded: boolean;
}

export interface NutritionComparisonExpectation {
  readonly artifactType: NutritionArtifactType;
  readonly kind: NutritionShadowOutputKind;
  readonly conversationGoal: ConversationGoal;
  readonly objectiveTerms: readonly string[];
  readonly focusTerms: readonly string[];
  readonly contextTerms: readonly string[];
  readonly forbiddenRestrictionTerms: readonly string[];
}

export interface CompareNutritionShadowInput {
  readonly legacy: NutritionLegacyComparisonSnapshot;
  readonly shadow: NutritionShadowComparisonSnapshot;
  readonly expectation: NutritionComparisonExpectation;
}

export interface NutritionComparisonResult {
  readonly comparisonId: string;
  readonly conversationId: string;
  readonly shadowRunId: string;
  readonly equivalent: boolean;
  readonly structuralScore: number;
  readonly semanticScore: number;
  readonly operationalScore: number;
  readonly overallScore: number;
  readonly divergences: readonly NutritionShadowComparisonDivergence[];
  readonly metrics: {
    readonly timeRatio: string | null;
    readonly tokenRatio: string | null;
    readonly costRatio: string | null;
    readonly contentOverlap: number;
  };
  readonly reused: boolean;
}
