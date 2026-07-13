import type { OpenAIJsonSchema } from './interfaces/openai.interface';

export type ConversationAIValue =
  | string
  | number
  | boolean
  | null
  | readonly ConversationAIValue[]
  | { readonly [key: string]: ConversationAIValue };

export interface ConversationAIRequest {
  readonly model: 'TEXT';
  readonly instructions: string;
  readonly schema: OpenAIJsonSchema;
  readonly payload: ConversationAIValue;
  readonly maxOutputCharacters: number;
  readonly timeout: number;
}

export type ConversationAIErrorCode =
  | 'TIMEOUT'
  | 'PROVIDER_FAILURE'
  | 'INVALID_RESPONSE'
  | 'INVALID_SCHEMA'
  | 'EMPTY_RESPONSE'
  | 'UNKNOWN_FAILURE';

export type ConversationAIFinishReason = 'UNKNOWN';

export interface ConversationAIUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
}

export interface ConversationAIProviderMetadata {
  readonly responseReference: string;
  readonly model: string;
}

export type ConversationAIResponse =
  | {
      readonly status: 'COMPLETED';
      readonly structuredOutput: ConversationAIValue;
      readonly rawText: string;
      readonly finishReason: ConversationAIFinishReason;
      readonly usage: ConversationAIUsage;
      readonly provider: ConversationAIProviderMetadata;
      readonly errorCode?: never;
    }
  | {
      readonly status: 'FAILED';
      readonly structuredOutput: null;
      readonly rawText: null;
      readonly finishReason: ConversationAIFinishReason;
      readonly usage: null;
      readonly provider: null;
      readonly errorCode: ConversationAIErrorCode;
    };
