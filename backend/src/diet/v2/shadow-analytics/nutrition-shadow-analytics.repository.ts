import type { NutritionShadowAnalyticsFilters } from './nutrition-shadow-analytics.contract';

export const NUTRITION_SHADOW_ANALYTICS_REPOSITORY = Symbol(
  'NUTRITION_SHADOW_ANALYTICS_REPOSITORY',
);

export interface NutritionShadowCountRow {
  readonly key: string;
  readonly total: bigint;
  readonly first: bigint;
  readonly second: bigint;
  readonly third: bigint;
  readonly fourth: bigint;
  readonly average: number | null;
  readonly divergenceCount: bigint;
  readonly equivalentCount?: bigint;
}

export interface NutritionShadowSummaryRow {
  readonly total: bigint;
  readonly first: bigint;
  readonly second: bigint;
  readonly third: bigint;
  readonly fourth: bigint;
  readonly averageFirst: number | null;
  readonly averageSecond: number | null;
  readonly averageThird: number | null;
  readonly averageFourth: number | null;
}

export interface NutritionShadowRunAggregateRow extends NutritionShadowSummaryRow {
  readonly p50: number | null;
  readonly p95: number | null;
  readonly p99: number | null;
}

export interface NutritionShadowOperationalRow {
  readonly totalTokens: bigint;
  readonly averageTokens: number | null;
  readonly totalCostUsd: string;
  readonly averageCostUsd: string;
}

export interface NutritionShadowTimeRow {
  readonly bucketStart: Date;
  readonly total: bigint;
  readonly first: bigint;
  readonly second: bigint;
}

export interface NutritionShadowAnalyticsSnapshot {
  readonly decisions: NutritionShadowSummaryRow;
  readonly runs: NutritionShadowRunAggregateRow;
  readonly comparisons: NutritionShadowSummaryRow;
  readonly goals: readonly NutritionShadowCountRow[];
  readonly artifacts: readonly NutritionShadowCountRow[];
  readonly decisionDistribution: readonly NutritionShadowCountRow[];
  readonly skipReasons: readonly NutritionShadowCountRow[];
  readonly divergences: readonly NutritionShadowCountRow[];
  readonly providers: readonly NutritionShadowCountRow[];
  readonly models: readonly NutritionShadowCountRow[];
  readonly operational: NutritionShadowOperationalRow;
  readonly decisionSeries: readonly NutritionShadowTimeRow[];
  readonly runSeries: readonly NutritionShadowTimeRow[];
  readonly comparisonSeries: readonly NutritionShadowTimeRow[];
}

export interface NutritionShadowAnalyticsRepository {
  read(
    filters: NutritionShadowAnalyticsFilters,
  ): Promise<NutritionShadowAnalyticsSnapshot>;
}
