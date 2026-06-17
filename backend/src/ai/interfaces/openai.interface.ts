export type OpenAIModelCapability = 'TEXT' | 'VISION';

export interface OpenAITextRequest {
  instructions: string;
  input: string;
  requestId: string;
  jsonSchema?: OpenAIJsonSchema;
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
