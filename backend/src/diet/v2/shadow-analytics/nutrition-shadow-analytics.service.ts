import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import {
  NutritionArtifactType,
  NutritionShadowComparisonDivergence,
  NutritionShadowRuntimeDecisionType,
  NutritionShadowRuntimeSkipReason,
} from '@prisma/client';
import { performance } from 'node:perf_hooks';
import {
  CONVERSATION_GOAL,
  type ConversationGoal,
} from '../../../context/conversation-goal-planner.contract';
import type {
  NutritionShadowAnalyticsFilters,
  NutritionShadowAnalyticsQuery,
  NutritionShadowAnalyticsReadModel,
  NutritionShadowPercentage,
  NutritionShadowTimeSeriesPoint,
} from './nutrition-shadow-analytics.contract';
import {
  NUTRITION_SHADOW_ANALYTICS_REPOSITORY,
  type NutritionShadowAnalyticsRepository,
  type NutritionShadowCountRow,
  type NutritionShadowTimeRow,
} from './nutrition-shadow-analytics.repository';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

@Injectable()
export class NutritionShadowAnalyticsService {
  private readonly logger = new Logger(NutritionShadowAnalyticsService.name);

  constructor(
    @Inject(NUTRITION_SHADOW_ANALYTICS_REPOSITORY)
    private readonly repository: NutritionShadowAnalyticsRepository,
  ) {}

  async query(
    query: NutritionShadowAnalyticsQuery,
    now = new Date(),
  ): Promise<NutritionShadowAnalyticsReadModel> {
    const startedAt = performance.now();
    const filters = this.filters(query, now);
    this.logger.debug('Consulta Nutrition Shadow Analytics iniciada');
    try {
      const snapshot = await this.repository.read(filters);
      const totalDecisions = this.number(snapshot.decisions.total);
      const started = this.number(snapshot.decisions.first);
      const skipped = this.number(snapshot.decisions.second);
      const totalRuns = this.number(snapshot.runs.total);
      const totalComparisons = this.number(snapshot.comparisons.total);
      const equivalent = this.number(snapshot.comparisons.first);
      const skippedTotal = skipped;

      const result: NutritionShadowAnalyticsReadModel = Object.freeze({
        filters,
        summary: Object.freeze({
          totalDecisions,
          started,
          skipped,
          pending: this.number(snapshot.decisions.third),
          startedRate: this.percentage(started, totalDecisions),
          skippedRate: this.percentage(skipped, totalDecisions),
          shadowCoverage: this.percentage(started, totalDecisions),
        }),
        runs: Object.freeze({
          total: totalRuns,
          succeeded: this.number(snapshot.runs.first),
          failed: this.number(snapshot.runs.second),
          pending: this.number(snapshot.runs.third),
          running: this.number(snapshot.runs.fourth),
          successRate: this.percentage(
            this.number(snapshot.runs.first),
            totalRuns,
          ),
          failureRate: this.percentage(
            this.number(snapshot.runs.second),
            totalRuns,
          ),
          averageDurationMs: snapshot.runs.averageFirst,
          p50DurationMs: snapshot.runs.p50,
          p95DurationMs: snapshot.runs.p95,
          p99DurationMs: snapshot.runs.p99,
          averageRetries: snapshot.runs.averageSecond ?? 0,
        }),
        comparisons: Object.freeze({
          total: totalComparisons,
          equivalent,
          divergent: this.number(snapshot.comparisons.second),
          equivalenceRate: this.percentage(equivalent, totalComparisons),
          averageStructuralScore: snapshot.comparisons.averageFirst,
          averageSemanticScore: snapshot.comparisons.averageSecond,
          averageOperationalScore: snapshot.comparisons.averageThird,
          averageOverallScore: snapshot.comparisons.averageFourth,
        }),
        byConversationGoal: Object.freeze(
          snapshot.goals.map((row) => {
            const comparisons = this.number(row.divergenceCount);
            const goalEquivalent = this.number(row.equivalentCount ?? 0n);
            return Object.freeze({
              conversationGoal: this.goal(row.key),
              decisions: this.number(row.total),
              started: this.number(row.first),
              skipped: this.number(row.second),
              succeeded: this.number(row.third),
              failed: this.number(row.fourth),
              comparisons,
              equivalent: goalEquivalent,
              equivalenceRate: this.percentage(goalEquivalent, comparisons),
              averageScore: row.average,
            });
          }),
        ),
        byArtifactType: Object.freeze(
          snapshot.artifacts.map((row) => {
            const comparisons = this.number(row.first);
            const artifactEquivalent = this.number(row.second);
            return Object.freeze({
              artifactType: this.artifact(row.key),
              runs: this.number(row.total),
              comparisons,
              equivalent: artifactEquivalent,
              divergent: this.number(row.third),
              equivalenceRate: this.percentage(artifactEquivalent, comparisons),
              divergenceCount: this.number(row.divergenceCount),
              averageScore: row.average,
            });
          }),
        ),
        decisions: Object.freeze(
          snapshot.decisionDistribution
            .map((row) =>
              Object.freeze({
                decision: this.decision(row.key),
                count: this.number(row.total),
                share: this.percentage(this.number(row.total), totalDecisions),
              }),
            )
            .sort((left, right) => right.count - left.count),
        ),
        skipReasons: Object.freeze(
          snapshot.skipReasons
            .map((row) =>
              Object.freeze({
                reason: this.skipReason(row.key),
                count: this.number(row.total),
                shareOfSkipped: this.percentage(
                  this.number(row.total),
                  skippedTotal,
                ),
              }),
            )
            .sort((left, right) => right.count - left.count),
        ),
        divergences: Object.freeze(
          snapshot.divergences
            .map((row) =>
              Object.freeze({
                divergence: this.divergence(row.key),
                count: this.number(row.total),
                shareOfComparisons: this.percentage(
                  this.number(row.total),
                  totalComparisons,
                ),
              }),
            )
            .sort(
              (left, right) =>
                right.count - left.count ||
                left.divergence.localeCompare(right.divergence),
            ),
        ),
        operational: Object.freeze({
          totalTokens: this.number(snapshot.operational.totalTokens),
          averageTokens: snapshot.operational.averageTokens ?? 0,
          totalCostUsd: snapshot.operational.totalCostUsd,
          averageCostUsd: snapshot.operational.averageCostUsd,
          providers: this.dimensions(snapshot.providers, totalRuns),
          models: this.dimensions(snapshot.models, totalRuns),
        }),
        timeSeries: this.timeSeries(
          snapshot.decisionSeries,
          snapshot.runSeries,
          snapshot.comparisonSeries,
        ),
      });
      this.logger.debug(
        `Consulta Nutrition Shadow Analytics concluída em ${Math.max(0, Math.round(performance.now() - startedAt))}ms`,
      );
      return result;
    } catch (error: unknown) {
      this.logger.warn(
        `Consulta Nutrition Shadow Analytics falhou em ${Math.max(0, Math.round(performance.now() - startedAt))}ms`,
      );
      throw error;
    }
  }

