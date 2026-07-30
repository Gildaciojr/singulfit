import {
  AIJobStatus,
  AIJobType,
  FitnessGoal,
  Prisma,
  PrismaClient,
} from '@prisma/client';
import { AuditService } from '../../../observability/audit.service';
import type { AIService } from '../../../ai/ai.service';
import { PrismaService } from '../../../prisma/prisma.service';
import type { PendingNutritionPlanGenerationResult } from '../nutrition-planning-generation.contract';
import type { NutritionPlanningAIJobCompletion } from '../nutrition-planning-generation.contract';
import type { NutritionPlanV2 } from '../nutrition-plan-v2.contract';
import type { PersistNutritionPlanV2Input } from './nutrition-plan-v2-persistence.contract';
import { NutritionPlanV2PersistenceService } from './nutrition-plan-v2-persistence.service';
import { NutritionPlanV2PersistenceValidator } from './nutrition-plan-v2-persistence.validator';
import { InactiveNutritionPlanV2ProjectionWriter } from './nutrition-plan-v2-projection.writer';
import { PrismaNutritionPlanV2Gateway } from './prisma-nutrition-plan-v2.gateway';

const DATABASE_URL = process.env.NUTRITION_V2_INTEGRATION_DATABASE_URL;
const SAFE_DATABASE_URL =
  DATABASE_URL ?? 'postgresql://disabled:disabled@127.0.0.1:1/disabled';
const integrationDescribe = DATABASE_URL ? describe : describe.skip;
const GENERATED_AT = '2026-07-29T15:00:00.000Z';

function pendingGeneration(
  userId: string,
  aiJobId: string,
  operationKey: string,
): PendingNutritionPlanGenerationResult {
  const plan: NutritionPlanV2 = {
    schemaVersion: 2,
    artifactType: 'WEEKLY_PLAN',
    lifecycleReason: 'CREATION',
    replacesPlanReference: null,
    title: `Plano ${operationKey}`,
    objectiveSummary: 'Persistência V2 isolada',
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
      promptVersionId: 'nutrition-v2-integration-prompt',
      aiJobId,
      operationKey,
      model: 'integration-model',
      generatedAt: GENERATED_AT,
      reused: false,
    },
    validation: { status: 'VALID', issues: [] },
  };
  const storedResult = {
    candidateOutput: JSON.stringify({ operationKey }),
    model: 'integration-model',
  };
  return {
    status: 'PENDING_COMPLETION',
    output: { kind: 'PLAN', artifactType: 'WEEKLY_PLAN', plan },
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
        outputText: storedResult.candidateOutput,
        promptTokens: 10,
        completionTokens: 20,
        totalTokens: 30,
      },
      result: storedResult,
    },
  };
}

