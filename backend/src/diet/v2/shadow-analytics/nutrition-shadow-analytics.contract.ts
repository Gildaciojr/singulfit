import type {
  NutritionArtifactType,
  NutritionShadowComparisonDivergence,
  NutritionShadowRunStatus,
  NutritionShadowRuntimeDecisionType,
  NutritionShadowRuntimeSkipReason,
} from '@prisma/client';
import type { ConversationGoal } from '../../../context/conversation-goal-planner.contract';

export type NutritionShadowAnalyticsWindow =
  | 'LAST_24_HOURS'
  | 'LAST_7_DAYS'
  | 'LAST_30_DAYS'
  | 'CUSTOM';

export type NutritionShadowTimeBucket = 'HOUR' | 'DAY' | 'WEEK';

export interface NutritionShadowAnalyticsQuery {
  readonly window?: NutritionShadowAnalyticsWindow;
  readonly from?: Date;
  readonly to?: Date;
  readonly conversationGoal?: ConversationGoal;
  readonly artifactType?: NutritionArtifactType;
  readonly runtimeDecision?: NutritionShadowRuntimeDecisionType;
  readonly skipReason?: NutritionShadowRuntimeSkipReason;
  readonly runStatus?: NutritionShadowRunStatus;
  readonly equivalent?: boolean;
  readonly provider?: string;
  readonly model?: string;
  readonly bucket?: NutritionShadowTimeBucket;
}

export interface NutritionShadowAnalyticsFilters extends Omit<
  NutritionShadowAnalyticsQuery,
  'window' | 'from' | 'to'
> {
  readonly from: Date;
  readonly to: Date;
  readonly bucket: NutritionShadowTimeBucket;
}

export interface NutritionShadowPercentage {
  readonly numerator: number;
  readonly denominator: number;
  readonly percentage: number;
}

export interface NutritionShadowGeneralSummary {
  readonly totalDecisions: number;
  readonly started: number;
  readonly skipped: number;
  readonly pending: number;
  readonly startedRate: NutritionShadowPercentage;
  readonly skippedRate: NutritionShadowPercentage;
  readonly shadowCoverage: NutritionShadowPercentage;
}

export interface NutritionShadowRunSummary {
  readonly total: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly pending: number;
  readonly running: number;
  readonly successRate: NutritionShadowPercentage;
  readonly failureRate: NutritionShadowPercentage;
  readonly averageDurationMs: number | null;
  readonly p50DurationMs: number | null;
  readonly p95DurationMs: number | null;
  readonly p99DurationMs: number | null;
  readonly averageRetries: number;
}

export interface NutritionShadowComparisonSummary {
  readonly total: number;
  readonly equivalent: number;
  readonly divergent: number;
  readonly equivalenceRate: NutritionShadowPercentage;
  readonly averageStructuralScore: number | null;
  readonly averageSemanticScore: number | null;
  readonly averageOperationalScore: number | null;
  readonly averageOverallScore: number | null;
}

export interface NutritionShadowConversationGoalMetrics {
  readonly conversationGoal: ConversationGoal;
  readonly decisions: number;
  readonly started: number;
  readonly skipped: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly comparisons: number;
  readonly equivalent: number;
  readonly equivalenceRate: NutritionShadowPercentage;
  readonly averageScore: number | null;
}

export interface NutritionShadowArtifactMetrics {
  readonly artifactType: NutritionArtifactType;
  readonly runs: number;
  readonly comparisons: number;
  readonly equivalent: number;
  readonly divergent: number;
  readonly equivalenceRate: NutritionShadowPercentage;
  readonly divergenceCount: number;
  readonly averageScore: number | null;
}

export interface NutritionShadowDecisionDistribution {
  readonly decision: NutritionShadowRuntimeDecisionType;
  readonly count: number;
  readonly share: NutritionShadowPercentage;
}

export interface NutritionShadowSkipReasonDistribution {
  readonly reason: NutritionShadowRuntimeSkipReason;
  readonly count: number;
  readonly shareOfSkipped: NutritionShadowPercentage;
}

export interface NutritionShadowDivergenceRanking {
  readonly divergence: NutritionShadowComparisonDivergence;
  readonly count: number;
  readonly shareOfComparisons: NutritionShadowPercentage;
}

export interface NutritionShadowDimensionDistribution {
  readonly value: string;
  readonly count: number;
  readonly shareOfRuns: NutritionShadowPercentage;
}

export interface NutritionShadowOperationalMetrics {
  readonly totalTokens: number;
  readonly averageTokens: number;
  readonly totalCostUsd: string;
  readonly averageCostUsd: string;
  readonly providers: readonly NutritionShadowDimensionDistribution[];
  readonly models: readonly NutritionShadowDimensionDistribution[];
}

export interface NutritionShadowTimeSeriesPoint {
  readonly bucketStart: Date;
  readonly decisions: number;
  readonly started: number;
  readonly skipped: number;
  readonly runs: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly comparisons: number;
  readonly equivalent: number;
  readonly divergent: number;
}

export interface NutritionShadowAnalyticsReadModel {
  readonly filters: NutritionShadowAnalyticsFilters;
  readonly summary: NutritionShadowGeneralSummary;
  readonly runs: NutritionShadowRunSummary;
  readonly comparisons: NutritionShadowComparisonSummary;
  readonly byConversationGoal: readonly NutritionShadowConversationGoalMetrics[];
  readonly byArtifactType: readonly NutritionShadowArtifactMetrics[];
  readonly decisions: readonly NutritionShadowDecisionDistribution[];
  readonly skipReasons: readonly NutritionShadowSkipReasonDistribution[];
  readonly divergences: readonly NutritionShadowDivergenceRanking[];
  readonly operational: NutritionShadowOperationalMetrics;
  readonly timeSeries: readonly NutritionShadowTimeSeriesPoint[];
}