  private filters(
    query: NutritionShadowAnalyticsQuery,
    now: Date,
  ): NutritionShadowAnalyticsFilters {
    this.validDate(now);
    let from: Date;
    let to: Date;
    const window = query.window ?? 'LAST_24_HOURS';
    if (window === 'CUSTOM') {
      if (!query.from || !query.to)
        throw new BadRequestException(
          'Intervalo customizado exige datas inicial e final',
        );
      from = query.from;
      to = query.to;
    } else {
      to = query.to ?? now;
      const duration =
        window === 'LAST_7_DAYS'
          ? 7 * DAY_MS
          : window === 'LAST_30_DAYS'
            ? 30 * DAY_MS
            : DAY_MS;
      from = query.from ?? new Date(to.getTime() - duration);
    }
    this.validDate(from);
    this.validDate(to);
    if (from > to)
      throw new BadRequestException(
        'Data inicial não pode ser posterior à data final',
      );
    return Object.freeze({
      from: new Date(from),
      to: new Date(to),
      bucket: query.bucket ?? 'DAY',
      conversationGoal: query.conversationGoal,
      artifactType: query.artifactType,
      runtimeDecision: query.runtimeDecision,
      skipReason: query.skipReason,
      runStatus: query.runStatus,
      equivalent: query.equivalent,
      provider: this.optionalText(query.provider, 'provider'),
      model: this.optionalText(query.model, 'model'),
    });
  }

  private percentage(
    numerator: number,
    denominator: number,
  ): NutritionShadowPercentage {
    return Object.freeze({
      numerator,
      denominator,
      percentage:
        denominator === 0
          ? 0
          : Math.round((numerator / denominator) * 1_000_000) / 10_000,
    });
  }

  private dimensions(rows: readonly NutritionShadowCountRow[], total: number) {
    return Object.freeze(
      rows
        .map((row) =>
          Object.freeze({
            value: row.key,
            count: this.number(row.total),
            shareOfRuns: this.percentage(this.number(row.total), total),
          }),
        )
        .sort((left, right) => right.count - left.count),
    );
  }

  private timeSeries(
    decisions: readonly NutritionShadowTimeRow[],
    runs: readonly NutritionShadowTimeRow[],
    comparisons: readonly NutritionShadowTimeRow[],
  ): readonly NutritionShadowTimeSeriesPoint[] {
    const timestamps = new Set([
      ...decisions.map((row) => row.bucketStart.getTime()),
      ...runs.map((row) => row.bucketStart.getTime()),
      ...comparisons.map((row) => row.bucketStart.getTime()),
    ]);
    return Object.freeze(
      [...timestamps]
        .sort((left, right) => left - right)
        .map((timestamp) => {
          const decision = decisions.find(
            (row) => row.bucketStart.getTime() === timestamp,
          );
          const run = runs.find(
            (row) => row.bucketStart.getTime() === timestamp,
          );
          const comparison = comparisons.find(
            (row) => row.bucketStart.getTime() === timestamp,
          );
          return Object.freeze({
            bucketStart: new Date(timestamp),
            decisions: this.number(decision?.total ?? 0n),
            started: this.number(decision?.first ?? 0n),
            skipped: this.number(decision?.second ?? 0n),
            runs: this.number(run?.total ?? 0n),
            succeeded: this.number(run?.first ?? 0n),
            failed: this.number(run?.second ?? 0n),
            comparisons: this.number(comparison?.total ?? 0n),
            equivalent: this.number(comparison?.first ?? 0n),
            divergent: this.number(comparison?.second ?? 0n),
          });
        }),
    );
  }