integrationDescribe('NutritionPlanV2 persistence integration', () => {
  const prisma = new PrismaClient({
    datasources: { db: { url: SAFE_DATABASE_URL } },
  });
  const repository = new PrismaNutritionPlanV2Gateway(
    prisma as unknown as PrismaService,
  );
  const validator = new NutritionPlanV2PersistenceValidator();
  const projectionWriter = new InactiveNutritionPlanV2ProjectionWriter();
  const aiService = {
    completeJobInTransaction: jest.fn(
      (
        transaction: Prisma.TransactionClient,
        completion: NutritionPlanningAIJobCompletion,
      ) =>
        transaction.aIJob.update({
          where: { id: completion.aiJobId },
          data: {
            status: AIJobStatus.COMPLETED,
            providerResponseId: completion.response.responseId,
            completedAt: new Date(),
            leaseExpiresAt: null,
            result: completion.result,
          },
        }),
    ),
  } as unknown as AIService;
  const service = new NutritionPlanV2PersistenceService(
    repository,
    validator,
    new AuditService(prisma as unknown as PrismaService),
    projectionWriter,
    aiService,
  );

  beforeAll(async () => {
    await prisma.$connect();
  });

  beforeEach(async () => {
    await prisma.user.deleteMany({
      where: { id: { startsWith: 'nutrition-v2-integration-user' } },
    });
    await prisma.promptVersion.deleteMany({
      where: { id: 'nutrition-v2-integration-prompt' },
    });
    await prisma.promptVersion.create({
      data: {
        id: 'nutrition-v2-integration-prompt',
        name: 'nutrition-v2-integration',
        version: 1,
        prompt: 'integration',
      },
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({
      where: { id: { startsWith: 'nutrition-v2-integration-user' } },
    });
    await prisma.promptVersion.deleteMany({
      where: { id: 'nutrition-v2-integration-prompt' },
    });
    await prisma.$disconnect();
  });

  async function seedOwnership(
    suffix: string,
    operationKey: string,
  ): Promise<PersistNutritionPlanV2Input> {
    const userId = `nutrition-v2-integration-user-${suffix}`;
    const profileId = `nutrition-v2-integration-profile-${suffix}`;
    const aiJobId = `nutrition-v2-integration-job-${suffix}`;
    await prisma.user.create({
      data: { id: userId, phone: `+55119999${suffix.padStart(4, '0')}` },
    });
    await prisma.fitnessProfile.create({
      data: {
        id: profileId,
        userId,
        gender: 'FEMALE',
        birthDate: new Date('1990-01-01T00:00:00.000Z'),
        heightCm: 165,
        currentWeightKg: '65.00',
        targetWeightKg: '60.00',
        activityLevel: 'MODERATE',
        goal: 'WEIGHT_LOSS',
      },
    });
    await prisma.aIJob.create({
      data: {
        id: aiJobId,
        userId,
        type: AIJobType.DIET,
        status: AIJobStatus.PROCESSING,
        promptVersionId: 'nutrition-v2-integration-prompt',
        operationKey,
        startedAt: new Date(),
      },
    });
    return {
      generation: pendingGeneration(userId, aiJobId, operationKey),
      ownership: { userId, profileId },
    };
  }

  it('serializes concurrent retries, persists once and reconstructs the canonical document', async () => {
    const input = await seedOwnership('1', 'integration-operation-1');

    const results = await Promise.all([
      service.persist(input),
      service.persist(input),
    ]);

    expect(results.map((result) => result.persistence).sort()).toEqual([
      'CREATED',
      'REUSED',
    ]);
    expect(results[0].aggregate.document).toEqual(input.generation.output.plan);
    expect(Object.isFrozen(results[0].aggregate.document)).toBe(true);
    await expect(
      prisma.nutritionPlanV2.count({
        where: { userId: input.ownership.userId },
      }),
    ).resolves.toBe(1);
    await expect(
      prisma.auditLog.count({
        where: {
          entityType: 'NUTRITION_PLAN_V2',
          userId: input.ownership.userId,
        },
      }),
    ).resolves.toBe(1);
    await expect(
      prisma.aIJob.findUniqueOrThrow({
        where: { id: input.generation.aiJobId },
        select: { status: true, completedAt: true, result: true },
      }),
    ).resolves.toEqual({
      status: AIJobStatus.COMPLETED,
      completedAt: expect.any(Date),
      result: input.generation.storedResult,
    });
  });

  it('rolls back archive, aggregate and audit when the transaction fails', async () => {
    const first = await seedOwnership('2', 'integration-operation-2a');
    await service.persist(first);
    const secondJobId = 'nutrition-v2-integration-job-2b';
    await prisma.aIJob.create({
      data: {
        id: secondJobId,
        userId: first.ownership.userId,
        type: AIJobType.DIET,
        status: AIJobStatus.PROCESSING,
        promptVersionId: 'nutrition-v2-integration-prompt',
        operationKey: 'integration-operation-2b',
        startedAt: new Date(),
      },
    });
    const second: PersistNutritionPlanV2Input = {
      ownership: first.ownership,
      generation: pendingGeneration(
        first.ownership.userId,
        secondJobId,
        'integration-operation-2b',
      ),
    };
    const failingAudit = {
      recordInTransaction: jest
        .fn()
        .mockRejectedValue(new Error('forced audit rollback')),
    };
    const failingService = new NutritionPlanV2PersistenceService(
      repository,
      validator,
      failingAudit as unknown as AuditService,
      projectionWriter,
      aiService,
    );

    await expect(failingService.persist(second)).rejects.toThrow(
      'forced audit rollback',
    );
    await expect(
      prisma.nutritionPlanV2.findMany({
        where: { userId: first.ownership.userId },
        select: { aiJobId: true, status: true },
      }),
    ).resolves.toEqual([
      { aiJobId: first.generation.aiJobId, status: 'ACTIVE' },
    ]);
  });

  it('enforces ownership and the database trigger for canonical immutability', async () => {
    const first = await seedOwnership('3', 'integration-operation-3');
    const second = await seedOwnership('4', 'integration-operation-4');
    const invalidOwnership: PersistNutritionPlanV2Input = {
      ...first,
      ownership: {
        userId: first.ownership.userId,
        profileId: second.ownership.profileId,
      },
    };
    await expect(service.persist(invalidOwnership)).rejects.toThrow(
      'não pertence ao usuário',
    );

    const persisted = await service.persist(first);
    const document = validator.validateInput(first);
    await expect(
      prisma.nutritionPlanV2.update({
        where: { id: persisted.aggregate.id },
        data: {
          document: {
            ...document,
            title: 'Mutação proibida',
          },
        },
      }),
    ).rejects.toThrow('NutritionPlanV2 canonical data is immutable');
  });
});
