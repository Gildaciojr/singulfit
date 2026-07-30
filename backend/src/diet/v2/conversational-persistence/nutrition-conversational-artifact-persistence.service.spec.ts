import {
  AIJobStatus,
  AIJobType,
  NutritionArtifactType,
  Prisma,
  type NutritionConversationalArtifact,
} from '@prisma/client';
import type { AIService } from '../../../ai/ai.service';
import type { AuditService } from '../../../observability/audit.service';
import { NutritionConversationalArtifactValidator } from '../nutrition-conversational-artifact.validator';
import type { PendingNutritionConversationalGenerationResult } from '../nutrition-planning-generation.contract';
import { NutritionConversationalArtifactPersistenceService } from './nutrition-conversational-artifact-persistence.service';
import { NutritionConversationalArtifactPersistenceValidator } from './nutrition-conversational-artifact-persistence.validator';
import type { NutritionConversationalArtifactRepository } from './nutrition-conversational-artifact.repository';

const document = Object.freeze({
  schemaVersion: '1.0' as const,
  artifactType: 'POINT_GUIDANCE' as const,
  title: 'Orientação',
  summary: 'Resumo',
  generatedAt: '2026-07-29T12:00:00.000Z',
  guidance: Object.freeze({
    answer: 'Resposta',
    rationale: Object.freeze([]),
    actionableSteps: Object.freeze(['Ação']),
    cautions: Object.freeze([]),
  }),
});
function generation(): PendingNutritionConversationalGenerationResult {
  const storedResult = { candidateOutput: '{}', model: 'model' };
  return {
    status: 'PENDING_COMPLETION',
    output: {
      kind: 'CONVERSATIONAL_ARTIFACT',
      artifactType: 'POINT_GUIDANCE',
      artifact: document,
    },
    aiJobId: 'job-id',
    operationKey: 'operation-key',
    storedResult,
    reused: false,
    completion: {
      userId: 'user-id',
      aiJobId: 'job-id',
      jobType: AIJobType.DIET,
      response: {
        responseId: 'response-id',
        model: 'model',
        outputText: '{}',
        promptTokens: 1,
        completionTokens: 1,
        totalTokens: 2,
      },
      result: storedResult,
    },
  };
}
function persisted(): NutritionConversationalArtifact {
  return {
    id: 'artifact-id',
    userId: 'user-id',
    artifactType: NutritionArtifactType.POINT_GUIDANCE,
    schemaVersion: '1.0',
    document: document as unknown as Prisma.JsonValue,
    aiJobId: 'job-id',
    operationKey: 'operation-key',
    reviewedPlanId: null,
    createdAt: new Date('2026-07-29T12:00:00.000Z'),
  };
}
function setup(existing: NutritionConversationalArtifact | null = null) {
  const transaction = {} as Prisma.TransactionClient;
  const repository = {
    inTransaction: jest.fn(
      async <T>(operation: (client: Prisma.TransactionClient) => Promise<T>) =>
        operation(transaction),
    ),
    acquireUserLock: jest.fn(),
    findOwnership: jest.fn().mockResolvedValue({
      userExists: true,
      aiJob: {
        id: 'job-id',
        userId: 'user-id',
        type: AIJobType.DIET,
        status: AIJobStatus.PROCESSING,
        operationKey: 'operation-key',
      },
      reviewedPlan: null,
    }),
    findExisting: jest.fn().mockResolvedValue(existing),
    create: jest.fn().mockResolvedValue(persisted()),
  };
  const ai = {
    completeJobInTransaction: jest.fn().mockResolvedValue({ id: 'usage-id' }),
  };
  const audit = {
    recordInTransaction: jest.fn().mockResolvedValue({ id: 'audit-id' }),
  };
  const validator = new NutritionConversationalArtifactPersistenceValidator(
    new NutritionConversationalArtifactValidator(),
  );
  return {
    repository,
    ai,
    audit,
    service: new NutritionConversationalArtifactPersistenceService(
      repository as unknown as NutritionConversationalArtifactRepository,
      validator,
      ai as unknown as AIService,
      audit as unknown as AuditService,
    ),
    transaction,
  };
}
describe('NutritionConversationalArtifactPersistenceService', () => {
  it('persists, completes AIJob and audits in the same transaction', async () => {
    const test = setup();
    const result = await test.service.persist({
      userId: 'user-id',
      generation: generation(),
    });
    expect(result).toMatchObject({
      persistence: 'CREATED',
      aggregate: {
        id: 'artifact-id',
        document: { artifactType: 'POINT_GUIDANCE' },
      },
    });
    expect(test.ai.completeJobInTransaction).toHaveBeenCalledWith(
      test.transaction,
      generation().completion,
    );
    expect(test.audit.recordInTransaction).toHaveBeenCalledWith(
      test.transaction,
      expect.objectContaining({
        action: 'NUTRITION_POINT_GUIDANCE_PERSISTED',
        entityId: 'artifact-id',
      }),
    );
  });
  it('reuses the same aggregate idempotently without completing twice', async () => {
    const test = setup(persisted());
    await expect(
      test.service.persist({ userId: 'user-id', generation: generation() }),
    ).resolves.toMatchObject({ persistence: 'REUSED' });
    expect(test.repository.create).not.toHaveBeenCalled();
    expect(test.ai.completeJobInTransaction).not.toHaveBeenCalled();
  });
  it('propagates completion failure through the transaction boundary', async () => {
    const test = setup();
    test.ai.completeJobInTransaction.mockRejectedValue(
      new Error('completion failed'),
    );
    await expect(
      test.service.persist({ userId: 'user-id', generation: generation() }),
    ).rejects.toThrow('completion failed');
    expect(test.audit.recordInTransaction).toHaveBeenCalledWith(
      test.transaction,
      expect.objectContaining({ entityId: 'artifact-id' }),
    );
  });
});
