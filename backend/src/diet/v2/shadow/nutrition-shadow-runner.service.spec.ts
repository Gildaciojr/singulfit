import {
  NutritionShadowErrorCategory,
  NutritionShadowOutputKind,
  NutritionShadowRunStatus,
} from '@prisma/client';
import type { OpenAIGateway } from '../../../ai/openai.gateway';
import type { PromptService } from '../../../ai/prompt.service';
import type { GenerateNutritionPlanV2InputBuilder } from '../generate-nutrition-plan-v2-input.builder';
import {
  NutritionGenerationRunError,
  type NutritionGenerationRunResultV2,
} from '../nutrition-generation-runner-v2.contract';
import type { NutritionGenerationRunnerV2Service } from '../nutrition-generation-runner-v2.service';
import type { NutritionShadowExecutionInput } from './nutrition-shadow.contract';
import type { NutritionShadowActivePlanPort } from './nutrition-shadow-active-plan.port';
import type { NutritionShadowRepository } from './nutrition-shadow.repository';
import { NutritionShadowRunnerService } from './nutrition-shadow-runner.service';

const source = {
  userId: 'user-id',
  decision: {},
  snapshot: {},
  referenceDate: new Date('2026-07-29T12:00:00.000Z'),
} as NutritionShadowExecutionInput['source'];
const input: NutritionShadowExecutionInput = {
  source,
  correlationId: 'correlation-id',
  traceId: 'trace-id',
  conversationId: 'conversation-id',
  messageId: 'message-id',
};
const runRecord = {
  id: 'shadow-run-id',
  operationKey: 'shadow-key',
  inputFingerprint: 'fingerprint',
  conversationGoal: 'GENERAL_GUIDANCE' as const,
  status: NutritionShadowRunStatus.RUNNING,
  artifactType: null,
  kind: null,
  documentHash: null,
  totalDurationMs: null,
  errorCategory: null,
};

function runResult(kind: 'PLAN' | 'CONVERSATIONAL_ARTIFACT') {
  const output =
    kind === 'PLAN'
      ? {
          kind: 'PLAN' as const,
          artifactType: 'WEEKLY_PLAN' as const,
          plan: { title: 'Plano semanal' },
        }
      : {
          kind: 'CONVERSATIONAL_ARTIFACT' as const,
          artifactType: 'POINT_GUIDANCE' as const,
          artifact: { title: 'Orientação' },
        };
  return {
    output,
    response: {
      responseId: 'response-id',
      model: 'model',
      outputText: '{}',
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
    },
    providerMetadata: {
      provider: 'OPENAI',
      model: 'model',
      responseId: 'response-id',
      promptVersionId: 'prompt-version-id',
    },
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    accounting: { estimatedCostUsd: '0.00000100', currency: 'USD' },
    attempts: 1,
    timings: {
      providerMs: 10,
      parsingMs: 2,
      validationMs: 3,
      generationMs: 15,
    },
  } as unknown as NutritionGenerationRunResultV2;
}

function setup(kind: 'PLAN' | 'CONVERSATIONAL_ARTIFACT' = 'PLAN') {
  const builder = { build: jest.fn().mockReturnValue(source) };
  const generation = {
    prepare: jest.fn().mockReturnValue({
      resolution: {
        artifactType: kind === 'PLAN' ? 'WEEKLY_PLAN' : 'POINT_GUIDANCE',
      },
    }),
    describe: jest.fn().mockReturnValue({
      artifactType: kind === 'PLAN' ? 'WEEKLY_PLAN' : 'POINT_GUIDANCE',
      promptName: 'nutrition-v2',
      promptVersion: 1,
      schema: { name: 'nutrition', schema: {} },
      canonicalPayload: '{}',
      operationKey: 'production-key',
    }),
    run: jest.fn().mockResolvedValue(runResult(kind)),
    canonicalJson: jest.fn((value) => JSON.stringify(value)),
  };
  const prompt = {
    getActive: jest.fn().mockResolvedValue({
      id: 'prompt-version-id',
      prompt: 'official prompt',
    }),
  };
  const gateway = { createTextResponse: jest.fn() };
  const repository = {
    start: jest.fn().mockResolvedValue({ run: runRecord, reused: false }),
    succeed: jest.fn().mockImplementation((_id, completion) =>
      Promise.resolve({
        ...runRecord,
        status: NutritionShadowRunStatus.SUCCEEDED,
        artifactType: completion.artifactType,
        kind: completion.kind,
        documentHash: completion.documentHash,
        totalDurationMs: completion.totalDurationMs,
      }),
    ),
    fail: jest.fn().mockImplementation((_id, failure) =>
      Promise.resolve({
        ...runRecord,
        status: NutritionShadowRunStatus.FAILED,
        errorCategory: failure.category,
      }),
    ),
  };
  const active = { find: jest.fn().mockResolvedValue(null) };
  return {
    builder,
    generation,
    prompt,
    gateway,
    repository,
    active,
    service: new NutritionShadowRunnerService(
      builder as unknown as GenerateNutritionPlanV2InputBuilder,
      generation as unknown as NutritionGenerationRunnerV2Service,
      prompt as unknown as PromptService,
      gateway as unknown as OpenAIGateway,
      repository as unknown as NutritionShadowRepository,
      active as unknown as NutritionShadowActivePlanPort,
    ),
  };
}