  private number(value: bigint): number {
    const number = Number(value);
    if (!Number.isSafeInteger(number))
      throw new Error('Contagem Nutrition Shadow excedeu o limite seguro');
    return number;
  }

  private validDate(value: Date): void {
    if (Number.isNaN(value.getTime()))
      throw new BadRequestException('Data Nutrition Shadow inválida');
  }

  private optionalText(value: string | undefined, name: string) {
    if (value === undefined) return undefined;
    const normalized = value.trim();
    if (!normalized)
      throw new BadRequestException(`Filtro ${name} não pode ser vazio`);
    return normalized;
  }

  private goal(value: string): ConversationGoal {
    switch (value) {
      case CONVERSATION_GOAL.ANSWER_MESSAGE:
      case CONVERSATION_GOAL.ASK_PROFILE_INFORMATION:
      case CONVERSATION_GOAL.GENERATE_DIET_PLAN:
      case CONVERSATION_GOAL.GENERATE_WORKOUT_PLAN:
      case CONVERSATION_GOAL.GENERATE_COMBINED_PLANS:
      case CONVERSATION_GOAL.UPDATE_DIET_PLAN:
      case CONVERSATION_GOAL.UPDATE_WORKOUT_PLAN:
      case CONVERSATION_GOAL.REVIEW_PROGRESS:
      case CONVERSATION_GOAL.REQUEST_CONFIRMATION:
      case CONVERSATION_GOAL.SHOW_CURRENT_PLAN:
      case CONVERSATION_GOAL.SHOW_PLAN_STATUS:
      case CONVERSATION_GOAL.GENERAL_GUIDANCE:
      case CONVERSATION_GOAL.UNKNOWN:
        return value;
      default:
        throw new Error('ConversationGoal analítico inválido');
    }
  }

  private artifact(value: string): NutritionArtifactType {
    if (
      Object.values(NutritionArtifactType).includes(this.artifactValue(value))
    )
      return this.artifactValue(value);
    throw new Error('NutritionArtifactType analítico inválido');
  }

  private artifactValue(value: string): NutritionArtifactType {
    switch (value) {
      case NutritionArtifactType.POINT_GUIDANCE:
      case NutritionArtifactType.MEAL_SUGGESTION:
      case NutritionArtifactType.DAILY_STRUCTURE:
      case NutritionArtifactType.WEEKLY_PLAN:
      case NutritionArtifactType.PLAN_REVIEW:
      case NutritionArtifactType.PLAN_ADAPTATION:
      case NutritionArtifactType.FOOD_SUBSTITUTION:
      case NutritionArtifactType.CURRENT_PLAN_PRESENTATION:
        return value;
      default:
        throw new Error('NutritionArtifactType analítico inválido');
    }
  }

  private decision(value: string): NutritionShadowRuntimeDecisionType {
    switch (value) {
      case NutritionShadowRuntimeDecisionType.PENDING:
      case NutritionShadowRuntimeDecisionType.STARTED:
      case NutritionShadowRuntimeDecisionType.SKIPPED:
        return value;
      default:
        throw new Error('RuntimeDecision analítica inválida');
    }
  }

  private skipReason(value: string): NutritionShadowRuntimeSkipReason {
    switch (value) {
      case NutritionShadowRuntimeSkipReason.DISABLED_BY_POLICY:
      case NutritionShadowRuntimeSkipReason.NON_NUTRITION_GOAL:
      case NutritionShadowRuntimeSkipReason.CONCURRENCY_LIMIT:
      case NutritionShadowRuntimeSkipReason.SHUTTING_DOWN:
      case NutritionShadowRuntimeSkipReason.MISSING_REQUIRED_CONTEXT:
      case NutritionShadowRuntimeSkipReason.POLICY_EVALUATION_ERROR:
      case NutritionShadowRuntimeSkipReason.STORAGE_UNAVAILABLE:
        return value;
      default:
        throw new Error('SkipReason analítica inválida');
    }
  }

  private divergence(value: string): NutritionShadowComparisonDivergence {
    const found = Object.values(NutritionShadowComparisonDivergence).find(
      (candidate) => candidate === value,
    );
    if (!found) throw new Error('Divergência Nutrition Shadow inválida');
    return found;
  }
}
