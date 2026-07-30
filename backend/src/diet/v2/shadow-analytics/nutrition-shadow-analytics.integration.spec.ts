import {
  NutritionShadowComparisonDivergence,
  NutritionShadowOutputKind,
  NutritionShadowRunStatus,
  NutritionShadowRuntimeDecisionType,
  NutritionShadowRuntimeSkipReason,
  PrismaClient,
} from '@prisma/client';
import { NutritionShadowAnalyticsService } from './nutrition-shadow-analytics.service';
import { PrismaNutritionShadowAnalyticsGateway } from './prisma-nutrition-shadow-analytics.gateway';

const databaseUrl =
  process.env.NUTRITION_SHADOW_ANALYTICS_INTEGRATION_DATABASE_URL;
const safeDatabaseUrl =
  databaseUrl ?? 'postgresql://disabled:disabled@127.0.0.1:1/disabled';
const describeIntegration = databaseUrl ? describe : describe.skip;

describeIntegration('Nutrition Shadow Analytics PostgreSQL read model', () => {
  const prisma = new PrismaClient({
    datasources: { db: { url: safeDatabaseUrl } },
  });
  const gateway = new PrismaNutritionShadowAnalyticsGateway(prisma);
  const service = new NutritionShadowAnalyticsService(gateway);
  const firstDate = new Date('2026-07-29T10:15:00.000Z');
  const secondDate = new Date('2026-07-29T11:15:00.000Z');
  let immutableCounts: readonly [
    number,
    number,
    number,
    number,
    number,
    number,
  ];

  beforeEach(async () => {
    await prisma.nutritionShadowComparison.deleteMany();
    await prisma.nutritionShadowRuntimeDecision.deleteMany();
    await prisma.nutritionShadowRun.deleteMany();
    await fixtures();
    immutableCounts = await counts();
  });

  afterEach(async () => {
    await expect(counts()).resolves.toEqual(immutableCounts);
  });

  afterAll(async () => prisma.$disconnect());

  it('aggregates decisions, runs, comparisons, goals, artifacts and operations without writes', async () => {
    const result = await service.query({
      window: 'CUSTOM',
      from: new Date('2026-07-29T00:00:00.000Z'),
      to: new Date('2026-07-30T00:00:00.000Z'),
      bucket: 'HOUR',
    });

    expect(result.summary).toMatchObject({
      totalDecisions: 3,
      started: 2,
      skipped: 1,
      startedRate: { numerator: 2, denominator: 3, percentage: 66.6667 },
    });
    expect(result.runs).toMatchObject({
      total: 2,
      succeeded: 1,
      failed: 1,
      averageDurationMs: 150,
      p50DurationMs: 150,
      averageRetries: 0.5,
    });
    expect(result.comparisons).toMatchObject({
      total: 2,
      equivalent: 1,
      divergent: 1,
      equivalenceRate: { numerator: 1, denominator: 2, percentage: 50 },
      averageOverallScore: 90,
    });
    expect(result.byConversationGoal).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          conversationGoal: 'GENERATE_DIET_PLAN',
          decisions: 2,
          succeeded: 1,
          failed: 1,
          comparisons: 2,
          equivalent: 1,
        }),
        expect.objectContaining({
          conversationGoal: 'GENERAL_GUIDANCE',
          decisions: 1,
          skipped: 1,
        }),
      ]),
    );
    expect(result.byArtifactType[0]).toMatchObject({
      artifactType: 'WEEKLY_PLAN',
      runs: 2,
      comparisons: 2,
      divergenceCount: 2,
    });
    expect(result.divergences).toEqual([
      expect.objectContaining({
        divergence: NutritionShadowComparisonDivergence.GOAL_MISMATCH,
        count: 1,
      }),
      expect.objectContaining({
        divergence: NutritionShadowComparisonDivergence.WRONG_KIND,
        count: 1,
      }),
    ]);
    expect(result.operational).toMatchObject({
      totalTokens: 300,
      averageTokens: 150,
      totalCostUsd: '0.03000000',
      averageCostUsd: '0.01500000000000000000',
    });
    expect(result.timeSeries).toHaveLength(2);
  });

  it('combines every supported filter without inferring goal or artifact', async () => {
    const result = await service.query({
      window: 'CUSTOM',
      from: new Date('2026-07-29T00:00:00.000Z'),
      to: new Date('2026-07-30T00:00:00.000Z'),
      conversationGoal: 'GENERATE_DIET_PLAN',
      artifactType: 'WEEKLY_PLAN',
      runtimeDecision: NutritionShadowRuntimeDecisionType.STARTED,
      runStatus: NutritionShadowRunStatus.SUCCEEDED,
      equivalent: true,
      provider: 'OPENAI',
      model: 'gpt-shadow',
    });

    expect(result.summary.totalDecisions).toBe(1);
    expect(result.runs.total).toBe(1);
    expect(result.comparisons.total).toBe(1);
    expect(result.byConversationGoal).toHaveLength(1);
    expect(result.byConversationGoal[0].conversationGoal).toBe(
      'GENERATE_DIET_PLAN',
    );
  });

  it('filters skips and produces hour, day and week series from persisted timestamps', async () => {
    const skipped = await service.query({
      window: 'CUSTOM',
      from: new Date('2026-07-29T00:00:00.000Z'),
      to: new Date('2026-07-30T00:00:00.000Z'),
      runtimeDecision: NutritionShadowRuntimeDecisionType.SKIPPED,
      skipReason: NutritionShadowRuntimeSkipReason.DISABLED_BY_POLICY,
    });
    expect(skipped.summary).toMatchObject({ totalDecisions: 1, skipped: 1 });
    expect(skipped.runs.total).toBe(0);

    for (const bucket of ['HOUR', 'DAY', 'WEEK'] as const) {
      const result = await service.query({
        window: 'CUSTOM',
        from: new Date('2026-07-29T00:00:00.000Z'),
        to: new Date('2026-07-30T00:00:00.000Z'),
        bucket,
      });
      expect(result.timeSeries.length).toBe(bucket === 'HOUR' ? 2 : 1);
    }
  });

  async function fixtures(): Promise<void> {
    const succeeded = await prisma.nutritionShadowRun.create({
      data: {
        id: 'analytics-run-succeeded',
        operationKey: 'analytics-run-succeeded',
        inputFingerprint: 'fingerprint-succeeded',
        correlationId: 'correlation-succeeded',
        userId: 'analytics-user',
        conversationId: 'analytics-conversation',
        messageId: 'analytics-message-1',
        conversationGoal: 'GENERATE_DIET_PLAN',
        status: NutritionShadowRunStatus.SUCCEEDED,
        artifactType: 'WEEKLY_PLAN',
        kind: NutritionShadowOutputKind.PLAN,
        provider: 'OPENAI',
        model: 'gpt-shadow',
        attempts: 1,
        promptTokens: 100,
        completionTokens: 100,
        totalTokens: 200,
        estimatedCostUsd: '0.02000000',
        totalDurationMs: 100,
        document: { kind: 'PLAN', artifactType: 'WEEKLY_PLAN' },
        documentHash: 'hash-succeeded',
        completedAt: firstDate,
        createdAt: firstDate,
      },
    });
    const failed = await prisma.nutritionShadowRun.create({
      data: {
        id: 'analytics-run-failed',
        operationKey: 'analytics-run-failed',
        inputFingerprint: 'fingerprint-failed',
        correlationId: 'correlation-failed',
        userId: 'analytics-user',
        conversationId: 'analytics-conversation',
        messageId: 'analytics-message-2',
        conversationGoal: 'GENERATE_DIET_PLAN',
        status: NutritionShadowRunStatus.FAILED,
        artifactType: 'WEEKLY_PLAN',
        provider: 'OPENAI',
        model: 'gpt-shadow',
        attempts: 2,
        promptTokens: 50,
        completionTokens: 50,
        totalTokens: 100,
        estimatedCostUsd: '0.01000000',
        totalDurationMs: 200,
        errorCategory: 'PROVIDER_ERROR',
        errorMessage: 'provider unavailable',
        completedAt: secondDate,
        createdAt: secondDate,
      },
    });
    await prisma.nutritionShadowRuntimeDecision.createMany({
      data: [
        {
          id: 'analytics-decision-started-1',
          operationKey: 'analytics-decision-started-1',
          inputFingerprint: 'decision-fingerprint-1',
          userId: 'analytics-user',
          conversationId: 'analytics-conversation',
          messageId: 'analytics-message-1',
          correlationId: 'correlation-succeeded',
          conversationGoal: 'GENERATE_DIET_PLAN',
          decision: NutritionShadowRuntimeDecisionType.STARTED,
          shadowRunId: succeeded.id,
          decisionAt: firstDate,
          createdAt: firstDate,
        },
        {
          id: 'analytics-decision-started-2',
          operationKey: 'analytics-decision-started-2',
          inputFingerprint: 'decision-fingerprint-2',
          userId: 'analytics-user',
          conversationId: 'analytics-conversation',
          messageId: 'analytics-message-2',
          correlationId: 'correlation-failed',
          conversationGoal: 'GENERATE_DIET_PLAN',
          decision: NutritionShadowRuntimeDecisionType.STARTED,
          shadowRunId: failed.id,
          decisionAt: secondDate,
          createdAt: secondDate,
        },
        {
          id: 'analytics-decision-skipped',
          operationKey: 'analytics-decision-skipped',
          inputFingerprint: 'decision-fingerprint-skipped',
          userId: 'analytics-user',
          conversationId: 'analytics-conversation',
          messageId: 'analytics-message-3',
          correlationId: 'correlation-skipped',
          conversationGoal: 'GENERAL_GUIDANCE',
          decision: NutritionShadowRuntimeDecisionType.SKIPPED,
          skipReason: NutritionShadowRuntimeSkipReason.DISABLED_BY_POLICY,
          decisionAt: secondDate,
          createdAt: secondDate,
        },
      ],
    });
    await prisma.nutritionShadowComparison.createMany({
      data: [
        comparison(succeeded.id, 'equivalent', true, [], 100, firstDate),
        comparison(
          failed.id,
          'divergent',
          false,
          [
            NutritionShadowComparisonDivergence.GOAL_MISMATCH,
            NutritionShadowComparisonDivergence.WRONG_KIND,
          ],
          80,
          secondDate,
        ),
      ],
    });
  }

  function comparison(
    shadowRunId: string,
    suffix: string,
    equivalent: boolean,
    divergences: NutritionShadowComparisonDivergence[],
    score: number,
    createdAt: Date,
  ) {
    return {
      operationKey: `analytics-comparison-${suffix}`,
      inputFingerprint: `comparison-fingerprint-${suffix}`,
      conversationId: 'analytics-conversation',
      messageId: `analytics-message-${suffix}`,
      shadowRunId,
      conversationGoal: 'GENERATE_DIET_PLAN',
      expectedArtifactType: 'WEEKLY_PLAN' as const,
      actualArtifactType: 'WEEKLY_PLAN' as const,
      expectedKind: NutritionShadowOutputKind.PLAN,
      actualKind: NutritionShadowOutputKind.PLAN,
      equivalent,
      structuralScore: score,
      semanticScore: score,
      operationalScore: score,
      overallScore: score,
      divergences,
      shadowDurationMs: 100,
      shadowTokens: 100,
      shadowCostUsd: '0.01000000',
      shadowProvider: 'OPENAI',
      shadowModel: 'gpt-shadow',
      legacyHash: `legacy-${suffix}`,
      shadowHash: `shadow-${suffix}`,
      createdAt,
    };
  }

  function counts() {
    return Promise.all([
      prisma.nutritionShadowRuntimeDecision.count(),
      prisma.nutritionShadowRun.count(),
      prisma.nutritionShadowComparison.count(),
      prisma.aIJob.count(),
      prisma.nutritionPlanV2.count(),
      prisma.nutritionConversationalArtifact.count(),
    ]);
  }
});
