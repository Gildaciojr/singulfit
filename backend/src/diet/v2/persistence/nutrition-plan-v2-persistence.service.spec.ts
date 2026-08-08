import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  AIJobStatus,
  AIJobType,
  FitnessGoal,
  NutritionArtifactType,
  NutritionPlanLifecycleReason,
  NutritionPlanStatus,
  Prisma,
  type NutritionPlanV2 as PersistedNutritionPlanV2,
} from '@prisma/client';
import type { AuditService } from '../../../observability/audit.service';
import type { AIService } from '../../../ai/ai.service';
import type { PendingNutritionPlanGenerationResult } from '../nutrition-planning-generation.contract';
import type { NutritionPlanV2 } from '../nutrition-plan-v2.contract';
import type { PersistNutritionPlanV2Input } from './nutrition-plan-v2-persistence.contract';
import { NutritionPlanV2PersistenceService } from './nutrition-plan-v2-persistence.service';
import { NutritionPlanV2PersistenceValidator } from './nutrition-plan-v2-persistence.validator';
import type { NutritionPlanV2ProjectionWriter } from './nutrition-plan-v2-projection.writer';
import type { NutritionPlanV2Repository } from './nutrition-plan-v2.repository';

const GENERATED_AT = '2026-07-29T15:00:00.000Z';

function generation(
  overrides: Partial<NutritionPlanV2> = {},
): PendingNutritionPlanGenerationResult {
  const plan: NutritionPlanV2 = {
    schemaVersion: 2,
    artifactType: 'WEEKLY_PLAN',
    lifecycleReason: 'CREATION',
    replacesPlanReference: null,
    title: 'Plano V2',
    objectiveSummary: 'Objetivo seguro',
    strategy: {
      schemaVersion: 2,
      artifactType: 'WEEKLY_PLAN',
      objective: { status: 'CONFIRMED', value: FitnessGoal.WEIGHT_LOSS },
      dayCount: 0,
      mealCountPerDay: { status: 'NOT_SET' },
      mealSchedule: { status: 'NOT_SET' },
      energyTargetKcal: { status: 'NOT_SET' },
      energySource: 'NOT_AVAILABLE',
      macroTargets: { status: 'NOT_SET' },
      trainingAware: false,
      appliedConstraintCodes: [],
      excludedFoods: [],
      preferredFoods: [],
      variationPolicy: 'WEEKLY',
      detailLevel: 'STANDARD',
      factors: [],
    },
    guidance: [],
    days: [],
    substitutions: [],
    adaptationRules: [],
    hydrationGuidance: [],
    safetyNotes: [],
    generation: {
      engineVersion: 2,
      promptVersionId: 'prompt-id',
      aiJobId: 'ai-job-id',
      operationKey: 'operation-key',
      model: 'model-id',
      generatedAt: GENERATED_AT,
      reused: false,
    },
    validation: { status: 'VALID', issues: [] },
    ...overrides,
  };
  const storedResult = {
    candidateOutput: '{"candidate":true}',
    model: 'model-id',
  };
  const response = {
    responseId: 'response-id',
    model: 'model-id',
    outputText: storedResult.candidateOutput,
    promptTokens: 10,
    completionTokens: 20,
    totalTokens: 30,
  };
  return {
    status: 'PENDING_COMPLETION',
    output: { kind: 'PLAN', artifactType: 'WEEKLY_PLAN', plan },
    aiJobId: 'ai-job-id',
    operationKey: 'operation-key',
    storedResult,
    reused: false,
    completion: {
      userId: 'user-id',
      aiJobId: 'ai-job-id',
      jobType: AIJobType.DIET,
      response,
      result: storedResult,
    },
  };
}

function input(
  generated: PendingNutritionPlanGenerationResult = generation(),
): PersistNutritionPlanV2Input {
  return {
    generation: generated,
    ownership: { userId: 'user-id', profileId: 'profile-id' },
  };
}

function persisted(
  generated: PendingNutritionPlanGenerationResult = generation(),
): PersistedNutritionPlanV2 {
  return {
    id: 'plan-id',
    userId: 'user-id',
    profileId: 'profile-id',
    aiJobId: 'ai-job-id',
    schemaVersion: 2,
    engineVersion: 2,
    artifactType: NutritionArtifactType.WEEKLY_PLAN,
    lifecycleReason: NutritionPlanLifecycleReason.CREATION,
    replacesPlanReference: null,
    status: NutritionPlanStatus.ACTIVE,
    document: generated.output.plan as unknown as Prisma.JsonValue,
    generatedAt: new Date(GENERATED_AT),
    createdAt: new Date(GENERATED_AT),
    updatedAt: new Date(GENERATED_AT),
  };
}

