import { BadGatewayException } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ConversationAIRequest } from './conversation-ai.contract';
import { ConversationAIService } from './conversation-ai.service';
import type { OpenAITextRequest } from './interfaces/openai.interface';
import type { OpenAIGateway } from './openai.gateway';

function request(
  overrides: Partial<ConversationAIRequest> = {},
): ConversationAIRequest {
  return {
    model: 'TEXT',
    instructions: 'Realize somente o conteúdo autorizado.',
    schema: {
      name: 'conversation_output',
      schema: {
        type: 'object',
        properties: { candidateText: { type: 'string' } },
        required: ['candidateText'],
        additionalProperties: false,
      },
    },
    payload: {
      facts: [{ key: 'facts.totalProtein', value: 30 }],
      structure: { depth: 'MINIMAL' },
    },
    maxOutputCharacters: 320,
    timeout: 1_000,
    ...overrides,
  };
}

function gateway(outputText = '{"candidateText":"Tudo certo."}') {
  const createTextResponse = jest.fn().mockResolvedValue({
    responseId: 'provider-response',
    model: 'configured-model',
    outputText,
    promptTokens: 10,
    completionTokens: 5,
    totalTokens: 15,
  });
  return {
    createTextResponse,
    service: new ConversationAIService({
      createTextResponse,
    } as unknown as OpenAIGateway),
  };
}

describe('ConversationAIService', () => {
  it('builds a structured Gateway request exclusively from the conversation request', async () => {
    const target = gateway();
    const result = await target.service.execute(request());
    const sent = target.createTextResponse.mock
      .calls[0][0] as OpenAITextRequest;

    expect(result).toEqual(
      expect.objectContaining({
        status: 'COMPLETED',
        structuredOutput: { candidateText: 'Tudo certo.' },
        finishReason: 'UNKNOWN',
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      }),
    );
    expect(sent.instructions).toBe('Realize somente o conteúdo autorizado.');
    expect(JSON.parse(sent.input)).toEqual({
      maxOutputCharacters: 320,
      payload: request().payload,
    });
    expect(sent.jsonSchema).toEqual(request().schema);
  });

  it('creates a deterministic internal requestId outside the model payload', async () => {
    const first = gateway();
    const second = gateway();
    await first.service.execute(request());
    await second.service.execute(request());
    const firstRequest = first.createTextResponse.mock.calls[0][0];
    const secondRequest = second.createTextResponse.mock.calls[0][0];

    expect(firstRequest.requestId).toMatch(/^conversation-[a-f0-9]{32}$/);
    expect(secondRequest.requestId).toBe(firstRequest.requestId);
    expect(firstRequest.input).not.toContain(firstRequest.requestId);
  });

  it('rejects operational identifiers before calling the Gateway', async () => {
    const target = gateway();
    const result = await target.service.execute(
      request({ payload: { userId: 'internal-user' } }),
    );

    expect(result).toEqual(
      expect.objectContaining({
        status: 'FAILED',
        errorCode: 'INVALID_SCHEMA',
      }),
    );
    expect(target.createTextResponse).not.toHaveBeenCalled();
  });

  it('classifies its independent timeout deterministically', async () => {
    jest.useFakeTimers();
    const createTextResponse = jest
      .fn()
      .mockReturnValue(new Promise(() => undefined));
    const service = new ConversationAIService({
      createTextResponse,
    } as unknown as OpenAIGateway);
    const pending = service.execute(request({ timeout: 50 }));
    await jest.advanceTimersByTimeAsync(50);

    await expect(pending).resolves.toEqual(
      expect.objectContaining({ status: 'FAILED', errorCode: 'TIMEOUT' }),
    );
    jest.useRealTimers();
  });

  it.each([
    [
      new BadGatewayException('OpenAI rejeitou a solicitação'),
      'PROVIDER_FAILURE',
    ],
    [
      new BadGatewayException('Resposta inválida da OpenAI'),
      'INVALID_RESPONSE',
    ],
    [
      new BadGatewayException('OpenAI não retornou conteúdo textual'),
      'EMPTY_RESPONSE',
    ],
    [new Error('unexpected'), 'UNKNOWN_FAILURE'],
  ])('classifies Gateway failure %p as %s', async (error, expected) => {
    const createTextResponse = jest.fn().mockRejectedValue(error);
    const service = new ConversationAIService({
      createTextResponse,
    } as unknown as OpenAIGateway);

    await expect(service.execute(request())).resolves.toEqual(
      expect.objectContaining({ status: 'FAILED', errorCode: expected }),
    );
  });

  it.each([
    ['empty output', '   ', 'EMPTY_RESPONSE'],
    ['invalid JSON', 'not-json', 'INVALID_RESPONSE'],
    ['non-object JSON', '[]', 'INVALID_RESPONSE'],
  ])('rejects %s', async (_label, output, expected) => {
    const target = gateway(output);
    await expect(target.service.execute(request())).resolves.toEqual(
      expect.objectContaining({ status: 'FAILED', errorCode: expected }),
    );
  });

  it.each([
    ['invalid schema name', { schema: { name: '', schema: {} } }],
    [
      'invalid JSON Schema shape',
      { schema: { name: 'invalid_shape', schema: {} } },
    ],
    ['invalid maximum length', { maxOutputCharacters: 0 }],
    ['timeout beyond Gateway boundary', { timeout: 30_000 }],
  ])('rejects %s without provider execution', async (_label, overrides) => {
    const target = gateway();
    const result = await target.service.execute(
      request(overrides as Partial<ConversationAIRequest>),
    );

    expect(result).toEqual(
      expect.objectContaining({
        status: 'FAILED',
        errorCode: 'INVALID_SCHEMA',
      }),
    );
    expect(target.createTextResponse).not.toHaveBeenCalled();
  });

  it('deep-freezes successful and failed responses', async () => {
    const success = await gateway().service.execute(request());
    const failed = await gateway().service.execute(
      request({ payload: { aiJobId: 'forbidden' } }),
    );
    const assertFrozen = (value: unknown): void => {
      if (typeof value !== 'object' || value === null) return;
      expect(Object.isFrozen(value)).toBe(true);
      Object.values(value).forEach(assertFrozen);
    };

    assertFrozen(success);
    assertFrozen(failed);
  });

  it('does not mutate the request', async () => {
    const source = request();
    const snapshot = JSON.stringify(source);
    await gateway().service.execute(source);
    expect(JSON.stringify(source)).toBe(snapshot);
  });

  it('remains generic and isolated from persistence and production response flow', () => {
    const source = readFileSync(
      join(__dirname, 'conversation-ai.service.ts'),
      'utf8',
    );
    const responseBuilder = readFileSync(
      join(__dirname, '../responses/response-builder.service.ts'),
      'utf8',
    );

    expect(source).not.toMatch(
      /PrismaService|AIJob|PromptVersion|PromptService|UsageService|Evolution|WhatsApp|ResponseBuilder|NutritionResponseFormatter|EventBus|Outbox|fetch\(|axios|Date\.now|Math\.random|console\.log/,
    );
    expect(responseBuilder).not.toContain('ConversationAIService');
  });
});
