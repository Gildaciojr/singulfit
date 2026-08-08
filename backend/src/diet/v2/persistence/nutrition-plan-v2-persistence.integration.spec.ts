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
import { NutritionPlanOwnershipService } from '../../ownership/nutrition-plan-ownership.service';
import { PrismaNutritionPlanOwnershipRepository } from '../../ownership/prisma-nutrition-plan-ownership.repository';
import { CurrentNutritionPlanReaderService } from '../../current-nutrition-plan-reader.service';
import { CoachProfileSnapshotBuilder } from '../../../context/coach-profile-snapshot.builder';
import { CoachProfileAcquisitionProjectionService } from '../../../context/profile-acquisition/coach-profile-acquisition-projection.service';
import { CoachConversationHumanContextBuilder } from '../../../context/coach-conversation-human-context.builder';
import { ConversationGoalPlannerService } from '../../../context/conversation-goal-planner.service';
import { CONVERSATION_RECOGNIZED_INTENT } from '../../../context/conversation-goal-planner.contract';
import { NutritionPlanningReadinessService } from '../nutrition-planning-readiness.service';
import { NutritionPlanningEngineV2Service } from '../nutrition-planning-engine-v2.service';
import type { NutritionGenerationRunnerV2Service } from '../nutrition-generation-runner-v2.service';
import { NutritionApplicationExecutorService } from '../execution/nutrition-application-executor.service';
import type { NutritionConversationalArtifactPersistenceService } from '../conversational-persistence/nutrition-conversational-artifact-persistence.service';
import type { ProfileAcquisitionDecision } from '../../../context/coach-adaptive-profile-collector.contract';
import type { GenerateNutritionPlanV2Input } from '../nutrition-planning-generation.contract';
import { DietGeneratorService } from '../../diet-generator.service';
import type { SubscriptionsService } from '../../../subscriptions/subscriptions.service';
import type { LegacyDietCandidate } from '../../interfaces/legacy-diet-candidate.interface';

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