describe('NutritionShadowRunnerService', () => {
  it.each(['PLAN', 'CONVERSATIONAL_ARTIFACT'] as const)(
    'stores %s only through the Shadow repository',
    async (kind) => {
      const test = setup(kind);
      await expect(test.service.execute(input)).resolves.toMatchObject({
        status: 'SUCCEEDED',
        shadowRunId: 'shadow-run-id',
        kind: NutritionShadowOutputKind[kind],
      });
      expect(test.repository.succeed).toHaveBeenCalledWith(
        'shadow-run-id',
        expect.objectContaining({
          document: expect.objectContaining({ kind }),
          documentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
          promptTokens: 10,
          totalTokens: 15,
        }),
      );
    },
  );

  it.each(['POINT_GUIDANCE', 'MEAL_SUGGESTION', 'PLAN_REVIEW'] as const)(
    'stores %s as a Shadow conversational document only',
    async (artifactType) => {
      const test = setup('CONVERSATIONAL_ARTIFACT');
      const result = runResult('CONVERSATIONAL_ARTIFACT');
      test.generation.run.mockResolvedValue({
        ...result,
        output: {
          kind: 'CONVERSATIONAL_ARTIFACT',
          artifactType,
          artifact: { title: artifactType },
        },
      });
      await expect(test.service.execute(input)).resolves.toMatchObject({
        status: 'SUCCEEDED',
        artifactType,
      });
      expect(test.repository.succeed).toHaveBeenCalledWith(
        'shadow-run-id',
        expect.objectContaining({
          document: expect.objectContaining({ artifactType }),
        }),
      );
    },
  );

  it('resolves presentation without provider or official AIJob', async () => {
    const test = setup();
    test.generation.prepare.mockReturnValue({
      resolution: { artifactType: 'CURRENT_PLAN_PRESENTATION' },
    });
    test.active.find.mockResolvedValue({
      id: 'active-plan-id',
      artifactType: 'WEEKLY_PLAN',
      generatedAt: new Date('2026-07-28T12:00:00.000Z'),
    });
    await expect(test.service.execute(input)).resolves.toMatchObject({
      status: 'SUCCEEDED',
      kind: NutritionShadowOutputKind.CURRENT_PLAN_PRESENTATION,
    });
    expect(test.prompt.getActive).not.toHaveBeenCalled();
    expect(test.gateway.createTextResponse).not.toHaveBeenCalled();
    expect(test.repository.succeed).toHaveBeenCalledWith(
      'shadow-run-id',
      expect.objectContaining({
        activePlanReference: 'active-plan-id',
        totalTokens: 0,
      }),
    );
  });

  it('reuses a completed idempotent run without generation', async () => {
    const test = setup();
    test.repository.start.mockResolvedValue({
      reused: true,
      run: {
        ...runRecord,
        status: NutritionShadowRunStatus.SUCCEEDED,
        artifactType: 'WEEKLY_PLAN',
        kind: NutritionShadowOutputKind.PLAN,
        documentHash: 'hash',
        totalDurationMs: 20,
      },
    });
    await expect(test.service.execute(input)).resolves.toMatchObject({
      status: 'SUCCEEDED',
      reused: true,
    });
    expect(test.builder.build).not.toHaveBeenCalled();
  });

  it.each([
    ['PARSER', NutritionShadowErrorCategory.PARSER_ERROR],
    ['VALIDATION', NutritionShadowErrorCategory.VALIDATION_ERROR],
    ['PROVIDER', NutritionShadowErrorCategory.PROVIDER_ERROR],
  ] as const)('persists %s failures as %s', async (stage, category) => {
    const test = setup();
    test.generation.run.mockRejectedValue(
      new NutritionGenerationRunError(stage, new Error('safe failure')),
    );
    await expect(test.service.execute(input)).resolves.toMatchObject({
      status: 'FAILED',
      errorCategory: category,
    });
    expect(test.repository.fail).toHaveBeenCalledWith(
      'shadow-run-id',
      expect.objectContaining({ category, message: 'safe failure' }),
    );
  });

  it.each([
    [
      'builder',
      NutritionShadowErrorCategory.BUILDER_ERROR,
      (test: ReturnType<typeof setup>) =>
        test.builder.build.mockImplementation(() => {
          throw new Error('builder failed');
        }),
    ],
    [
      'strategy',
      NutritionShadowErrorCategory.STRATEGY_ERROR,
      (test: ReturnType<typeof setup>) =>
        test.generation.prepare.mockImplementation(() => {
          throw new Error('strategy failed');
        }),
    ],
    [
      'active plan resolution',
      NutritionShadowErrorCategory.ACTIVE_PLAN_RESOLUTION_ERROR,
      (test: ReturnType<typeof setup>) => {
        test.generation.prepare.mockReturnValue({
          resolution: { artifactType: 'CURRENT_PLAN_PRESENTATION' },
        });
        test.active.find.mockRejectedValue(new Error('resolution failed'));
      },
    ],
    [
      'Shadow persistence',
      NutritionShadowErrorCategory.SHADOW_PERSISTENCE_ERROR,
      (test: ReturnType<typeof setup>) =>
        test.repository.succeed.mockRejectedValue(new Error('write failed')),
    ],
  ] as const)('classifies %s failures', async (_label, category, arrange) => {
    const test = setup();
    arrange(test);
    await expect(test.service.execute(input)).resolves.toMatchObject({
      status: 'FAILED',
      errorCategory: category,
    });
  });

  it('isolates Shadow storage failures in executeSafely', async () => {
    const test = setup();
    test.repository.start.mockRejectedValue(new Error('storage unavailable'));
    await expect(test.service.executeSafely(input)).resolves.toMatchObject({
      status: 'SKIPPED',
      reason: 'SHADOW_STORAGE_UNAVAILABLE',
    });
  });
});
