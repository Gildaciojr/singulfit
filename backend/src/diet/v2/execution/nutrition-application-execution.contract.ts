import type { NutritionConversationalArtifactV1 } from '../nutrition-conversational-artifact.contract';
import type { NutritionPlanV2 } from '../nutrition-plan-v2.contract';
import type {
  NutritionArtifactType,
  OperationalNutritionPlanArtifactType,
} from '../nutrition-planning-artifact.contract';
import type { GenerateNutritionPlanV2Input } from '../nutrition-planning-generation.contract';

export interface NutritionApplicationExecutionInputV2 {
  readonly generationInput: GenerateNutritionPlanV2Input;
  readonly ownership: { readonly userId: string; readonly profileId: string };
  readonly correlationId: string;
  readonly traceId?: string;
}

interface NutritionExecutionResultBaseV2 {
  readonly artifactType: NutritionArtifactType;
  readonly aiJobCompleted: boolean;
  readonly requiresFormatting: boolean;
  readonly requiresPersistence: boolean;
}

export interface NutritionPlanExecutionResultV2 extends NutritionExecutionResultBaseV2 {
  readonly kind: 'PLAN';
  readonly aggregateId: string;
  readonly artifactType: OperationalNutritionPlanArtifactType;
  readonly document: NutritionPlanV2;
  readonly aiJobCompleted: true;
  readonly requiresFormatting: true;
  readonly requiresPersistence: true;
}

export interface NutritionConversationalExecutionResultV2 extends NutritionExecutionResultBaseV2 {
  readonly kind: 'CONVERSATIONAL_ARTIFACT';
  readonly aggregateId: string;
  readonly artifactType: NutritionConversationalArtifactV1['artifactType'];
  readonly document: NutritionConversationalArtifactV1;
  readonly aiJobCompleted: true;
  readonly requiresFormatting: true;
  readonly requiresPersistence: true;
}

export interface NutritionCurrentPlanPresentationResultV2 extends NutritionExecutionResultBaseV2 {
  readonly kind: 'CURRENT_PLAN_PRESENTATION';
  readonly aggregateId: null;
  readonly artifactType: 'CURRENT_PLAN_PRESENTATION';
  readonly document: null;
  readonly aiJobCompleted: false;
  readonly requiresFormatting: false;
  readonly requiresPersistence: false;
}

export type NutritionExecutionResultV2 =
  | NutritionPlanExecutionResultV2
  | NutritionConversationalExecutionResultV2
  | NutritionCurrentPlanPresentationResultV2;

export type FormattableNutritionExecutionResultV2 = Exclude<
  NutritionExecutionResultV2,
  NutritionCurrentPlanPresentationResultV2
>;
