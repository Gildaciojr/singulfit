import { ConflictException } from '@nestjs/common';
import {
  NutritionShadowComparisonDivergence,
  NutritionShadowOutputKind,
  PrismaClient,
} from '@prisma/client';
import type { PersistNutritionShadowComparisonInput } from './nutrition-shadow-comparison.repository';
import { PrismaNutritionShadowComparisonGateway } from './prisma-nutrition-shadow-comparison.gateway';

const databaseUrl =
  process.env.NUTRITION_SHADOW_COMPARISON_INTEGRATION_DATABASE_URL;
const safeDatabaseUrl =
  databaseUrl ?? 'postgresql://disabled:disabled@127.0.0.1:1/disabled';
const describeIntegration = databaseUrl ? describe : describe.skip;

describeIntegration(
  'Nutrition Shadow comparison persistence integration',
  () => {
    const prisma = new PrismaClient({
      datasources: { db: { url: safeDatabaseUrl } },
    });
    const gateway = new PrismaNutritionShadowComparisonGateway(prisma);
    let functionalCounts: readonly [number, number, number, number];

    const input = (
      fingerprint = 'input-fingerprint',
    ): PersistNutritionShadowComparisonInput => ({
      operationKey: 'comparison-operation-key',
      inputFingerprint: fingerprint,
      conversationId: 'conversation-id',
      messageId: 'message-id',
      shadowRunId: 'shadow-run-id',
      conversationGoal: 'GENERATE_DIET_PLAN',
      expectedArtifactType: 'WEEKLY_PLAN',
      actualArtifactType: 'WEEKLY_PLAN',
      expectedKind: NutritionShadowOutputKind.PLAN,
      actualKind: NutritionShadowOutputKind.PLAN,
      equivalent: true,
      structuralScore: 100,
      semanticScore: 100,
      operationalScore: 100,
      overallScore: 100,
      divergences: [],
      legacyDurationMs: 100,
      shadowDurationMs: 90,
      legacyTokens: 100,
      shadowTokens: 90,
      legacyCostUsd: '0.01000000',
      shadowCostUsd: '0.00900000',
      timeRatio: '0.90000000',
      tokenRatio: '0.90000000',
      costRatio: '0.90000000',
      legacyProvider: 'OPENAI',
      shadowProvider: 'OPENAI',
      legacyModel: 'legacy-model',
      shadowModel: 'shadow-model',
      legacyHash: 'legacy-hash',
      shadowHash: 'shadow-hash',
    });

    beforeEach(async () => {
      await prisma.nutritionShadowComparison.deleteMany();
      functionalCounts = await Promise.all([
        prisma.nutritionShadowRun.count(),
        prisma.aIJob.count(),
        prisma.nutritionPlanV2.count(),
        prisma.nutritionConversationalArtifact.count(),
      ]);
    });

    afterEach(async () => {
      await expect(
        Promise.all([
          prisma.nutritionShadowRun.count(),
          prisma.aIJob.count(),
          prisma.nutritionPlanV2.count(),
          prisma.nutritionConversationalArtifact.count(),
        ]),
      ).resolves.toEqual(functionalCounts);
    });

    afterAll(async () => prisma.$disconnect());

    it('persists all comparison dimensions and is idempotent', async () => {
      const first = await gateway.persist(input());
      expect(first.reused).toBe(false);
      await expect(gateway.persist(input())).resolves.toMatchObject({
        comparison: { id: first.comparison.id },
        reused: true,
      });
      await expect(gateway.persist(input('different'))).rejects.toBeInstanceOf(
        ConflictException,
      );
      await expect(
        prisma.nutritionShadowComparison.findUniqueOrThrow({
          where: { id: first.comparison.id },
        }),
      ).resolves.toMatchObject({
        equivalent: true,
        structuralScore: 100,
        semanticScore: 100,
        operationalScore: 100,
        overallScore: 100,
        divergences: [],
        shadowRunId: 'shadow-run-id',
        conversationGoal: 'GENERATE_DIET_PLAN',
      });
    });

    it('rolls back invalid scores and protects immutable evidence', async () => {
      await expect(
        gateway.persist({
          ...input(),
          equivalent: false,
          structuralScore: 101,
          divergences: [
            NutritionShadowComparisonDivergence.WRONG_ARTIFACT_TYPE,
          ],
        }),
      ).rejects.toThrow();
      expect(await prisma.nutritionShadowComparison.count()).toBe(0);

      const persisted = await gateway.persist(input());
      await expect(
        prisma.nutritionShadowComparison.update({
          where: { id: persisted.comparison.id },
          data: { overallScore: 99 },
        }),
      ).rejects.toThrow('NutritionShadowComparison is immutable');
    });

    it('serializes concurrent idempotent writes without duplication', async () => {
      const attempts = await Promise.all([
        gateway.persist(input()),
        gateway.persist(input()),
      ]);
      expect(attempts.filter((attempt) => attempt.reused)).toHaveLength(1);
      expect(attempts.filter((attempt) => !attempt.reused)).toHaveLength(1);
      expect(await prisma.nutritionShadowComparison.count()).toBe(1);
    });
  },
);
