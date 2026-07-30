import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import type { NutritionShadowAnalyticsFilters } from './nutrition-shadow-analytics.contract';
import type {
  NutritionShadowAnalyticsRepository,
  NutritionShadowAnalyticsSnapshot,
  NutritionShadowCountRow,
  NutritionShadowOperationalRow,
  NutritionShadowRunAggregateRow,
  NutritionShadowSummaryRow,
  NutritionShadowTimeRow,
} from './nutrition-shadow-analytics.repository';

@Injectable()
export class PrismaNutritionShadowAnalyticsGateway implements NutritionShadowAnalyticsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async read(
    filters: NutritionShadowAnalyticsFilters,
  ): Promise<NutritionShadowAnalyticsSnapshot> {
    const decisionWhere = this.decisionWhere(filters);
    const runWhere = this.runWhere(filters);
    const comparisonWhere = this.comparisonWhere(filters);
    const bucket = this.bucket(filters.bucket);

    const [
      decisions,
      runs,
      comparisons,
      goalDecisions,
      goalRuns,
      goalComparisons,
      artifactRuns,
      artifactComparisons,
      decisionDistribution,
      skipReasons,
      divergences,
      providers,
      models,
      operational,
      decisionSeries,
      runSeries,
      comparisonSeries,
    ] = await Promise.all([
      this.one<NutritionShadowSummaryRow>(Prisma.sql`
        SELECT COUNT(*) AS total,
          COUNT(*) FILTER (WHERE d."decision" = 'STARTED') AS first,
          COUNT(*) FILTER (WHERE d."decision" = 'SKIPPED') AS second,
          COUNT(*) FILTER (WHERE d."decision" = 'PENDING') AS third,
          0::bigint AS fourth,
          NULL::float8 AS "averageFirst", NULL::float8 AS "averageSecond",
          NULL::float8 AS "averageThird", NULL::float8 AS "averageFourth"
        FROM "nutrition_shadow_runtime_decisions" d WHERE ${decisionWhere}
      `),
      this.one<NutritionShadowRunAggregateRow>(Prisma.sql`
        SELECT COUNT(*) AS total,
          COUNT(*) FILTER (WHERE r."status" = 'SUCCEEDED') AS first,
          COUNT(*) FILTER (WHERE r."status" = 'FAILED') AS second,
          COUNT(*) FILTER (WHERE r."status" = 'PENDING') AS third,
          COUNT(*) FILTER (WHERE r."status" = 'RUNNING') AS fourth,
          AVG(r."totalDurationMs")::float8 AS "averageFirst",
          AVG(GREATEST(r."attempts" - 1, 0))::float8 AS "averageSecond",
          NULL::float8 AS "averageThird", NULL::float8 AS "averageFourth",
          percentile_cont(0.50) WITHIN GROUP (ORDER BY r."totalDurationMs")::float8 AS p50,
          percentile_cont(0.95) WITHIN GROUP (ORDER BY r."totalDurationMs")::float8 AS p95,
          percentile_cont(0.99) WITHIN GROUP (ORDER BY r."totalDurationMs")::float8 AS p99
        FROM "nutrition_shadow_runs" r WHERE ${runWhere}
      `),
      this.one<NutritionShadowSummaryRow>(Prisma.sql`
        SELECT COUNT(*) AS total,
          COUNT(*) FILTER (WHERE c."equivalent") AS first,
          COUNT(*) FILTER (WHERE NOT c."equivalent") AS second,
          0::bigint AS third, 0::bigint AS fourth,
          AVG(c."structuralScore")::float8 AS "averageFirst",
          AVG(c."semanticScore")::float8 AS "averageSecond",
          AVG(c."operationalScore")::float8 AS "averageThird",
          AVG(c."overallScore")::float8 AS "averageFourth"
        FROM "nutrition_shadow_comparisons" c WHERE ${comparisonWhere}
      `),
      this.rows(Prisma.sql`
        SELECT d."conversationGoal" AS key, COUNT(*) AS total,
          COUNT(*) FILTER (WHERE d."decision" = 'STARTED') AS first,
          COUNT(*) FILTER (WHERE d."decision" = 'SKIPPED') AS second,
          0::bigint AS third, 0::bigint AS fourth, NULL::float8 AS average,
          0::bigint AS "divergenceCount"
        FROM "nutrition_shadow_runtime_decisions" d WHERE ${decisionWhere}
        GROUP BY d."conversationGoal"
      `),
      this.rows(Prisma.sql`
        SELECT r."conversationGoal" AS key, COUNT(*) AS total,
          COUNT(*) FILTER (WHERE r."status" = 'SUCCEEDED') AS first,
          COUNT(*) FILTER (WHERE r."status" = 'FAILED') AS second,
          0::bigint AS third, 0::bigint AS fourth, NULL::float8 AS average,
          0::bigint AS "divergenceCount"
        FROM "nutrition_shadow_runs" r WHERE ${runWhere} AND r."conversationGoal" IS NOT NULL
        GROUP BY r."conversationGoal"
      `),
      this.rows(Prisma.sql`
        SELECT c."conversationGoal" AS key, COUNT(*) AS total,
          COUNT(*) FILTER (WHERE c."equivalent") AS first,
          COUNT(*) FILTER (WHERE NOT c."equivalent") AS second,
          0::bigint AS third, 0::bigint AS fourth,
          AVG(c."overallScore")::float8 AS average,
          COALESCE(SUM(cardinality(c."divergences")), 0)::bigint AS "divergenceCount"
        FROM "nutrition_shadow_comparisons" c WHERE ${comparisonWhere}
          AND c."conversationGoal" IS NOT NULL
        GROUP BY c."conversationGoal"
      `),
      this.rows(Prisma.sql`
        SELECT r."artifactType"::text AS key, COUNT(*) AS total,
          0::bigint AS first, 0::bigint AS second, 0::bigint AS third,
          0::bigint AS fourth, NULL::float8 AS average,
          0::bigint AS "divergenceCount"
        FROM "nutrition_shadow_runs" r WHERE ${runWhere} AND r."artifactType" IS NOT NULL
        GROUP BY r."artifactType"
      `),
      this.rows(Prisma.sql`
        SELECT c."actualArtifactType"::text AS key, COUNT(*) AS total,
          COUNT(*) FILTER (WHERE c."equivalent") AS first,
          COUNT(*) FILTER (WHERE NOT c."equivalent") AS second,
          0::bigint AS third, 0::bigint AS fourth,
          AVG(c."overallScore")::float8 AS average,
          COALESCE(SUM(cardinality(c."divergences")), 0)::bigint AS "divergenceCount"
        FROM "nutrition_shadow_comparisons" c WHERE ${comparisonWhere}
        GROUP BY c."actualArtifactType"
      `),
      this.rows(Prisma.sql`
        SELECT d."decision"::text AS key, COUNT(*) AS total,
          0::bigint AS first, 0::bigint AS second, 0::bigint AS third,
          0::bigint AS fourth, NULL::float8 AS average,
          0::bigint AS "divergenceCount"
        FROM "nutrition_shadow_runtime_decisions" d WHERE ${decisionWhere}
        GROUP BY d."decision"
      `),
      this.rows(Prisma.sql`
        SELECT d."skipReason"::text AS key, COUNT(*) AS total,
          0::bigint AS first, 0::bigint AS second, 0::bigint AS third,
          0::bigint AS fourth, NULL::float8 AS average,
          0::bigint AS "divergenceCount"
        FROM "nutrition_shadow_runtime_decisions" d WHERE ${decisionWhere}
          AND d."decision" = 'SKIPPED' AND d."skipReason" IS NOT NULL
        GROUP BY d."skipReason"
      `),
      this.rows(Prisma.sql`
        SELECT divergence::text AS key, COUNT(*) AS total,
          0::bigint AS first, 0::bigint AS second, 0::bigint AS third,
          0::bigint AS fourth, NULL::float8 AS average,
          0::bigint AS "divergenceCount"
        FROM "nutrition_shadow_comparisons" c
        CROSS JOIN LATERAL unnest(c."divergences") divergence
        WHERE ${comparisonWhere} GROUP BY divergence
      `),
      this.dimension('provider', runWhere),
      this.dimension('model', runWhere),
      this.one<NutritionShadowOperationalRow>(Prisma.sql`
        SELECT COALESCE(SUM(r."totalTokens"), 0)::bigint AS "totalTokens",
          AVG(r."totalTokens")::float8 AS "averageTokens",
          COALESCE(SUM(r."estimatedCostUsd"), 0)::text AS "totalCostUsd",
          COALESCE(AVG(r."estimatedCostUsd"), 0)::text AS "averageCostUsd"
        FROM "nutrition_shadow_runs" r WHERE ${runWhere}
      `),
      this.timeRows('decision', bucket, decisionWhere),
      this.timeRows('run', bucket, runWhere),
      this.timeRows('comparison', bucket, comparisonWhere),
    ]);

    return Object.freeze({
      decisions,
      runs,
      comparisons,
      goals: this.mergeGoals(goalDecisions, goalRuns, goalComparisons),
      artifacts: this.mergeArtifacts(artifactRuns, artifactComparisons),
      decisionDistribution,
      skipReasons,
      divergences,
      providers,
      models,
      operational,
      decisionSeries,
      runSeries,
      comparisonSeries,
    });
  }

  private decisionWhere(filters: NutritionShadowAnalyticsFilters): Prisma.Sql {
    const clauses = this.time('d', filters);
    if (filters.conversationGoal)
      clauses.push(
        Prisma.sql`d."conversationGoal" = ${filters.conversationGoal}`,
      );
    if (filters.runtimeDecision)
      clauses.push(
        Prisma.sql`d."decision" = ${filters.runtimeDecision}::"NutritionShadowRuntimeDecisionType"`,
      );
    if (filters.skipReason)
      clauses.push(
        Prisma.sql`d."skipReason" = ${filters.skipReason}::"NutritionShadowRuntimeSkipReason"`,
      );
    const run = this.linkedRunFilters('r', filters);
    if (run.length)
      clauses.push(
        Prisma.sql`EXISTS (SELECT 1 FROM "nutrition_shadow_runs" r WHERE r."id" = d."shadowRunId" AND ${this.and(run)})`,
      );
    if (filters.equivalent !== undefined)
      clauses.push(
        Prisma.sql`EXISTS (SELECT 1 FROM "nutrition_shadow_comparisons" c WHERE c."shadowRunId" = d."shadowRunId" AND c."equivalent" = ${filters.equivalent})`,
      );
    return this.and(clauses);
  }

  private runWhere(filters: NutritionShadowAnalyticsFilters): Prisma.Sql {
    const clauses = [
      ...this.time('r', filters),
      ...this.linkedRunFilters('r', filters),
    ];
    if (filters.conversationGoal)
      clauses.push(
        Prisma.sql`r."conversationGoal" = ${filters.conversationGoal}`,
      );
    if (filters.runtimeDecision || filters.skipReason)
      clauses.push(
        Prisma.sql`EXISTS (SELECT 1 FROM "nutrition_shadow_runtime_decisions" d WHERE d."shadowRunId" = r."id" ${filters.runtimeDecision ? Prisma.sql`AND d."decision" = ${filters.runtimeDecision}::"NutritionShadowRuntimeDecisionType"` : Prisma.empty} ${filters.skipReason ? Prisma.sql`AND d."skipReason" = ${filters.skipReason}::"NutritionShadowRuntimeSkipReason"` : Prisma.empty})`,
      );
    if (filters.equivalent !== undefined)
      clauses.push(
        Prisma.sql`EXISTS (SELECT 1 FROM "nutrition_shadow_comparisons" c WHERE c."shadowRunId" = r."id" AND c."equivalent" = ${filters.equivalent})`,
      );
    return this.and(clauses);
  }

  private comparisonWhere(
    filters: NutritionShadowAnalyticsFilters,
  ): Prisma.Sql {
    const clauses = this.time('c', filters);
    if (filters.conversationGoal)
      clauses.push(
        Prisma.sql`c."conversationGoal" = ${filters.conversationGoal}`,
      );
    if (filters.artifactType)
      clauses.push(
        Prisma.sql`c."actualArtifactType" = ${filters.artifactType}::"NutritionArtifactType"`,
      );
    if (filters.equivalent !== undefined)
      clauses.push(Prisma.sql`c."equivalent" = ${filters.equivalent}`);
    if (filters.provider)
      clauses.push(Prisma.sql`c."shadowProvider" = ${filters.provider}`);
    if (filters.model)
      clauses.push(Prisma.sql`c."shadowModel" = ${filters.model}`);
    if (filters.runStatus)
      clauses.push(
        Prisma.sql`EXISTS (SELECT 1 FROM "nutrition_shadow_runs" r WHERE r."id" = c."shadowRunId" AND r."status" = ${filters.runStatus}::"NutritionShadowRunStatus")`,
      );
    if (filters.runtimeDecision || filters.skipReason)
      clauses.push(
        Prisma.sql`EXISTS (SELECT 1 FROM "nutrition_shadow_runtime_decisions" d WHERE d."shadowRunId" = c."shadowRunId" ${filters.runtimeDecision ? Prisma.sql`AND d."decision" = ${filters.runtimeDecision}::"NutritionShadowRuntimeDecisionType"` : Prisma.empty} ${filters.skipReason ? Prisma.sql`AND d."skipReason" = ${filters.skipReason}::"NutritionShadowRuntimeSkipReason"` : Prisma.empty})`,
      );
    return this.and(clauses);
  }

  private linkedRunFilters(
    alias: 'r',
    filters: NutritionShadowAnalyticsFilters,
  ): Prisma.Sql[] {
    const clauses: Prisma.Sql[] = [];
    if (filters.artifactType)
      clauses.push(
        Prisma.sql`${Prisma.raw(alias)}."artifactType" = ${filters.artifactType}::"NutritionArtifactType"`,
      );
    if (filters.runStatus)
      clauses.push(
        Prisma.sql`${Prisma.raw(alias)}."status" = ${filters.runStatus}::"NutritionShadowRunStatus"`,
      );
    if (filters.provider)
      clauses.push(
        Prisma.sql`${Prisma.raw(alias)}."provider" = ${filters.provider}`,
      );
    if (filters.model)
      clauses.push(Prisma.sql`${Prisma.raw(alias)}."model" = ${filters.model}`);
    return clauses;
  }

  private time(
    alias: 'd' | 'r' | 'c',
    filters: NutritionShadowAnalyticsFilters,
  ): Prisma.Sql[] {
    const table = Prisma.raw(alias);
    return [
      Prisma.sql`${table}."createdAt" >= ${filters.from}`,
      Prisma.sql`${table}."createdAt" <= ${filters.to}`,
    ];
  }

  private and(clauses: readonly Prisma.Sql[]): Prisma.Sql {
    return clauses.length ? Prisma.join(clauses, ' AND ') : Prisma.sql`TRUE`;
  }

  private bucket(
    bucket: NutritionShadowAnalyticsFilters['bucket'],
  ): Prisma.Sql {
    if (bucket === 'HOUR') return Prisma.raw(`'hour'`);
    if (bucket === 'WEEK') return Prisma.raw(`'week'`);
    return Prisma.raw(`'day'`);
  }

  private dimension(field: 'provider' | 'model', where: Prisma.Sql) {
    const column = Prisma.raw(`r."${field}"`);
    return this.rows(Prisma.sql`
      SELECT ${column} AS key, COUNT(*) AS total,
        0::bigint AS first, 0::bigint AS second, 0::bigint AS third,
        0::bigint AS fourth, NULL::float8 AS average,
        0::bigint AS "divergenceCount"
      FROM "nutrition_shadow_runs" r WHERE ${where} AND ${column} IS NOT NULL
      GROUP BY ${column}
    `);
  }

  private timeRows(
    source: 'decision' | 'run' | 'comparison',
    bucket: Prisma.Sql,
    where: Prisma.Sql,
  ): Promise<NutritionShadowTimeRow[]> {
    if (source === 'decision')
      return this.prisma.$queryRaw<NutritionShadowTimeRow[]>(Prisma.sql`
        SELECT date_trunc(${bucket}, d."createdAt") AS "bucketStart", COUNT(*) AS total,
          COUNT(*) FILTER (WHERE d."decision" = 'STARTED') AS first,
          COUNT(*) FILTER (WHERE d."decision" = 'SKIPPED') AS second
        FROM "nutrition_shadow_runtime_decisions" d WHERE ${where}
        GROUP BY 1 ORDER BY 1
      `);
    if (source === 'run')
      return this.prisma.$queryRaw<NutritionShadowTimeRow[]>(Prisma.sql`
        SELECT date_trunc(${bucket}, r."createdAt") AS "bucketStart", COUNT(*) AS total,
          COUNT(*) FILTER (WHERE r."status" = 'SUCCEEDED') AS first,
          COUNT(*) FILTER (WHERE r."status" = 'FAILED') AS second
        FROM "nutrition_shadow_runs" r WHERE ${where}
        GROUP BY 1 ORDER BY 1
      `);
    return this.prisma.$queryRaw<NutritionShadowTimeRow[]>(Prisma.sql`
      SELECT date_trunc(${bucket}, c."createdAt") AS "bucketStart", COUNT(*) AS total,
        COUNT(*) FILTER (WHERE c."equivalent") AS first,
        COUNT(*) FILTER (WHERE NOT c."equivalent") AS second
      FROM "nutrition_shadow_comparisons" c WHERE ${where}
      GROUP BY 1 ORDER BY 1
    `);
  }

  private async one<T>(query: Prisma.Sql): Promise<T> {
    const rows = await this.prisma.$queryRaw<T[]>(query);
    const row = rows[0];
    if (!row)
      throw new Error('Agregação Nutrition Shadow não retornou resultado');
    return row;
  }

  private rows(query: Prisma.Sql): Promise<NutritionShadowCountRow[]> {
    return this.prisma.$queryRaw<NutritionShadowCountRow[]>(query);
  }

  private mergeGoals(
    decisions: readonly NutritionShadowCountRow[],
    runs: readonly NutritionShadowCountRow[],
    comparisons: readonly NutritionShadowCountRow[],
  ): NutritionShadowCountRow[] {
    return this.merge(decisions, runs, comparisons, false);
  }

  private mergeArtifacts(
    runs: readonly NutritionShadowCountRow[],
    comparisons: readonly NutritionShadowCountRow[],
  ): NutritionShadowCountRow[] {
    return this.merge([], runs, comparisons, true);
  }

  private merge(
    decisions: readonly NutritionShadowCountRow[],
    runs: readonly NutritionShadowCountRow[],
    comparisons: readonly NutritionShadowCountRow[],
    artifact: boolean,
  ): NutritionShadowCountRow[] {
    const keys = new Set([
      ...decisions.map((row) => row.key),
      ...runs.map((row) => row.key),
      ...comparisons.map((row) => row.key),
    ]);
    return [...keys].sort().map((key) => {
      const decision = decisions.find((row) => row.key === key);
      const run = runs.find((row) => row.key === key);
      const comparison = comparisons.find((row) => row.key === key);
      return Object.freeze({
        key,
        total: artifact ? (run?.total ?? 0n) : (decision?.total ?? 0n),
        first: artifact ? (comparison?.total ?? 0n) : (decision?.first ?? 0n),
        second: artifact ? (comparison?.first ?? 0n) : (decision?.second ?? 0n),
        third: artifact ? (comparison?.second ?? 0n) : (run?.first ?? 0n),
        fourth: artifact ? 0n : (run?.second ?? 0n),
        average: comparison?.average ?? null,
        divergenceCount: artifact
          ? (comparison?.divergenceCount ?? 0n)
          : (comparison?.total ?? 0n),
        equivalentCount: artifact ? undefined : (comparison?.first ?? 0n),
      });
    });
  }
}
