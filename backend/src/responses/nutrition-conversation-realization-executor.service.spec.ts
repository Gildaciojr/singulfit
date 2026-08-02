import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { AIJobStatus, AIJobType, Prisma } from '@prisma/client';
import type { AIUsageService } from '../ai/ai-usage.service';
import type { PromptService } from '../ai/prompt.service';
import type { PrismaService } from '../prisma/prisma.service';
import type {
  LanguageRealizationOperationalMetadata,
  LanguageRealizationResult,
} from './conversation-language-realization.contract';
import type {
  NutritionConversationLanguageRealizer,
  NutritionConversationLanguageRealizerExecution,
} from './nutrition-conversation-language-realizer';
import { NutritionConversationRealizationExecutorService } from './nutrition-conversation-realization-executor.service';
import { NUTRITION_CONVERSATION_REALIZATION_PROMPT } from './nutrition-conversation-realization-prompt.definition';
import type { SanitizedConversationPayload } from './sanitized-conversation-payload.contract';
import type { ConversationReasoningEvidence } from './reasoning-bridge/conversation-reasoning-bridge.contract';

const payload = Object.freeze({
  facts: Object.freeze({
    allowed: Object.freeze([]),
    sensitive: Object.freeze([]),
    disclaimerRequired: Object.freeze([]),
  }),
  selectedDecisions: Object.freeze([]),
  structure: Object.freeze({
    dialogueProfile: 'BRIEF_ACKNOWLEDGEMENT',
    centralIntent: 'ACKNOWLEDGE',
    blocks: Object.freeze([]),
    depth: 'BRIEF',
    density: 'LOW',
    rhythm: 'DIRECT',
    presentation: 'PROSE',
    paragraphCount: 1,
  }),
  style: Object.freeze({}),
  limits: Object.freeze({
    maximumLength: 300,
    maximumEmojiCount: 0,
    maximumQuestions: 0,
    maximumActions: 0,
    maximumFacts: 4,
    maximumBlocks: 3,
    maximumParagraphs: 2,
  }),
  policies: Object.freeze({
    estimateQualificationRequired: false,
    emojiAllowed: false,
    closingRequirement: 'OPTIONAL',
  }),
}) as unknown as SanitizedConversationPayload;

const input = Object.freeze({
  userId: 'user-id',
  conversationId: 'conversation-id',
  messageId: 'message-id',
  payload,
});

const reasoningEvidence: ConversationReasoningEvidence = Object.freeze({
  summary: Object.freeze({
    goal: 'criar um plano alimentar',
    decision: 'apoiar recuperação',
    expectedBenefit: 'favorecer continuidade',
  }),
  priorities: Object.freeze([]),
  strategies: Object.freeze([]),
  restrictions: Object.freeze([]),
  tradeoffs: Object.freeze([]),
  explanations: Object.freeze([]),
  teachingOpportunities: Object.freeze([]),
  suggestedQuestions: Object.freeze([]),
  safety: Object.freeze({
    requiresCaution: false,
    professionalGuidanceRecommended: false,
    guidance: Object.freeze([]),
  }),
  longitudinal: Object.freeze({
    continuity: null,
    progress: null,
    adherence: null,
    repetitionRisk: false,
  }),
});

function job(
  status: AIJobStatus = AIJobStatus.PROCESSING,
  overrides: Record<string, unknown> = {},
) {
  return {
    id: 'conversation-job-id',
    userId: input.userId,
    conversationId: input.conversationId,
    messageId: input.messageId,
    type: AIJobType.CONVERSATION_REALIZATION,
    status,
    promptVersionId: 'prompt-version-id',
    providerResponseId: null,
    operationKey: 'conversation-realization:existing',
    attempts: 1,
    startedAt: new Date('2026-07-15T12:00:00.000Z'),
    leaseExpiresAt: new Date('2026-07-15T12:02:00.000Z'),
    result: null,
    completedAt: null,
    failedAt: null,
    error: null,
    createdAt: new Date('2026-07-15T12:00:00.000Z'),
    updatedAt: new Date('2026-07-15T12:00:00.000Z'),
    usage: [],
    ...overrides,
  };
}