integrationDescribe('Phase H consolidated Nutrition V2 E2E', () => {
  const prisma = new PrismaClient({
    datasources: { db: { url: SAFE_DATABASE_URL } },
  });
  const repository = new PrismaNutritionPlanV2Gateway(
    prisma as unknown as PrismaService,
  );
  const validator = new NutritionPlanV2PersistenceValidator();
  const projectionWriter = new InactiveNutritionPlanV2ProjectionWriter();
  const createStandaloneJob = jest.fn();
  const runTextJob = jest.fn();
  const aiService = {
    createStandaloneJob,
    runTextJob,
    failJob: jest.fn(),
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
  const auditService = new AuditService(prisma as unknown as PrismaService);
  const ownershipService = new NutritionPlanOwnershipService(
    new PrismaNutritionPlanOwnershipRepository(),
    auditService,
  );
  const service = new NutritionPlanV2PersistenceService(
    repository,
    validator,
    auditService,
    projectionWriter,
    aiService,
    ownershipService,
  );
  const currentReader = new CurrentNutritionPlanReaderService(
    prisma as unknown as PrismaService,
    validator,
  );
  const snapshotBuilder = new CoachProfileSnapshotBuilder(
    prisma as unknown as PrismaService,
    new CoachProfileAcquisitionProjectionService(),
    currentReader,
  );
  const humanContextBuilder = new CoachConversationHumanContextBuilder();
  const goalPlanner = new ConversationGoalPlannerService();
  const readiness = new NutritionPlanningReadinessService();

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

  async function seedProfileOnly(suffix: string) {
    const userId = `nutrition-v2-integration-user-${suffix}`;
    const profileId = `nutrition-v2-integration-profile-${suffix}`;
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
    return { userId, profileId };
  }

  async function legacyCandidate(
    ownership: Readonly<{ userId: string; profileId: string }>,
    suffix: string,
  ): Promise<LegacyDietCandidate> {
    const aiJobId = `nutrition-v2-integration-legacy-job-${suffix}`;
    const operationKey = `nutrition-v2-integration-legacy-operation-${suffix}`;
    const output = {
      title: `Plano Legacy ${suffix}`,
      dailyCaloriesTarget: 1900,
      proteinTarget: 130,
      carbsTarget: 210,
      fatTarget: 60,
      meals: [
        {
          name: 'Almoço',
          order: 1,
          caloriesTarget: 650,
          notes: null,
          items: [
            {
              foodName: 'Arroz, feijão e frango',
              quantity: '1 prato',
              calories: 650,
              protein: 45,
              carbs: 80,
              fat: 15,
              substitutionGroup: 'Pode substituir o frango por peixe',
            },
          ],
        },
      ],
    };
    const storedResult = {
      candidateOutput: JSON.stringify(output),
      model: 'integration-model',
    };
    const response = {
      responseId: `nutrition-v2-integration-legacy-response-${suffix}`,
      model: storedResult.model,
      outputText: storedResult.candidateOutput,
      promptTokens: 10,
      completionTokens: 20,
      totalTokens: 30,
    };
    await prisma.aIJob.create({
      data: {
        id: aiJobId,
        userId: ownership.userId,
        type: AIJobType.DIET,
        status: AIJobStatus.PROCESSING,
        promptVersionId: 'nutrition-v2-integration-prompt',
        operationKey,
        startedAt: new Date(),
      },
    });
    return Object.freeze({
      status: 'PENDING_COMPLETION',
      userId: ownership.userId,
      profileId: ownership.profileId,
      objective: FitnessGoal.WEIGHT_LOSS,
      aiJobId,
      operationKey,
      generatedAt: new Date(
        Date.parse('2026-08-07T13:00:00.000Z') + Number(suffix) * 60_000,
      ),
      output,
      storedResult,
      completion: Object.freeze({
        userId: ownership.userId,
        aiJobId,
        jobType: AIJobType.DIET,
        response,
        result: storedResult,
      }),
    });
  }

  it('executes the real V2 application chain and exposes it to the next planning turn', async () => {
    const ownership = await seedProfileOnly('5');
    const operationKey = 'nutrition-v2-full-chain-operation';
    const jobId = 'nutrition-v2-integration-engine-job-5';
    const generated = pendingGeneration(ownership.userId, jobId, operationKey);
    const providerResponse = {
      responseId: 'nutrition-v2-integration-response-5',
      model: 'integration-model',
      outputText: generated.storedResult.candidateOutput,
      promptTokens: 10,
      completionTokens: 20,
      totalTokens: 30,
    };
    const runner = {
      prepare: jest.fn().mockReturnValue({
        resolution: { artifactType: 'WEEKLY_PLAN' },
      }),
      describe: jest.fn().mockReturnValue({
        promptName: 'nutrition-v2-integration',
        operationKey,
        canonicalPayload: '{}',
        schema: { name: 'nutrition_v2_integration', schema: {} },
      }),
      run: jest.fn(
        async (input: { executeProvider: () => Promise<unknown> }) => {
          await input.executeProvider();
          return { output: generated.output, response: providerResponse };
        },
      ),
    };
    createStandaloneJob.mockImplementationOnce(async () =>
      prisma.aIJob.create({
        data: {
          id: jobId,
          userId: ownership.userId,
          type: AIJobType.DIET,
          status: AIJobStatus.PENDING,
          promptVersionId: 'nutrition-v2-integration-prompt',
          operationKey,
        },
      }),
    );
    runTextJob.mockImplementationOnce(async () => {
      await prisma.aIJob.update({
        where: { id: jobId },
        data: { status: AIJobStatus.PROCESSING, startedAt: new Date() },
      });
      return providerResponse;
    });
    const engine = new NutritionPlanningEngineV2Service(
      runner as unknown as NutritionGenerationRunnerV2Service,
      aiService as unknown as AIService,
    );
    const executor = new NutritionApplicationExecutorService(engine, service, {
      persist: jest.fn(),
    } as unknown as NutritionConversationalArtifactPersistenceService);
    const execution = await executor.execute({
      generationInput: {
        userId: ownership.userId,
        decision: {},
        snapshot: {},
        referenceDate: new Date(GENERATED_AT),
      } as unknown as GenerateNutritionPlanV2Input,
      ownership,
      correlationId: 'nutrition-v2-integration-correlation-5',
    });

    expect(execution).toMatchObject({
      kind: 'PLAN',
      artifactType: 'WEEKLY_PLAN',
      aiJobCompleted: true,
    });
    expect(runner.prepare).toHaveBeenCalledTimes(1);
    expect(runner.run).toHaveBeenCalledTimes(1);
    expect(runTextJob).toHaveBeenCalledTimes(1);
    await expect(
      prisma.dietPlan.count({ where: { userId: ownership.userId } }),
    ).resolves.toBe(0);
    await expect(
      prisma.nutritionPlanOwnership.findUniqueOrThrow({
        where: { userId: ownership.userId },
        select: { implementation: true, planId: true },
      }),
    ).resolves.toEqual({
      implementation: 'V2',
      planId: execution.aggregateId,
    });

    const nextSnapshot = await snapshotBuilder.build(
      ownership.userId,
      new Date('2026-08-07T12:05:00.000Z'),
    );
    expect(nextSnapshot.plans.currentNutritionPlan).toMatchObject({
      value: { implementation: 'V2', id: execution.aggregateId },
    });
    expect(humanContextBuilder.build(nextSnapshot).currentPlans.diet).toEqual(
      expect.objectContaining({ value: generated.output.plan.title }),
    );
    expect(
      goalPlanner.plan({
        snapshot: nextSnapshot,
        adaptiveDecision: {
          readiness: [],
        } as unknown as ProfileAcquisitionDecision,
        recognizedIntent: CONVERSATION_RECOGNIZED_INTENT.CURRENT_PLAN_REQUEST,
        completion: nextSnapshot.completion,
        conversationContext: {
          planTarget: 'DIET',
          progressContextAvailable: false,
          confirmationRequired: false,
        },
        recentHistory: { currentLogicalTurn: 2, entries: [] },
      }),
    ).toMatchObject({
      goal: 'SHOW_CURRENT_PLAN',
      reason: 'CURRENT_PLAN_AVAILABLE',
      targetPlan: 'DIET',
    });
    expect(readiness.evaluate(nextSnapshot, 'PLAN_REVIEW', true)).toMatchObject(
      {
        availableFields: expect.arrayContaining(['CURRENT_DIET']),
      },
    );
    await expect(
      prisma.aIJob.findUniqueOrThrow({
        where: { id: jobId },
        select: { status: true },
      }),
    ).resolves.toEqual({ status: AIJobStatus.COMPLETED });
  });

  it('keeps all four ownership transitions atomic and retries idempotent', async () => {
    const firstV2 = await seedOwnership('6', 'integration-transition-v2-a');
    const firstV2Result = await service.persist(firstV2);
    const dietGenerator = new DietGeneratorService(
      prisma as unknown as PrismaService,
      {} as SubscriptionsService,
      aiService as unknown as AIService,
      auditService,
      ownershipService,
    );

    const firstLegacy = await legacyCandidate(firstV2.ownership, '61');
    const firstLegacyPlan = await dietGenerator.commitCandidate(firstLegacy);
    await expect(
      currentReader.getCurrent(firstV2.ownership.userId),
    ).resolves.toMatchObject({
      implementation: 'LEGACY',
      id: firstLegacyPlan.id,
    });

    const secondLegacy = await legacyCandidate(firstV2.ownership, '62');
    const secondLegacyPlan = await dietGenerator.commitCandidate(secondLegacy);
    await expect(
      dietGenerator.commitCandidate(secondLegacy),
    ).resolves.toMatchObject({ id: secondLegacyPlan.id });
    await expect(
      prisma.dietPlan.findMany({
        where: { userId: firstV2.ownership.userId },
        orderBy: { generatedAt: 'asc' },
        select: { id: true, status: true },
      }),
    ).resolves.toEqual([
      { id: firstLegacyPlan.id, status: 'ARCHIVED' },
      { id: secondLegacyPlan.id, status: 'ACTIVE' },
    ]);

    const secondV2JobId = 'nutrition-v2-integration-transition-v2-b-job';
    await prisma.aIJob.create({
      data: {
        id: secondV2JobId,
        userId: firstV2.ownership.userId,
        type: AIJobType.DIET,
        status: AIJobStatus.PROCESSING,
        promptVersionId: 'nutrition-v2-integration-prompt',
        operationKey: 'integration-transition-v2-b',
        startedAt: new Date(),
      },
    });
    const secondV2: PersistNutritionPlanV2Input = {
      ownership: firstV2.ownership,
      generation: pendingGeneration(
        firstV2.ownership.userId,
        secondV2JobId,
        'integration-transition-v2-b',
      ),
    };
    const secondV2Result = await service.persist(secondV2);
    await expect(service.persist(secondV2)).resolves.toMatchObject({
      persistence: 'REUSED',
      aggregate: { id: secondV2Result.aggregate.id },
    });

    await expect(
      prisma.nutritionPlanOwnership.findUniqueOrThrow({
        where: { userId: firstV2.ownership.userId },
        select: { implementation: true, planId: true },
      }),
    ).resolves.toEqual({
      implementation: 'V2',
      planId: secondV2Result.aggregate.id,
    });
    await expect(
      currentReader.getCurrent(firstV2.ownership.userId),
    ).resolves.toMatchObject({
      implementation: 'V2',
      id: secondV2Result.aggregate.id,
    });
    await expect(
      currentReader.listHistory(firstV2.ownership.userId, 10),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          implementation: 'LEGACY',
          id: firstLegacyPlan.id,
        }),
        expect.objectContaining({
          implementation: 'LEGACY',
          id: secondLegacyPlan.id,
        }),
        expect.objectContaining({
          implementation: 'V2',
          id: firstV2Result.aggregate.id,
        }),
        expect.objectContaining({
          implementation: 'V2',
          id: secondV2Result.aggregate.id,
        }),
      ]),
    );
    const snapshot = await snapshotBuilder.build(
      firstV2.ownership.userId,
      new Date('2026-08-07T14:00:00.000Z'),
    );
    expect(snapshot.plans.currentNutritionPlan).toMatchObject({
      value: { implementation: 'V2', id: secondV2Result.aggregate.id },
    });
    await expect(
      prisma.aIJob.count({
        where: {
          userId: firstV2.ownership.userId,
          status: AIJobStatus.COMPLETED,
        },
      }),
    ).resolves.toBe(4);
    await expect(
      prisma.auditLog.count({
        where: {
          userId: firstV2.ownership.userId,
          entityType: { in: ['DIET_PLAN', 'NUTRITION_PLAN_V2'] },
        },
      }),
    ).resolves.toBe(4);
  });

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
    const ownership = await prisma.nutritionPlanOwnership.findUniqueOrThrow({
      where: { userId: input.ownership.userId },
    });
    expect(ownership).toMatchObject({
      implementation: 'V2',
      planId: results[0].aggregate.id,
      profileId: input.ownership.profileId,
    });
    await expect(
      currentReader.getCurrent(input.ownership.userId),
    ).resolves.toMatchObject({
      implementation: 'V2',
      id: results[0].aggregate.id,
    });
    const snapshot = await snapshotBuilder.build(
      input.ownership.userId,
      new Date('2026-08-07T12:00:00.000Z'),
    );
    expect(snapshot.plans.currentNutritionPlan).toMatchObject({
      value: { implementation: 'V2', id: results[0].aggregate.id },
    });
    expect(humanContextBuilder.build(snapshot).currentPlans.diet).toMatchObject(
      {
        value: results[0].aggregate.document.title,
      },
    );
    await expect(
      prisma.dietPlan.count({ where: { userId: input.ownership.userId } }),
    ).resolves.toBe(0);
    await expect(
      prisma.nutritionPlanOwnership.create({
        data: {
          userId: input.ownership.userId,
          profileId: input.ownership.profileId,
          implementation: 'V2',
          planId: 'duplicate-owner-plan-id',
        },
      }),
    ).rejects.toThrow();
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
      ownershipService,
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
