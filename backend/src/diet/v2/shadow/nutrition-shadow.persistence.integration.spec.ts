import { ConflictException } from '@nestjs/common';
import {
  NutritionShadowOutputKind,
  NutritionShadowRunStatus,
  PrismaClient,
} from '@prisma/client';
import { PrismaNutritionShadowGateway } from './prisma-nutrition-shadow.gateway';

const databaseUrl = process.env.NUTRITION_SHADOW_INTEGRATION_DATABASE_URL;
const safeDatabaseUrl =
  databaseUrl ?? 'postgresql://disabled:disabled@127.0.0.1:1/disabled';
const describeIntegration = databaseUrl ? describe : describe.skip;

describeIntegration('Nutrition Shadow persistence integration', () => {
  const prisma = new PrismaClient({
    datasources: { db: { url: safeDatabaseUrl } },
  });
  const gateway = new PrismaNutritionShadowGateway(prisma);

  let functionalCounts: readonly [number, number, number];
  beforeEach(async () => {
    await prisma.nutritionShadowRuntimeDecision.deleteMany();
    await prisma.nutritionShadowRun.deleteMany();
    functionalCounts = await Promise.all([
      prisma.aIJob.count(),
      prisma.nutritionPlanV2.count(),
      prisma.nutritionConversationalArtifact.count(),
    ]);
  });
  afterEach(async () => {
    await expect(
      Promise.all([
        prisma.aIJob.count(),
        prisma.nutritionPlanV2.count(),
        prisma.nutritionConversationalArtifact.count(),
      ]),
    ).resolves.toEqual(functionalCounts);
  });
  afterAll(async () => prisma.$disconnect());

  const start = (fingerprint = 'fingerprint') =>
    gateway.start({
      operationKey: 'shadow-operation-key',
      inputFingerprint: fingerprint,
      correlationId: 'correlation-id',
      userId: 'non-functional-shadow-user',
      conversationGoal: 'GENERAL_GUIDANCE',
    });

  it('is idempotent, detects conflicts and protects successful documents', async () => {
    const first = await start();
    const completed = await gateway.succeed(first.run.id, {
      artifactType: 'WEEKLY_PLAN',
      kind: NutritionShadowOutputKind.PLAN,
      provider: 'OPENAI',
      model: 'model',
      promptVersionId: 'prompt-version-id',
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
      estimatedCostUsd: '0.00000100',
      costCurrency: 'USD',
      builderDurationMs: 1,
      strategyDurationMs: 2,
      providerDurationMs: 3,
      parsingDurationMs: 4,
      validationDurationMs: 5,
      persistenceDurationMs: null,
      totalDurationMs: 20,
      document: { kind: 'PLAN', artifactType: 'WEEKLY_PLAN' },
      documentHash: 'hash',
      resultSummary: 'Plano',
      activePlanReference: null,
    });
    expect(completed.status).toBe(NutritionShadowRunStatus.SUCCEEDED);
    await expect(start()).resolves.toMatchObject({ reused: true });
    await expect(start('different')).rejects.toBeInstanceOf(ConflictException);
    await expect(
      prisma.nutritionShadowRun.update({
        where: { id: completed.id },
        data: { resultSummary: 'mutated' },
      }),
    ).rejects.toThrow('Succeeded NutritionShadowRun is immutable');
  });

  it('retries a failed run without duplicating its identity', async () => {
    const first = await start();
    await gateway.fail(first.run.id, {
      category: 'PROVIDER_ERROR',
      code: 'BadGatewayException',
      message: 'provider unavailable',
      totalDurationMs: 10,
      builderDurationMs: 1,
      strategyDurationMs: 2,
    });
    const retry = await start();
    expect(retry.run.id).toBe(first.run.id);
    expect(retry.run.status).toBe(NutritionShadowRunStatus.RUNNING);
    expect(await prisma.nutritionShadowRun.count()).toBe(1);
  });

  it('serializes concurrent attempts and never duplicates the operation key', async () => {
    const attempts = await Promise.allSettled([start(), start()]);
    expect(
      attempts.filter((attempt) => attempt.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      attempts.filter((attempt) => attempt.status === 'rejected'),
    ).toHaveLength(1);
    expect(await prisma.nutritionShadowRun.count()).toBe(1);
  });
});