function realization(
  execution: NutritionConversationLanguageRealizerExecution,
  overrides: Partial<LanguageRealizationResult> = {},
): LanguageRealizationResult {
  const operationalMetadata: LanguageRealizationOperationalMetadata = {
    aiJobId: execution.operation?.aiJobId ?? 'missing-job',
    promptVersionId:
      execution.operation?.promptVersionId ?? 'missing-prompt-version',
    providerResponseId: 'provider-response-id',
    model: 'gpt-test',
    usage: {
      inputTokens: 100,
      outputTokens: 40,
      totalTokens: 140,
      estimatedCostUsd: null,
    },
    executionStatus: 'PROCESSING',
  };
  return {
    id: 'language-realization:reference',
    sanitizedPayloadReference: 'sanitized-payload:reference',
    status: 'COMPLETED',
    candidateText: 'Candidata validada.',
    candidateTextSource: 'VALIDATED_UNITS',
    realizedUnits: [],
    omittedUnits: [],
    realizedFacts: [],
    omittedFacts: [],
    realizedDecisions: [],
    omittedDecisions: [],
    disclaimerRealized: false,
    questionRealized: false,
    closingRealized: false,
    producedLength: 19,
    producedQuestionCount: 0,
    warningCodes: [],
    operationalMetadata,
    ...overrides,
  } as LanguageRealizationResult;
}

function subject() {
  const promptVersion = {
    id: 'prompt-version-id',
    name: NUTRITION_CONVERSATION_REALIZATION_PROMPT.name,
    version: 1,
    prompt: NUTRITION_CONVERSATION_REALIZATION_PROMPT.instructions,
    capability: NUTRITION_CONVERSATION_REALIZATION_PROMPT.capability,
    model: NUTRITION_CONVERSATION_REALIZATION_PROMPT.model,
    jsonSchema:
      NUTRITION_CONVERSATION_REALIZATION_PROMPT.schema as Prisma.InputJsonValue,
    isActive: true,
    createdAt: new Date('2026-07-15T12:00:00.000Z'),
  };
  const getActive = jest.fn().mockResolvedValue(promptVersion);
  const findUnique = jest
    .fn()
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(null);
  const create = jest.fn().mockImplementation(({ data }) =>
    Promise.resolve(
      job(AIJobStatus.PENDING, {
        ...data,
        operationKey: data.operationKey,
        attempts: 0,
        startedAt: null,
        leaseExpiresAt: null,
      }),
    ),
  );
  const update = jest.fn().mockImplementation(({ data }) =>
    Promise.resolve(
      job(AIJobStatus.PROCESSING, {
        attempts: 2,
        ...data,
      }),
    ),
  );
  const transactionUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
  const transaction = {
    $queryRaw: jest.fn().mockResolvedValue([{ locked: true }]),
    message: {
      findUnique: jest.fn().mockResolvedValue({
        conversationId: input.conversationId,
        conversation: { userId: input.userId },
      }),
    },
    aIJob: {
      findUnique,
      create,
      update,
      updateMany: transactionUpdateMany,
    },
  };
  const failUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
  const prisma = {
    $transaction: jest.fn(
      <Result>(callback: (client: typeof transaction) => Result): Result =>
        callback(transaction),
    ),
    aIJob: { updateMany: failUpdateMany },
  };
  const usage = {
    estimatedCost: new Prisma.Decimal('0.00012345'),
  };
  const recordInTransaction = jest.fn().mockResolvedValue(usage);
  const realize = jest
    .fn()
    .mockImplementation(
      (
        _payload: SanitizedConversationPayload,
        execution: NutritionConversationLanguageRealizerExecution,
      ) => Promise.resolve(realization(execution)),
    );
  const config = { get: jest.fn().mockReturnValue('120') };
  const service = new NutritionConversationRealizationExecutorService(
    prisma as unknown as PrismaService,
    { getActive } as unknown as PromptService,
    { recordInTransaction } as unknown as AIUsageService,
    { realize } as unknown as NutritionConversationLanguageRealizer,
    config as unknown as ConfigService,
  );

  return {
    service,
    promptVersion,
    getActive,
    findUnique,
    create,
    update,
    transactionUpdateMany,
    transaction,
    failUpdateMany,
    recordInTransaction,
    realize,
  };
}

function assertDeepFrozen(value: unknown): void {
  if (typeof value !== 'object' || value === null) return;
  expect(Object.isFrozen(value)).toBe(true);
  Object.values(value).forEach(assertDeepFrozen);
}

