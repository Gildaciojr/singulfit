import type {
  NutritionArtifactType,
  NutritionShadowRuntimeSkipReason,
} from '@prisma/client';
import type { NutritionLegacyComparisonSnapshot } from '../shadow-comparison/nutrition-shadow-comparison.contract';
import type { GenerateNutritionPlanV2InputSource } from '../generate-nutrition-plan-v2-input.builder';

export interface NutritionShadowRuntimeInput {
  readonly source: GenerateNutritionPlanV2InputSource;
  readonly expectedArtifactType: NutritionArtifactType | null;
  readonly legacy: NutritionLegacyComparisonSnapshot;
  readonly correlationId: string;
  readonly traceId?: string;
}

export type NutritionShadowRuntimeDispatchResult =
  | Readonly<{ status: 'STARTED'; runtimeDecisionId: string }>
  | Readonly<{
      status: 'SKIPPED';
      reason: NutritionShadowRuntimeSkipReason;
      runtimeDecisionId: string;
    }>;