function subject(existing: PersistedNutritionPlanV2 | null = null) {
  const transaction = {} as Prisma.TransactionClient;
  const created = persisted();
  const repository = {
    inTransaction: jest.fn(
      async <T>(operation: (client: Prisma.TransactionClient) => Promise<T>) =>
        operation(transaction),
    ),
    acquireUserLock: jest.fn().mockResolvedValue(undefined),
    findOwnership: jest.fn().mockResolvedValue({
      profileOwned: true,
      aiJob: {
        id: 'ai-job-id',
        userId: 'user-id',
        type: AIJobType.DIET,
        status: AIJobStatus.PROCESSING,
        promptVersionId: 'prompt-id',
        operationKey: 'operation-key',
      },
    }),
    findByAIJobId: jest.fn().mockResolvedValue(existing),
    archiveActive: jest.fn().mockResolvedValue(undefined),
    create: jest.fn().mockResolvedValue(created),
  };
  const auditService = {
    recordInTransaction: jest.fn().mockResolvedValue({ id: 'audit-id' }),
  };
  const projectionWriter = {
    prepareInTransaction: jest.fn().mockResolvedValue(undefined),
  };
  const aiService = {
    completeJobInTransaction: jest.fn().mockResolvedValue({ id: 'usage-id' }),
  };
  const nutritionPlanOwnership = {
    acquireCanonicalLockInTransaction: jest.fn().mockResolvedValue(undefined),
    transitionInTransaction: jest
      .fn()
      .mockResolvedValue({ transition: 'CREATED' }),
    assertInTransaction: jest.fn().mockResolvedValue(undefined),
  };
  const validator = new NutritionPlanV2PersistenceValidator();
  return {
    transaction,
    repository,
    auditService,
    projectionWriter,
    aiService,
    validator,
    service: new NutritionPlanV2PersistenceService(
      repository as unknown as NutritionPlanV2Repository,
      validator,
      auditService as unknown as AuditService,
      projectionWriter as NutritionPlanV2ProjectionWriter,
      aiService as unknown as AIService,
      nutritionPlanOwnership as never,
    ),
    nutritionPlanOwnership,
  };
}

describe('NutritionPlanV2PersistenceService', () => {
  it('persists, prepares the inert projection and audits in one transaction', async () => {
    const test = subject();

    await expect(test.service.persist(input())).resolves.toMatchObject({
      persistence: 'CREATED',
      aggregate: { id: 'plan-id', document: { schemaVersion: 2 } },
      aiJobCompleted: true,
    });

    expect(test.repository.inTransaction).toHaveBeenCalledTimes(1);
    expect(test.repository.acquireUserLock).toHaveBeenCalledWith(
      test.transaction,
      'user-id',
    );
    expect(
      test.nutritionPlanOwnership.acquireCanonicalLockInTransaction.mock
        .invocationCallOrder[0],
    ).toBeLessThan(test.repository.acquireUserLock.mock.invocationCallOrder[0]);
    expect(test.repository.archiveActive).toHaveBeenCalledWith(
      test.transaction,
      'user-id',
    );
    expect(test.repository.create).toHaveBeenCalledWith(
      test.transaction,
      expect.objectContaining({
        userId: 'user-id',
        profileId: 'profile-id',
        aiJobId: 'ai-job-id',
        status: NutritionPlanStatus.ACTIVE,
      }),
    );
    expect(test.projectionWriter.prepareInTransaction).toHaveBeenCalledWith(
      test.transaction,
      expect.objectContaining({ id: 'plan-id' }),
    );
    expect(test.aiService.completeJobInTransaction).toHaveBeenCalledWith(
      test.transaction,
      expect.objectContaining({ aiJobId: 'ai-job-id' }),
    );
    expect(test.auditService.recordInTransaction).toHaveBeenCalledWith(
      test.transaction,
      expect.objectContaining({
        action: 'NUTRITION_PLAN_V2_PERSISTED',
        entityType: 'NUTRITION_PLAN_V2',
        entityId: 'plan-id',
      }),
    );
  });

  it('reuses an identical aggregate without duplicate writes or audit', async () => {
    const test = subject(persisted());

    await expect(test.service.persist(input())).resolves.toMatchObject({
      persistence: 'REUSED',
      aggregate: { id: 'plan-id' },
      aiJobCompleted: true,
    });

    expect(test.repository.archiveActive).not.toHaveBeenCalled();
    expect(test.repository.create).not.toHaveBeenCalled();
    expect(test.projectionWriter.prepareInTransaction).not.toHaveBeenCalled();
    expect(test.aiService.completeJobInTransaction).not.toHaveBeenCalled();
    expect(test.auditService.recordInTransaction).not.toHaveBeenCalled();
  });

  it('rejects a divergent retry instead of overwriting canonical data', async () => {
    const divergent = persisted();
    divergent.document = {
      ...(divergent.document as Prisma.JsonObject),
      title: 'Outro plano',
    };
    const test = subject(divergent);

    await expect(test.service.persist(input())).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(test.repository.create).not.toHaveBeenCalled();
  });

  it('rejects inconsistent ownership metadata before opening a transaction', async () => {
    const test = subject();
    const valid = input();
    const invalid: PersistNutritionPlanV2Input = {
      ...valid,
      generation: {
        ...valid.generation,
        completion: {
          ...valid.generation.completion,
          userId: 'other-user',
        },
      },
    };

    await expect(test.service.persist(invalid)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(test.repository.inTransaction).not.toHaveBeenCalled();
  });

  it('rejects non-serializable document values without using any', () => {
    const invalid = generation({
      strategy: {
        ...generation().output.plan.strategy,
        dayCount: Number.NaN,
      },
    });

    expect(() => testValidator().validateInput(input(invalid))).toThrow(
      BadRequestException,
    );
  });
});

function testValidator(): NutritionPlanV2PersistenceValidator {
  return new NutritionPlanV2PersistenceValidator();
}
