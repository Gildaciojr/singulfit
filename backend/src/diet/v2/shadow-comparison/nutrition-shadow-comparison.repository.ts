import type {
  NutritionArtifactType,
  NutritionShadowComparisonDivergence,
  NutritionShadowOutputKind,
} from '@prisma/client';
import type { ConversationGoal } from '../../../context/conversation-goal-planner.contract';

export const NUTRITION_SHADOW_COMPARISON_REPOSITORY = Symbol(
  'NUTRITION_SHADOW_COMPARISON_REPOSITORY',
);

export interface PersistNutritionShadowComparisonInput {
  readonly operationKey: string;
  readonly inputFingerprint: string;
  readonly conversationId: string;
  readonly messageId: string;
  readonly shadowRunId: string;
  readonly conversationGoal: ConversationGoal;
  readonly expectedArtifactType: NutritionArtifactType;
  readonly actualArtifactType: NutritionArtifactType;
  readonly expectedKind: NutritionShadowOutputKind;
  readonly actualKind: NutritionShadowOutputKind;
  readonly equivalent: boolean;
  readonly structuralScore: number;
  readonly semanticScore: number;
  readonly operationalScore: number;
  readonly overallScore: number;
  readonly divergences: readonly NutritionShadowComparisonDivergence[];
  readonly legacyDurationMs: number | null;
  readonly shadowDurationMs: number;
  readonly legacyTokens: number | null;
  readonly shadowTokens: number;
  readonly legacyCostUsd: string | null;
  readonly shadowCostUsd: string | null;
  readonly timeRatio: string | null;
  readonly tokenRatio: string | null;
  readonly costRatio: string | null;
  readonly legacyProvider: string | null;
  readonly shadowProvider: string | null;
  readonly legacyModel: string | null;
  readonly shadowModel: string | null;
  readonly legacyHash: string;
  readonly shadowHash: string;
}

export interface PersistedNutritionShadowComparison {
  readonly id: string;
  readonly inputFingerprint: string;
}

export interface NutritionShadowComparisonRepository {
  persist(input: PersistNutritionShadowComparisonInput): Promise<{
    readonly comparison: PersistedNutritionShadowComparison;
    readonly reused: boolean;
  }>;
}
