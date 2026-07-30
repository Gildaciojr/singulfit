import { ConflictException } from '@nestjs/common';
import type { NutritionPlanningEngineV2Service } from '../nutrition-planning-engine-v2.service';
import type { NutritionConversationalArtifactV1 } from '../nutrition-conversational-artifact.contract';
import type { NutritionPlanV2 } from '../nutrition-plan-v2.contract';
import type { NutritionPlanV2PersistenceService } from '../persistence/nutrition-plan-v2-persistence.service';
import type { NutritionConversationalArtifactPersistenceService } from '../conversational-persistence/nutrition-conversational-artifact-persistence.service';
import type { NutritionPlanningGenerationResult } from '../nutrition-planning-generation.contract';
import { NutritionApplicationExecutorService } from './nutrition-application-executor.service';
import type { NutritionApplicationExecutionInputV2 } from './nutrition-application-execution.contract';

const input: NutritionApplicationExecutionInputV2 = {
  generationInput: {
    userId: 'user-id',
    decision:
      {} as NutritionApplicationExecutionInputV2['generationInput']['decision'],
    snapshot:
      {} as NutritionApplicationExecutionInputV2['generationInput']['snapshot'],
    referenceDate: new Date('2026-07-29T12:00:00.000Z'),
  },
  ownership: { userId: 'user-id', profileId: 'profile-id' },
  correlationId: 'correlation-id',
  traceId: 'trace-id',
};
const base = {
  status: 'PENDING_COMPLETION',
  aiJobId: 'job-id',
  operationKey: 'operation-key',
  storedResult: { candidateOutput: '{}', model: 'model' },
  reused: false,
  completion: {},
} as const;

const planDocument = Object.freeze({
  artifactType: 'WEEKLY_PLAN',
  title: 'Plano semanal',
}) as NutritionPlanV2;

const conversationalDocument = Object.freeze({
  schemaVersion: '1.0',
  artifactType: 'POINT_GUIDANCE',
  title: 'Orientação',
  summary: 'Resumo',
  generatedAt: '2026-07-29T12:00:00.000Z',
  guidance: Object.freeze({
    answer: 'Resposta',
    rationale: Object.freeze([]),
    actionableSteps: Object.freeze([]),
    cautions: Object.freeze([]),
  }),
}) satisfies NutritionConversationalArtifactV1;