describe('NutritionConversationRealizationExecutorService', () => {
  it('creates, executes, accounts and completes the dedicated job once', async () => {
    const target = subject();
    const result = await target.service.execute(input);

    expect(target.getActive).toHaveBeenCalledWith(
      NUTRITION_CONVERSATION_REALIZATION_PROMPT.name,
    );
    expect(target.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: input.userId,
        conversationId: input.conversationId,
        messageId: input.messageId,
        type: AIJobType.CONVERSATION_REALIZATION,
        promptVersionId: target.promptVersion.id,
        operationKey: expect.stringMatching(
          /^conversation-realization:[a-f0-9]{64}$/,
        ),
      }),
      include: { usage: true },
    });
    expect(target.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'conversation-job-id' },
        data: expect.objectContaining({
          status: AIJobStatus.PROCESSING,
          attempts: { increment: 1 },
        }),
      }),
    );
    expect(target.realize).toHaveBeenCalledTimes(1);
    expect(target.realize).toHaveBeenCalledWith(
      payload,
      expect.objectContaining({
        prompt: expect.objectContaining({
          model: 'TEXT',
          instructions: target.promptVersion.prompt,
          schema: target.promptVersion.jsonSchema,
        }),
        operation: {
          aiJobId: 'conversation-job-id',
          promptVersionId: target.promptVersion.id,
        },
      }),
    );
    expect(target.recordInTransaction).toHaveBeenCalledTimes(1);
    expect(target.recordInTransaction).toHaveBeenCalledWith(
      target.transaction,
      {
        userId: input.userId,
        aiJobId: 'conversation-job-id',
        jobType: AIJobType.CONVERSATION_REALIZATION,
        model: 'gpt-test',
        promptTokens: 100,
        completionTokens: 40,
        totalTokens: 140,
      },
    );
    expect(target.transactionUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: AIJobStatus.COMPLETED,
          providerResponseId: 'provider-response-id',
          result: expect.objectContaining({
            candidateText: 'Candidata validada.',
          }),
        }),
      }),
    );
    expect(result.operationalMetadata).toEqual(
      expect.objectContaining({
        aiJobId: 'conversation-job-id',
        promptVersionId: target.promptVersion.id,
        providerResponseId: 'provider-response-id',
        model: 'gpt-test',
        executionStatus: 'COMPLETED',
        usage: expect.objectContaining({
          estimatedCostUsd: '0.00012345',
        }),
      }),
    );
    assertDeepFrozen(result.operationalMetadata);
  });

  it('builds the same operationKey for the same operation and changes it for a new prompt version', async () => {
    const first = subject();
    const second = subject();
    const nextVersion = subject();
    nextVersion.promptVersion.id = 'prompt-version-v2';
    nextVersion.promptVersion.version = 2;

    await first.service.execute(input);
    await second.service.execute(input);
    await nextVersion.service.execute(input);

    const firstKey = first.create.mock.calls[0][0].data.operationKey;
    const secondKey = second.create.mock.calls[0][0].data.operationKey;
    const nextVersionKey =
      nextVersion.create.mock.calls[0][0].data.operationKey;
    expect(firstKey).toBe(secondKey);
    expect(nextVersionKey).not.toBe(firstKey);
  });

  it('includes semantic reasoning in realization and idempotency only when supplied', async () => {
    const legacy = subject();
    const enriched = subject();

    await legacy.service.execute(input);
    await enriched.service.execute({ ...input, reasoningEvidence });

    const legacyKey = legacy.create.mock.calls[0][0].data.operationKey;
    const enrichedKey = enriched.create.mock.calls[0][0].data.operationKey;
    expect(enrichedKey).not.toBe(legacyKey);
    expect(enriched.realize).toHaveBeenCalledWith(
      payload,
      expect.objectContaining({
        operation: {
          aiJobId: 'conversation-job-id',
          promptVersionId: enriched.promptVersion.id,
        },
      }),
      reasoningEvidence,
    );
    expect(legacy.realize).toHaveBeenCalledWith(
      payload,
      expect.objectContaining({
        operation: expect.objectContaining({}),
      }),
    );
  });

  it('claims an existing PENDING job before executing it', async () => {
    const target = subject();
    target.findUnique
      .mockReset()
      .mockResolvedValueOnce(job(AIJobStatus.PENDING));

    await target.service.execute(input);

    expect(target.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'conversation-job-id' },
        data: expect.objectContaining({
          status: AIJobStatus.PROCESSING,
          attempts: { increment: 1 },
        }),
      }),
    );
    expect(target.realize).toHaveBeenCalledTimes(1);
  });

  it.each([
    [AIJobStatus.PROCESSING, 'IN_PROGRESS', 'JOB_PROCESSING'],
    [AIJobStatus.FAILED, 'TERMINAL_FAILURE', 'JOB_ALREADY_FAILED'],
  ] as const)(
    'does not call the provider again for an existing %s job',
    async (status, executionStatus, failureCode) => {
      const target = subject();
      target.findUnique.mockReset().mockResolvedValueOnce(job(status));

      const result = await target.service.execute(input);

      expect(target.realize).not.toHaveBeenCalled();
      expect(target.recordInTransaction).not.toHaveBeenCalled();
      expect(result.status).toBe('FAILED');
      expect(result.failureCode).toBe(failureCode);
      expect(result.operationalMetadata?.executionStatus).toBe(executionStatus);
    },
  );

  it('reuses the stored COMPLETED realization without provider, usage or cost duplication', async () => {
    const target = subject();
    const stored = realization({
      prompt: NUTRITION_CONVERSATION_REALIZATION_PROMPT,
      operation: {
        aiJobId: 'conversation-job-id',
        promptVersionId: 'prompt-version-id',
      },
    });
    target.findUnique.mockReset().mockResolvedValueOnce(
      job(AIJobStatus.COMPLETED, {
        result: stored as unknown as Prisma.JsonValue,
        providerResponseId: 'provider-response-id',
        completedAt: new Date('2026-07-15T12:01:00.000Z'),
        leaseExpiresAt: null,
        usage: [
          {
            model: 'gpt-test',
            promptTokens: 100,
            completionTokens: 40,
            totalTokens: 140,
            estimatedCost: new Prisma.Decimal('0.00012345'),
          },
        ],
      }),
    );

    const result = await target.service.execute(input);

    expect(target.realize).not.toHaveBeenCalled();
    expect(target.recordInTransaction).not.toHaveBeenCalled();
    expect(result.status).toBe('COMPLETED');
    expect(result.candidateText).toBe('Candidata validada.');
    expect(result.operationalMetadata).toEqual(
      expect.objectContaining({
        executionStatus: 'REUSED_COMPLETED',
        providerResponseId: 'provider-response-id',
        usage: expect.objectContaining({
          estimatedCostUsd: '0.00012345',
        }),
      }),
    );
    assertDeepFrozen(result);
  });

  it('does not call the provider when a legacy COMPLETED row lacks a stored result', async () => {
    const target = subject();
    target.findUnique
      .mockReset()
      .mockResolvedValueOnce(job(AIJobStatus.COMPLETED));

    const result = await target.service.execute(input);

    expect(target.realize).not.toHaveBeenCalled();
    expect(result.status).toBe('FAILED');
    expect(result.failureCode).toBe('JOB_ALREADY_COMPLETED');
  });

  it('rejects a different payload reference for the same message and prompt without a new call', async () => {
    const target = subject();
    target.findUnique
      .mockReset()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(job(AIJobStatus.COMPLETED));

    const result = await target.service.execute(input);

    expect(target.create).not.toHaveBeenCalled();
    expect(target.realize).not.toHaveBeenCalled();
    expect(result.failureCode).toBe('PAYLOAD_REFERENCE_CONFLICT');
    expect(result.operationalMetadata?.executionStatus).toBe(
      'PAYLOAD_CONFLICT',
    );
  });

  it.each([
    ['TIMED_OUT', 'TIMEOUT'],
    ['FALLBACK', 'PROVIDER_FAILURE'],
    ['EMPTY', 'EMPTY_RESPONSE'],
  ] as const)(
    'fails %s safely without fabricating provider usage',
    async (status, failureCode) => {
      const target = subject();
      target.realize.mockImplementation(
        (
          _payload: SanitizedConversationPayload,
          execution: NutritionConversationLanguageRealizerExecution,
        ) =>
          Promise.resolve(
            realization(execution, {
              status,
              candidateText: null,
              failureCode,
              operationalMetadata: {
                aiJobId: execution.operation?.aiJobId ?? 'missing-job',
                promptVersionId:
                  execution.operation?.promptVersionId ?? 'missing-prompt',
                providerResponseId: null,
                model: null,
                usage: null,
                executionStatus: 'PROCESSING',
              },
            } as Partial<LanguageRealizationResult>),
          ),
      );

      const result = await target.service.execute(input);

      expect(target.recordInTransaction).not.toHaveBeenCalled();
      expect(target.transactionUpdateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: AIJobStatus.FAILED }),
        }),
      );
      expect(result.operationalMetadata?.executionStatus).toBe('FAILED');
    },
  );

  it('accounts provider usage once when local schema validation rejects the candidate', async () => {
    const target = subject();
    target.realize.mockImplementation(
      (
        _payload: SanitizedConversationPayload,
        execution: NutritionConversationLanguageRealizerExecution,
      ) =>
        Promise.resolve(
          realization(execution, {
            status: 'INVALID_STRUCTURE',
            candidateText: null,
            fallbackReason: 'INVALID_STRUCTURE',
            failureCode: 'INVALID_LANGUAGE_UNIT_SCHEMA',
          } as Partial<LanguageRealizationResult>),
        ),
    );

    const result = await target.service.execute(input);

    expect(target.recordInTransaction).toHaveBeenCalledTimes(1);
    expect(target.transactionUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: AIJobStatus.FAILED }),
      }),
    );
    expect(result.operationalMetadata?.executionStatus).toBe('FAILED');
  });

  it('isolates realizer and accounting failures and terminally fails the job', async () => {
    const realizerFailure = subject();
    realizerFailure.realize.mockRejectedValue(new Error('provider detail'));
    const realizerResult = await realizerFailure.service.execute(input);
    expect(realizerResult.failureCode).toBe('CONVERSATION_REALIZATION_FAILED');
    expect(realizerFailure.failUpdateMany).toHaveBeenCalledTimes(1);

    const accountingFailure = subject();
    accountingFailure.recordInTransaction.mockRejectedValue(
      new Error('database detail'),
    );
    const accountingResult = await accountingFailure.service.execute(input);
    expect(accountingResult.operationalMetadata?.executionStatus).toBe(
      'FAILED',
    );
    expect(accountingFailure.failUpdateMany).toHaveBeenCalledTimes(1);
  });

  it('keeps operational metadata outside both payload and candidateText', async () => {
    const target = subject();
    const result = await target.service.execute(input);
    const sentPayload = target.realize.mock.calls[0][0];

    expect(JSON.stringify(sentPayload)).not.toMatch(
      /user-id|conversation-id|message-id|conversation-job-id|prompt-version-id|provider-response-id/,
    );
    expect(result.candidateText).toBe('Candidata validada.');
    expect(result.candidateText).not.toMatch(
      /conversation-job-id|prompt-version-id|provider-response-id|gpt-test/,
    );
    expect(result.operationalMetadata).toBeDefined();
  });

  it('validates the operational context before creating a job', async () => {
    const target = subject();
    target.transaction.message.findUnique.mockResolvedValue(null);

    await expect(target.service.execute(input)).rejects.toThrow(
      'Mensagem, conversa e usuário não correspondem',
    );
    expect(target.create).not.toHaveBeenCalled();
    expect(target.realize).not.toHaveBeenCalled();
  });

  it('contains no outbound, event, worker or direct provider dependency', () => {
    const source = readFileSync(
      join(__dirname, 'nutrition-conversation-realization-executor.service.ts'),
      'utf8',
    );
    expect(source).not.toMatch(
      /OutboundMessage|EventBus|Outbox|Evolution|MediaService|Worker|OpenAIGateway|fetch\(|axios|candidateText.*(?:log|error)/,
    );
    expect(source).not.toMatch(/TODO|FIXME|console\.log|Math\.random/);
  });

  it('declares only the required enum, PromptVersion and reusable-result migration changes', () => {
    const migration = readFileSync(
      join(
        __dirname,
        '../../prisma/migrations/20260715120000_conversation_realization_execution/migration.sql',
      ),
      'utf8',
    );
    expect(migration).toContain(
      `ALTER TYPE "AIJobType" ADD VALUE IF NOT EXISTS 'CONVERSATION_REALIZATION'`,
    );
    expect(migration).toContain('ALTER TABLE "prompt_versions"');
    expect(migration).toContain("'nutrition_conversation_realization'");
    expect(migration).toContain('"jsonSchema" JSONB');
    expect(migration).toContain('ALTER TABLE "ai_jobs"');
    expect(migration).toContain('ADD COLUMN "result" JSONB');
    expect(migration).not.toMatch(
      /ALTER TABLE "(?:ai_usage|messages|conversations|outbound_messages)"/,
    );
  });
});
