import {
  BadGatewayException,
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import type {
  ConversationAIErrorCode,
  ConversationAIRequest,
  ConversationAIResponse,
  ConversationAIValue,
} from './conversation-ai.contract';
import { OpenAIGateway } from './openai.gateway';

const TIMEOUT_SIGNAL = Object.freeze({ code: 'CONVERSATION_AI_TIMEOUT' });
const FORBIDDEN_OPERATIONAL_KEYS = new Set([
  'userId',
  'mealAnalysisId',
  'recommendationId',
  'conversationId',
  'messageId',
  'providerId',
  'prismaId',
  'aiJobId',
  'promptVersionId',
  'blockId',
  'decisionId',
]);

@Injectable()
export class ConversationAIService {
  constructor(private readonly openAIGateway: OpenAIGateway) {}

  async execute(
    request: ConversationAIRequest,
  ): Promise<ConversationAIResponse> {
    const validationError = this.validateRequest(request);
    if (validationError) return this.failure(validationError);

    const requestId = this.requestId(request);
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    try {
      const providerRequest = this.openAIGateway.createTextResponse({
        instructions: request.instructions.trim(),
        input: this.canonicalStringify({
          payload: request.payload,
          maxOutputCharacters: request.maxOutputCharacters,
        }),
        requestId,
        jsonSchema: request.schema,
      });
      const timeout = new Promise<never>((_resolve, reject) => {
        timeoutHandle = setTimeout(
          () => reject(TIMEOUT_SIGNAL),
          request.timeout,
        );
      });
      const response = await Promise.race([providerRequest, timeout]);
      const rawText = response.outputText.trim();
      if (!rawText) return this.failure('EMPTY_RESPONSE');

      let structuredOutput: ConversationAIValue;
      try {
        structuredOutput = JSON.parse(rawText) as ConversationAIValue;
      } catch {
        return this.failure('INVALID_RESPONSE');
      }
      if (!this.isRecord(structuredOutput)) {
        return this.failure('INVALID_RESPONSE');
      }

      return Object.freeze({
        status: 'COMPLETED',
        structuredOutput: this.deepFreeze(structuredOutput),
        rawText,
        finishReason: 'UNKNOWN',
        usage: Object.freeze({
          promptTokens: response.promptTokens,
          completionTokens: response.completionTokens,
          totalTokens: response.totalTokens,
        }),
        provider: Object.freeze({
          responseReference: response.responseId,
          model: response.model,
        }),
      });
    } catch (error: unknown) {
      return this.failure(this.classifyError(error));
    } finally {
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
    }
  }

  private validateRequest(
    request: ConversationAIRequest,
  ): ConversationAIErrorCode | null {
    if (
      request.model !== 'TEXT' ||
      !request.instructions.trim() ||
      !Number.isInteger(request.maxOutputCharacters) ||
      request.maxOutputCharacters < 1 ||
      !Number.isInteger(request.timeout) ||
      request.timeout < 1 ||
      request.timeout >= 30_000
    ) {
      return 'INVALID_SCHEMA';
    }
    if (
      !request.schema.name.trim() ||
      !/^[A-Za-z0-9_-]{1,64}$/.test(request.schema.name) ||
      !this.isValidJsonSchema(request.schema.schema)
    ) {
      return 'INVALID_SCHEMA';
    }
    return this.hasOperationalKey(request.payload) ? 'INVALID_SCHEMA' : null;
  }

  private hasOperationalKey(value: ConversationAIValue): boolean {
    if (Array.isArray(value))
      return value.some((item) => this.hasOperationalKey(item));
    if (!this.isRecord(value)) return false;
    return Object.entries(value).some(
      ([key, item]) =>
        FORBIDDEN_OPERATIONAL_KEYS.has(key) ||
        key === 'metadata' ||
        /(?:Id|Ids)$/.test(key) ||
        this.hasOperationalKey(item as ConversationAIValue),
    );
  }

  private isValidJsonSchema(value: Record<string, unknown>): boolean {
    const properties = value.properties;
    const required = value.required;
    if (
      value.type !== 'object' ||
      !this.isRecord(properties) ||
      value.additionalProperties !== false ||
      !Array.isArray(required)
    ) {
      return false;
    }
    return required.every(
      (item) => typeof item === 'string' && item in properties,
    );
  }
  private requestId(request: ConversationAIRequest): string {
    const digest = createHash('sha256')
      .update(
        this.canonicalStringify({
          model: request.model,
          instructions: request.instructions.trim(),
          schema: request.schema as unknown as ConversationAIValue,
          payload: request.payload,
          maxOutputCharacters: request.maxOutputCharacters,
          timeout: request.timeout,
        }),
      )
      .digest('hex')
      .slice(0, 32);
    return `conversation-${digest}`;
  }

  private canonicalStringify(value: ConversationAIValue): string {
    if (Array.isArray(value)) {
      return `[${value.map((item) => this.canonicalStringify(item)).join(',')}]`;
    }
    if (this.isRecord(value)) {
      return `{${Object.keys(value)
        .sort()
        .map(
          (key) =>
            `${JSON.stringify(key)}:${this.canonicalStringify(
              value[key] as ConversationAIValue,
            )}`,
        )
        .join(',')}}`;
    }
    return JSON.stringify(value);
  }

  private classifyError(error: unknown): ConversationAIErrorCode {
    if (error === TIMEOUT_SIGNAL) return 'TIMEOUT';
    if (error instanceof BadRequestException) return 'INVALID_SCHEMA';
    if (error instanceof BadGatewayException) {
      const message = error.message.toLowerCase();
      if (message.includes('conteúdo textual')) return 'EMPTY_RESPONSE';
      if (message.includes('resposta inválida')) return 'INVALID_RESPONSE';
      return 'PROVIDER_FAILURE';
    }
    return 'UNKNOWN_FAILURE';
  }

  private failure(errorCode: ConversationAIErrorCode): ConversationAIResponse {
    return Object.freeze({
      status: 'FAILED',
      structuredOutput: null,
      rawText: null,
      finishReason: 'UNKNOWN',
      usage: null,
      provider: null,
      errorCode,
    });
  }

  private deepFreeze(value: ConversationAIValue): ConversationAIValue {
    if (Array.isArray(value)) {
      return Object.freeze(value.map((item) => this.deepFreeze(item)));
    }
    if (this.isRecord(value)) {
      return Object.freeze(
        Object.fromEntries(
          Object.entries(value).map(([key, item]) => [
            key,
            this.deepFreeze(item as ConversationAIValue),
          ]),
        ),
      );
    }
    return value;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
