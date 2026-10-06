export type OpenAIModelCapability = 'TEXT' | 'VISION';

export interface OpenAITextRequest {
  instructions: string;
  input: string;
  requestId: string;
  jsonSchema?: OpenAIJsonSchema;
  timeoutMs?: number;
  /** Durable repair must use the original model, without switching configuration. */
  expectedModel?: string;
}

export interface OpenAIJsonSchema {
  name: string;
  description?: string;
  schema: Record<string, unknown>;
}

export interface OpenAIVisionRequest extends OpenAITextRequest {
  imageUrl: string;
  jsonSchema?: OpenAIJsonSchema;
}

export interface OpenAIResponseResult {
  responseId: string;
  model: string;
  outputText: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface OpenAIBackgroundResponse {
  readonly responseId: string;
  readonly status:
    | 'queued'
    | 'in_progress'
    | 'completed'
    | 'failed'
    | 'cancelled'
    | 'incomplete';
  readonly result?: OpenAIResponseResult;
}
