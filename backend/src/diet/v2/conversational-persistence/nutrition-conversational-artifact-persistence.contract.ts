import type { NutritionConversationalArtifact as PersistedArtifact } from '@prisma/client';
import type { NutritionConversationalArtifactV1 } from '../nutrition-conversational-artifact.contract';
import type {
  CompletedNutritionConversationalGenerationResult,
  NutritionExecutionContextV2,
  PendingNutritionConversationalGenerationResult,
} from '../nutrition-planning-generation.contract';

export interface PersistNutritionConversationalArtifactInput {
  readonly generation:
    | PendingNutritionConversationalGenerationResult
    | CompletedNutritionConversationalGenerationResult;
  readonly userId: string;
  readonly executionContext?: NutritionExecutionContextV2;
}
export interface PersistedNutritionConversationalArtifactAggregate extends Omit<
  PersistedArtifact,
  'document'
> {
  readonly document: NutritionConversationalArtifactV1;
}
export interface PersistNutritionConversationalArtifactResult {
  readonly persistence: 'CREATED' | 'REUSED';
  readonly aggregate: PersistedNutritionConversationalArtifactAggregate;
  readonly aiJobCompleted: true;
}