function setup(generation: NutritionPlanningGenerationResult) {
  const engine = { generate: jest.fn().mockResolvedValue(generation) };
  const plan = {
    persist: jest.fn().mockResolvedValue({
      persistence: 'CREATED',
      aggregate: { id: 'plan-id', document: planDocument },
      aiJobCompleted: true,
    }),
  };
  const conversational = {
    persist: jest.fn().mockResolvedValue({
      persistence: 'CREATED',
      aggregate: { id: 'artifact-id', document: conversationalDocument },
      aiJobCompleted: true,
    }),
  };
  return {
    engine,
    plan,
    conversational,
    service: new NutritionApplicationExecutorService(
      engine as unknown as NutritionPlanningEngineV2Service,
      plan as unknown as NutritionPlanV2PersistenceService,
      conversational as unknown as NutritionConversationalArtifactPersistenceService,
    ),
  };
}
describe('NutritionApplicationExecutorService', () => {
  it('delegates PLAN without interpreting the document', async () => {
    const generation = {
      ...base,
      output: {
        kind: 'PLAN',
        artifactType: 'WEEKLY_PLAN',
        plan: planDocument,
      },
    } as unknown as NutritionPlanningGenerationResult;
    const test = setup(generation);
    await expect(test.service.execute(input)).resolves.toEqual({
      kind: 'PLAN',
      aggregateId: 'plan-id',
      artifactType: 'WEEKLY_PLAN',
      document: planDocument,
      aiJobCompleted: true,
      requiresFormatting: true,
      requiresPersistence: true,
    });
    expect(test.plan.persist).toHaveBeenCalledWith({
      generation,
      ownership: input.ownership,
      executionContext: {
        correlationId: input.correlationId,
        traceId: input.traceId,
      },
    });
    expect(test.conversational.persist).not.toHaveBeenCalled();
  });
  it('delegates an already-completed retry to persistence for idempotent reuse', async () => {
    const generation = {
      ...base,
      status: 'ALREADY_COMPLETED',
      reused: true,
      completion: null,
      output: { kind: 'PLAN', artifactType: 'WEEKLY_PLAN', plan: {} },
    } as unknown as NutritionPlanningGenerationResult;
    const test = setup(generation);
    test.plan.persist.mockResolvedValue({
      persistence: 'REUSED',
      aggregate: { id: 'existing-plan-id', document: planDocument },
      aiJobCompleted: true,
    });
    await expect(test.service.execute(input)).resolves.toMatchObject({
      aggregateId: 'existing-plan-id',
      aiJobCompleted: true,
    });
    expect(test.plan.persist).toHaveBeenCalledWith({
      generation,
      ownership: input.ownership,
      executionContext: {
        correlationId: input.correlationId,
        traceId: input.traceId,
      },
    });
  });
  it.each(['POINT_GUIDANCE', 'MEAL_SUGGESTION', 'PLAN_REVIEW'] as const)(
    'delegates %s to the conversational persistence boundary',
    async (artifactType) => {
      const generation = {
        ...base,
        output: {
          kind: 'CONVERSATIONAL_ARTIFACT',
          artifactType,
          artifact: conversationalDocument,
        },
      } as unknown as NutritionPlanningGenerationResult;
      const test = setup(generation);
      await expect(test.service.execute(input)).resolves.toMatchObject({
        kind: 'CONVERSATIONAL_ARTIFACT',
        aggregateId: 'artifact-id',
        artifactType,
        document: conversationalDocument,
        aiJobCompleted: true,
      });
      expect(test.conversational.persist).toHaveBeenCalledWith({
        generation,
        userId: 'user-id',
        executionContext: {
          correlationId: input.correlationId,
          traceId: input.traceId,
        },
      });
      expect(test.plan.persist).not.toHaveBeenCalled();
    },
  );
  it('handles presentation without persistence or AI effects', async () => {
    const test = setup({
      status: 'NO_GENERATION',
      output: {
        kind: 'CURRENT_PLAN_PRESENTATION',
        artifactType: 'CURRENT_PLAN_PRESENTATION',
      },
    });
    await expect(test.service.execute(input)).resolves.toEqual({
      kind: 'CURRENT_PLAN_PRESENTATION',
      aggregateId: null,
      artifactType: 'CURRENT_PLAN_PRESENTATION',
      document: null,
      aiJobCompleted: false,
      requiresFormatting: false,
      requiresPersistence: false,
    });
    expect(test.plan.persist).not.toHaveBeenCalled();
    expect(test.conversational.persist).not.toHaveBeenCalled();
  });
  it('preserves engine, parser and validation errors unchanged', async () => {
    const error = new Error('parser failed');
    const test = setup({
      status: 'NO_GENERATION',
      output: {
        kind: 'CURRENT_PLAN_PRESENTATION',
        artifactType: 'CURRENT_PLAN_PRESENTATION',
      },
    });
    test.engine.generate.mockRejectedValue(error);
    await expect(test.service.execute(input)).rejects.toBe(error);
  });
  it('preserves persistence and AIJob errors unchanged', async () => {
    const generation = {
      ...base,
      output: {
        kind: 'PLAN',
        artifactType: 'WEEKLY_PLAN',
        plan: planDocument,
      },
    } as unknown as NutritionPlanningGenerationResult;
    const test = setup(generation);
    const error = new Error('transaction rolled back');
    test.plan.persist.mockRejectedValue(error);
    await expect(test.service.execute(input)).rejects.toBe(error);
  });
  it('rejects inconsistent ownership before generation', async () => {
    const test = setup({
      status: 'NO_GENERATION',
      output: {
        kind: 'CURRENT_PLAN_PRESENTATION',
        artifactType: 'CURRENT_PLAN_PRESENTATION',
      },
    });
    await expect(
      test.service.execute({
        ...input,
        ownership: { ...input.ownership, userId: 'other' },
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(test.engine.generate).not.toHaveBeenCalled();
  });
});
