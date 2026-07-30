import {
  NutritionShadowOutputKind,
  NutritionShadowRunStatus,
  PrismaClient,
} from '@prisma/client';
import { PrismaNutritionShadowRuntimeResultReader } from './prisma-nutrition-shadow-runtime-result.reader';

const databaseUrl =
  process.env.NUTRITION_SHADOW_RUNTIME_INTEGRATION_DATABASE_URL;
const safeDatabaseUrl =
  databaseUrl ?? 'postgresql://disabled:disabled@127.0.0.1:1/disabled';
const describeIntegration = databaseUrl ? describe : describe.skip;

describeIntegration(
  'Nutrition Shadow Runtime result reader integration',
  () => {
    const prisma = new PrismaClient({
      datasources: { db: { url: safeDatabaseUrl } },
    });
    const reader = new PrismaNutritionShadowRuntimeResultReader(prisma);
    let officialCounts: readonly [number, number, number];

    beforeEach(async () => {
      await prisma.nutritionShadowComparison.deleteMany();
      await prisma.nutritionShadowRuntimeDecision.deleteMany();
      await prisma.nutritionShadowRun.deleteMany();
      officialCounts = await Promise.all([
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
      ).resolves.toEqual(officialCounts);
    });

    afterAll(async () => prisma.$disconnect());

    it('reads only an already completed canonical Shadow result', async () => {
      const run = await prisma.nutritionShadowRun.create({
        data: {
          operationKey: 'runtime-reader-operation',
          inputFingerprint: 'runtime-reader-fingerprint',
          correlationId: 'correlation-id',
          userId: 'shadow-user',
          conversationId: 'conversation-id',
          messageId: 'message-id',
          conversationGoal: 'GENERAL_GUIDANCE',
          status: NutritionShadowRunStatus.SUCCEEDED,
          artifactType: 'POINT_GUIDANCE',
          kind: NutritionShadowOutputKind.CONVERSATIONAL_ARTIFACT,
          provider: 'OPENAI',
          model: 'model',
          attempts: 1,
          totalTokens: 12,
          estimatedCostUsd: '0.00100000',
          totalDurationMs: 20,
          document: {
            kind: 'CONVERSATIONAL_ARTIFACT',
            artifactType: 'POINT_GUIDANCE',
            artifact: { guidance: { text: 'orientação' } },
          },
          documentHash: 'document-hash',
          completedAt: new Date(),
        },
      });

      await expect(reader.findSucceeded(run.id)).resolves.toEqual({
        shadowRunId: run.id,
        conversationGoal: 'GENERAL_GUIDANCE',
        artifactType: 'POINT_GUIDANCE',
        kind: NutritionShadowOutputKind.CONVERSATIONAL_ARTIFACT,
        document: {
          kind: 'CONVERSATIONAL_ARTIFACT',
          artifactType: 'POINT_GUIDANCE',
          artifact: { guidance: { text: 'orientação' } },
        },
        documentHash: 'document-hash',
        durationMs: 20,
        provider: 'OPENAI',
        model: 'model',
        totalTokens: 12,
        estimatedCostUsd: '0.00100000',
        attempts: 1,
        parserSucceeded: true,
        validationSucceeded: true,
      });
      expect(await prisma.nutritionShadowRun.count()).toBe(1);
    });

    it('does not expose incomplete or failed runs to the Comparator', async () => {
      const failed = await prisma.nutritionShadowRun.create({
        data: {
          operationKey: 'runtime-reader-failed',
          inputFingerprint: 'runtime-reader-failed-fingerprint',
          correlationId: 'correlation-id',
          userId: 'shadow-user',
          conversationGoal: 'GENERAL_GUIDANCE',
          status: NutritionShadowRunStatus.FAILED,
          attempts: 1,
          errorCategory: 'PROVIDER_ERROR',
          errorMessage: 'provider unavailable',
          completedAt: new Date(),
        },
      });

      await expect(reader.findSucceeded(failed.id)).resolves.toBeNull();
    });
  },
);
