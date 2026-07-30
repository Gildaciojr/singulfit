import type { OpenAIResponseResult } from '../../ai/interfaces/openai.interface';
import type {
  GenerateNutritionPlanV2Input,
  NutritionGenerationOutputV2,
  PreparedNutritionPlanningV2,
} from './nutrition-planning-generation.contract';
import type { OpenAIJsonSchema } from '../../ai/interfaces/openai.interface';

export enum NutritionGenerationExecutionMode {
  PRODUCTION = 'PRODUCTION',
  SHADOW = 'SHADOW',
}

export type NutritionGenerationRunErrorStage =
  | 'PROVIDER'
  | 'PARSER'
  | 'VALIDATION';

export class NutritionGenerationRunError extends Error {
  constructor(
    readonly stage: NutritionGenerationRunErrorStage,
    readonly original: unknown,
  ) {
    super(
      original instanceof Error ? original.message : 'Falha nutricional V2',
    );
    this.name = 'NutritionGenerationRunError';
  }
}

export interface NutritionGenerationDescriptorV2 {
  readonly artifactType: Exclude<
    NutritionGenerationOutputV2['artifactType'],
    'CURRENT_PLAN_PRESENTATION'
  >;
  readonly promptName: string;
  readonly promptVersion: number;
  readonly schema: OpenAIJsonSchema;
  readonly canonicalPayload: string;
  readonly operationKey: string;
}

export interface NutritionGenerationRunTimingsV2 {
  readonly providerMs: number;
  readonly parsingMs: number;
  readonly validationMs: number;
  readonly generationMs: number;
}

export interface NutritionGenerationRunResultV2 {
  readonly output: Exclude<
    NutritionGenerationOutputV2,
    { readonly kind: 'CURRENT_PLAN_PRESENTATION' }
  >;
  readonly response: Readonly<OpenAIResponseResult>;
  readonly providerMetadata: {
    readonly provider: 'OPENAI';
    readonly model: string;
    readonly responseId: string;
    readonly promptVersionId: string;
  };
  readonly usage: {
    readonly promptTokens: number;
    readonly completionTokens: number;
    readonly totalTokens: number;
  };
  readonly accounting: {
    readonly estimatedCostUsd: string;
    readonly currency: 'USD';
  };
  readonly attempts: number;
  readonly timings: NutritionGenerationRunTimingsV2;
}

export interface RunNutritionGenerationV2Input {
  readonly mode: NutritionGenerationExecutionMode;
  readonly input: GenerateNutritionPlanV2Input;
  readonly prepared: PreparedNutritionPlanningV2;
  readonly descriptor: NutritionGenerationDescriptorV2;
  readonly promptVersionId: string;
  readonly requestId: string;
  readonly reused: boolean;
  readonly executeProvider: () => Promise<OpenAIResponseResult>;
}
