import type {
  NutritionArtifactType,
  NutritionShadowErrorCategory,
  NutritionShadowOutputKind,
  NutritionShadowRunStatus,
} from '@prisma/client';
import type { ConversationGoal } from '../../../context/conversation-goal-planner.contract';
import type { GenerateNutritionPlanV2InputSource } from '../generate-nutrition-plan-v2-input.builder';

export interface NutritionShadowExecutionInput {
  readonly source: GenerateNutritionPlanV2InputSource;
  readonly correlationId: string;
  readonly traceId?: string;
  readonly conversationId?: string;
  readonly messageId?: string;
}

export interface NutritionShadowRunRecord {
  readonly id: string;
  readonly operationKey: string;
  readonly inputFingerprint: string;
  readonly conversationGoal: ConversationGoal | null;
  readonly status: NutritionShadowRunStatus;
  readonly artifactType: NutritionArtifactType | null;
  readonly kind: NutritionShadowOutputKind | null;
  readonly documentHash: string | null;
  readonly totalDurationMs: number | null;
  readonly errorCategory: NutritionShadowErrorCategory | null;
}

export type NutritionShadowExecutionResult =
  | {
      readonly status: 'SUCCEEDED';
      readonly shadowRunId: string;
      readonly artifactType: NutritionArtifactType;
      readonly kind: NutritionShadowOutputKind;
      readonly documentHash: string;
      readonly durationMs: number;
      readonly reused: boolean;
    }
  | {
      readonly status: 'FAILED';
      readonly shadowRunId: string;
      readonly errorCategory: NutritionShadowErrorCategory;
      readonly durationMs: number;
    }
  | {
      readonly status: 'SKIPPED';
      readonly reason: 'SHADOW_STORAGE_UNAVAILABLE';
      readonly operationKey: string;
    };

export interface NutritionShadowCompletion {
  readonly artifactType: NutritionArtifactType;
  readonly kind: NutritionShadowOutputKind;
  readonly provider: string | null;
  readonly model: string | null;
  readonly promptVersionId: string | null;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
  readonly estimatedCostUsd: string | null;
  readonly costCurrency: 'USD' | null;
  readonly builderDurationMs: number;
  readonly strategyDurationMs: number;
  readonly providerDurationMs: number;
  readonly parsingDurationMs: number;
  readonly validationDurationMs: number;
  readonly persistenceDurationMs: number | null;
  readonly totalDurationMs: number;
  readonly document: object;
  readonly documentHash: string;
  readonly resultSummary: string;
  readonly activePlanReference: string | null;
}
