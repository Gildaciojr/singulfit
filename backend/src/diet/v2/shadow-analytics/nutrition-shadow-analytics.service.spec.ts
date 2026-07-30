import type { NutritionShadowAnalyticsRepository } from './nutrition-shadow-analytics.repository';
import { NutritionShadowAnalyticsService } from './nutrition-shadow-analytics.service';

describe(NutritionShadowAnalyticsService.name, () => {
  const summary = (
    values?: Partial<
      Record<'total' | 'first' | 'second' | 'third' | 'fourth', bigint>
    >,
  ) => ({
    total: values?.total ?? 0n,
    first: values?.first ?? 0n,
    second: values?.second ?? 0n,
    third: values?.third ?? 0n,
    fourth: values?.fourth ?? 0n,
    averageFirst: null,
    averageSecond: null,
    averageThird: null,
    averageFourth: null,
  });
  const count = (key: string, total: bigint) => ({
    key,
    total,
    first: 0n,
    second: 0n,
    third: 0n,
    fourth: 0n,
    average: null,
    divergenceCount: 0n,
  });

  function setup(populated = false) {
    const decisions = populated
      ? summary({ total: 4n, first: 3n, second: 1n })
      : summary();
    const runs = {
      ...(populated
        ? summary({ total: 3n, first: 2n, second: 1n })
        : summary()),
      averageFirst: populated ? 20 : null,
      averageSecond: populated ? 0.5 : null,
      p50: populated ? 18 : null,
      p95: populated ? 29 : null,
      p99: populated ? 30 : null,
    };
    const comparisons = populated
      ? {
          ...summary({ total: 2n, first: 1n, second: 1n }),
          averageFirst: 90,
          averageSecond: 80,
          averageThird: 70,
          averageFourth: 80,
        }
      : summary();
    const snapshot = {
      decisions,
      runs,
      comparisons,
      goals: populated
        ? [
            {
              ...count('GENERATE_DIET_PLAN', 4n),
              first: 3n,
              second: 1n,
              third: 2n,
              fourth: 1n,
              divergenceCount: 2n,
              equivalentCount: 1n,
              average: 80,
            },
          ]
        : [],
      artifacts: populated
        ? [
            {
              ...count('WEEKLY_PLAN', 3n),
              first: 2n,
              second: 1n,
              third: 1n,
              divergenceCount: 3n,
              average: 80,
            },
          ]
        : [],
      decisionDistribution: populated
        ? [count('STARTED', 3n), count('SKIPPED', 1n)]
        : [],
      skipReasons: populated ? [count('DISABLED_BY_POLICY', 1n)] : [],
      divergences: populated
        ? [count('GOAL_MISMATCH', 2n), count('WRONG_KIND', 1n)]
        : [],
      providers: populated ? [count('OPENAI', 3n)] : [],
      models: populated ? [count('gpt-model', 3n)] : [],
      operational: {
        totalTokens: populated ? 300n : 0n,
        averageTokens: populated ? 100 : null,
        totalCostUsd: populated ? '0.03000000' : '0',
        averageCostUsd: populated ? '0.01000000' : '0',
      },
      decisionSeries: populated
        ? [
            {
              bucketStart: new Date('2026-07-29T10:00:00.000Z'),
              total: 4n,
              first: 3n,
              second: 1n,
            },
          ]
        : [],
      runSeries: [],
      comparisonSeries: [],
    };
    const repository = {
      read: jest.fn(() => Promise.resolve(snapshot)),
    };
    return {
      repository,
      snapshot,
      service: new NutritionShadowAnalyticsService(
        repository as unknown as NutritionShadowAnalyticsRepository,
      ),
    };
  }

  it('returns explicit zero denominators for an empty read model', async () => {
    const test = setup();
    const result = await test.service.query(
      { window: 'LAST_24_HOURS' },
      new Date('2026-07-30T00:00:00.000Z'),
    );

    expect(result.summary).toMatchObject({
      totalDecisions: 0,
      startedRate: { numerator: 0, denominator: 0, percentage: 0 },
      shadowCoverage: { numerator: 0, denominator: 0, percentage: 0 },
    });
    expect(result.comparisons.equivalenceRate.denominator).toBe(0);
    expect(result.timeSeries).toEqual([]);
  });

  it('calculates percentages, rankings, dimensions and merged time series', async () => {
    const test = setup(true);
    const result = await test.service.query(
      {
        window: 'LAST_7_DAYS',
        bucket: 'HOUR',
        conversationGoal: 'GENERATE_DIET_PLAN',
        artifactType: 'WEEKLY_PLAN',
        provider: ' OPENAI ',
      },
      new Date('2026-07-30T00:00:00.000Z'),
    );

    expect(result.summary.startedRate).toEqual({
      numerator: 3,
      denominator: 4,
      percentage: 75,
    });
    expect(result.runs.successRate.percentage).toBeCloseTo(66.6667, 4);
    expect(result.comparisons.equivalenceRate.percentage).toBe(50);
    expect(result.byConversationGoal[0]).toMatchObject({
      conversationGoal: 'GENERATE_DIET_PLAN',
      comparisons: 2,
      equivalent: 1,
      averageScore: 80,
    });
    expect(result.byArtifactType[0]).toMatchObject({
      artifactType: 'WEEKLY_PLAN',
      runs: 3,
      divergenceCount: 3,
    });
    expect(result.divergences.map((item) => item.divergence)).toEqual([
      'GOAL_MISMATCH',
      'WRONG_KIND',
    ]);
    expect(result.operational.providers[0].shareOfRuns.percentage).toBe(100);
    expect(result.timeSeries[0]).toMatchObject({ decisions: 4, started: 3 });
    expect(test.repository.read.mock.calls[0][0]).toMatchObject({
      bucket: 'HOUR',
      provider: 'OPENAI',
      conversationGoal: 'GENERATE_DIET_PLAN',
      artifactType: 'WEEKLY_PLAN',
    });
  });

  it('validates custom ranges and supports 30-day windows', async () => {
    const test = setup();
    await expect(test.service.query({ window: 'CUSTOM' })).rejects.toThrow(
      'Intervalo customizado exige datas inicial e final',
    );
    await expect(test.service.query({ provider: ' ' })).rejects.toThrow(
      'Filtro provider não pode ser vazio',
    );

    await test.service.query(
      { window: 'LAST_30_DAYS', bucket: 'WEEK' },
      new Date('2026-07-30T00:00:00.000Z'),
    );
    expect(test.repository.read.mock.calls[0][0]).toMatchObject({
      from: new Date('2026-06-30T00:00:00.000Z'),
      to: new Date('2026-07-30T00:00:00.000Z'),
      bucket: 'WEEK',
    });
  });

  it('preserves every official goal, artifact and skip reason exactly as persisted', async () => {
    const test = setup();
    test.repository.read.mockResolvedValueOnce({
      ...test.snapshot,
      decisions: summary({
        total: BigInt(Object.keys(CONVERSATION_GOAL).length),
        second: BigInt(Object.keys(NutritionShadowRuntimeSkipReason).length),
      }),
      goals: Object.values(CONVERSATION_GOAL).map((goal) => count(goal, 1n)),
      artifacts: Object.values(NutritionArtifactType).map((artifact) =>
        count(artifact, 1n),
      ),
      skipReasons: Object.values(NutritionShadowRuntimeSkipReason).map(
        (reason) => count(reason, 1n),
      ),
    });

    const result = await test.service.query(
      { window: 'LAST_24_HOURS' },
      new Date('2026-07-30T00:00:00.000Z'),
    );
    expect(
      result.byConversationGoal.map((row) => row.conversationGoal),
    ).toEqual(Object.values(CONVERSATION_GOAL));
    expect(result.byArtifactType.map((row) => row.artifactType)).toEqual(
      Object.values(NutritionArtifactType),
    );
    expect(result.skipReasons.map((row) => row.reason).sort()).toEqual(
      Object.values(NutritionShadowRuntimeSkipReason).sort(),
    );
  });
});
import {
  NutritionArtifactType,
  NutritionShadowRuntimeSkipReason,
} from '@prisma/client';
import { CONVERSATION_GOAL } from '../../../context/conversation-goal-planner.contract';
