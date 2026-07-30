import type {
  NutritionArtifactType,
  NutritionPlanLifecycleReason,
  NutritionPlanStatus,
} from '@prisma/client';
import type { NutritionPlanV2 } from '../nutrition-plan-v2.contract';
import type {
  CompletedNutritionPlanGenerationResult,
  NutritionExecutionContextV2,
  PendingNutritionPlanGenerationResult,
} from '../nutrition-planning-generation.contract';

export interface NutritionPlanV2Ownership {
  readonly userId: string;
  readonly profileId: string;
}

export interface PersistNutritionPlanV2Input {
  readonly generation:
    | PendingNutritionPlanGenerationResult
    | CompletedNutritionPlanGenerationResult;
  readonly ownership: NutritionPlanV2Ownership;
  readonly executionContext?: NutritionExecutionContextV2;
}

export interface PersistedNutritionPlanV2Aggregate {
  readonly id: string;
  readonly userId: string;
  readonly profileId: string;
  readonly aiJobId: string;
  readonly schemaVersion: number;
  readonly engineVersion: number;
  readonly artifactType: NutritionArtifactType;
  readonly lifecycleReason: NutritionPlanLifecycleReason;
  readonly replacesPlanReference: string | null;
  readonly status: NutritionPlanStatus;
  readonly document: NutritionPlanV2;
  readonly generatedAt: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface PersistNutritionPlanV2Result {
  readonly persistence: 'CREATED' | 'REUSED';
  readonly aggregate: PersistedNutritionPlanV2Aggregate;
  readonly aiJobCompleted: true;
}
