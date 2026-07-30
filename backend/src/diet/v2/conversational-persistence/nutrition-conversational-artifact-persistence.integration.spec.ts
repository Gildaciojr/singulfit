import { AIJobStatus, AIJobType, Prisma, PrismaClient } from '@prisma/client';
import type { AIService } from '../../../ai/ai.service';
import { AuditService } from '../../../observability/audit.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { NutritionConversationalArtifactValidator } from '../nutrition-conversational-artifact.validator';
import type {
  NutritionPlanningAIJobCompletion,
  PendingNutritionConversationalGenerationResult,
} from '../nutrition-planning-generation.contract';
import { NutritionConversationalArtifactPersistenceService } from './nutrition-conversational-artifact-persistence.service';
import { NutritionConversationalArtifactPersistenceValidator } from './nutrition-conversational-artifact-persistence.validator';
import { PrismaNutritionConversationalArtifactGateway } from './prisma-nutrition-conversational-artifact.gateway';

const URL = process.env.NUTRITION_CONVERSATIONAL_V2_INTEGRATION_DATABASE_URL;
const SAFE_URL = URL ?? 'postgresql://disabled:disabled@127.0.0.1:1/disabled';
const integrationDescribe = URL ? describe : describe.skip;
const userId = 'nutrition-conversational-integration-user';
const promptId = 'nutrition-conversational-integration-prompt';

function generation(
  aiJobId: string,
  operationKey: string,
): PendingNutritionConversationalGenerationResult {
  const artifact = {
    schemaVersion: '1.0' as const,
    artifactType: 'POINT_GUIDANCE' as const,
    title: 'Orientação',
    summary: 'Resumo',
    generatedAt: '2026-07-29T18:00:00.000Z',
    guidance: {
      answer: 'Resposta segura',
      rationale: [],
      actionableSteps: ['Ação'],
      cautions: [],
    },
  };
  const storedResult = { candidateOutput: '{}', model: 'integration-model' };
  return {
    status: 'PENDING_COMPLETION',
    output: {
      kind: 'CONVERSATIONAL_ARTIFACT',
      artifactType: 'POINT_GUIDANCE',
      artifact,
    },
    aiJobId,
    operationKey,
    storedResult,
    reused: false,
    completion: {
      userId,
      aiJobId,
      jobType: AIJobType.DIET,
      response: {
        responseId: `response:${operationKey}`,
        model: 'integration-model',
        outputText: '{}',
        promptTokens: 1,
        completionTokens: 1,
        totalTokens: 2,
      },
      result: storedResult,
    },
  };
}

integrationDescribe('Nutrition conversational persistence integration', () => {
  const prisma = new PrismaClient({ datasources: { db: { url: SAFE_URL } } });
  const repository = new PrismaNutritionConversationalArtifactGateway(
    prisma as unknown as PrismaService,
  );
  const validator = new NutritionConversationalArtifactPersistenceValidator(
    new NutritionConversationalArtifactValidator(),
  );
  const audit = new AuditService(prisma as unknown as PrismaService);
  beforeAll(async () => {
    await prisma.$connect();
  });
  beforeEach(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.promptVersion.deleteMany({ where: { id: promptId } });
    await prisma.user.create({ data: { id: userId, phone: '+5511999990001' } });
    await prisma.promptVersion.create({
      data: {
        id: promptId,
        name: 'nutrition-conversational-integration',
        version: 1,
        prompt: 'integration',
      },
    });
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.promptVersion.deleteMany({ where: { id: promptId } });
    await prisma.$disconnect();
  });
  async function job(operationKey: string) {
    return prisma.aIJob.create({
      data: {
        userId,
        type: AIJobType.DIET,
        status: AIJobStatus.PROCESSING,
        startedAt: new Date('2026-07-29T18:00:00.000Z'),
        leaseExpiresAt: new Date('2026-07-29T19:00:00.000Z'),
        attempts: 1,
        promptVersionId: promptId,
        operationKey,
      },
    });
  }
  it('persists once, completes the job atomically and enforces immutability', async () => {
    const createdJob = await job('integration-success');
    const ai = {
      completeJobInTransaction: jest.fn(
        (
          transaction: Prisma.TransactionClient,
          input: NutritionPlanningAIJobCompletion,
        ) =>
          transaction.aIJob.update({
            where: { id: input.aiJobId },
            data: {
              status: AIJobStatus.COMPLETED,
              result: input.result,
              completedAt: new Date('2026-07-29T18:01:00.000Z'),
              leaseExpiresAt: null,
            },
          }),
      ),
    } as unknown as AIService;
    const service = new NutritionConversationalArtifactPersistenceService(
      repository,
      validator,
      ai,
      audit,
    );
    const input = {
      userId,
      generation: generation(createdJob.id, 'integration-success'),
    };
    await expect(service.persist(input)).resolves.toMatchObject({
      persistence: 'CREATED',
    });
    await expect(service.persist(input)).resolves.toMatchObject({
      persistence: 'REUSED',
    });
    expect(
      await prisma.nutritionConversationalArtifact.count({ where: { userId } }),
    ).toBe(1);
    expect(
      (await prisma.aIJob.findUniqueOrThrow({ where: { id: createdJob.id } }))
        .status,
    ).toBe(AIJobStatus.COMPLETED);
    const artifact =
      await prisma.nutritionConversationalArtifact.findFirstOrThrow({
        where: { userId },
      });
    await expect(
      prisma.nutritionConversationalArtifact.update({
        where: { id: artifact.id },
        data: { operationKey: 'changed' },
      }),
    ).rejects.toThrow();
  });
  it('rolls back artifact and audit when AI completion fails', async () => {
    const createdJob = await job('integration-rollback');
    const ai = {
      completeJobInTransaction: jest
        .fn()
        .mockRejectedValue(new Error('completion failed')),
    } as unknown as AIService;
    const service = new NutritionConversationalArtifactPersistenceService(
      repository,
      validator,
      ai,
      audit,
    );
    await expect(
      service.persist({
        userId,
        generation: generation(createdJob.id, 'integration-rollback'),
      }),
    ).rejects.toThrow('completion failed');
    expect(
      await prisma.nutritionConversationalArtifact.count({
        where: { aiJobId: createdJob.id },
      }),
    ).toBe(0);
    expect(
      (await prisma.aIJob.findUniqueOrThrow({ where: { id: createdJob.id } }))
        .status,
    ).toBe(AIJobStatus.PROCESSING);
  });
});
