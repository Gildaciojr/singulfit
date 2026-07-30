import {
  SHADOW_EVALUATION_PLATFORM_VERSION,
  SHADOW_EVALUATION_SCHEMA_VERSION,
  ShadowComponentMetrics,
  ShadowDistributionEntry,
  ShadowEvaluationReport,
  ShadowEvaluationScorecard,
  ShadowMetricsSnapshot,
} from './shadow-evaluation.contract';
import { statistics } from './shadow-evaluation-platform';

export class ShadowMetricsAggregator {
  aggregate(
    versionLabel: string,
    reports: readonly ShadowEvaluationReport[],
  ): ShadowMetricsSnapshot {
    const nutrition = reports.flatMap((report) =>
      report.nutrition ? [report.nutrition] : [],
    );
    const workout = reports.flatMap((report) =>
      report.workout ? [report.workout] : [],
    );
    const comparatorCategories = reports
      .flatMap((report) => [
        report.comparator.nutritionCategory,
        report.comparator.workoutCategory,
        report.comparator.longitudinalCategory,
      ])
      .filter(isNotNull);

    return deepFreeze({
      schemaVersion: SHADOW_EVALUATION_SCHEMA_VERSION,
      platformVersion: SHADOW_EVALUATION_PLATFORM_VERSION,
      versionLabel,
      runCount: reports.length,
      metrics: {
        collector: {
          meanCompletionRate: average(
            reports.map((report) => report.collector.completionRate),
          ),
          meanUnknownRate: average(
            reports.map((report) => report.collector.unknownRate),
          ),
          meanConfirmationRate: average(
            reports.map((report) => report.collector.confirmationRate),
          ),
          meanQuestionsRequired: average(
            reports.map(
              (report) => report.collector.estimatedQuestionsRequired,
            ),
          ),
          meanSnapshotCoverageRate: average(
            reports.map((report) => report.collector.snapshotCoverageRate),
          ),
          completionStates: distribution(
            reports.map((report) => report.collector.completionState),
          ),
        },
        planner: {
          goals: distribution(
            reports.map((report) => report.planner.selectedGoal),
          ),
          intents: distribution(
            reports.map((report) => report.planner.recognizedIntent),
          ),
          revisions: reports.filter((report) => report.planner.revision).length,
          informationRequests: reports.filter(
            (report) => report.planner.informationRequest,
          ).length,
          planRequests: reports.filter((report) => report.planner.planRequest)
            .length,
        },
        nutrition: {
          packagesUsed: distribution(
            nutrition.flatMap((metrics) => metrics.usedKnowledgePackages),
          ),
          packagesDiscarded: distribution(
            nutrition.flatMap((metrics) => metrics.discardedKnowledgePackages),
          ),
          conflicts: distribution(
            nutrition.flatMap((metrics) => metrics.conflicts),
          ),
          priorities: distribution(
            nutrition.flatMap((metrics) =>
              metrics.priorities.map(
                (priority) => `${priority.name}:${priority.priority}`,
              ),
            ),
          ),
          intensities: distribution(
            nutrition.map((metrics) => metrics.intensity),
          ),
          complexities: distribution(
            nutrition.map((metrics) => metrics.complexity),
          ),
          personalization: distribution(
            nutrition.map((metrics) => metrics.personalization),
          ),
          strategies: distribution(
            nutrition.flatMap((metrics) => metrics.strategies),
          ),
          prohibitedStrategies: distribution(
            nutrition.flatMap((metrics) => metrics.prohibitedStrategies),
          ),
        },
        workout: {
          modalities: distribution(
            workout.map((metrics) => metrics.modality).filter(isNotNull),
          ),
          intensities: distribution(
            workout.map((metrics) => metrics.intensity),
          ),
          complexities: distribution(
            workout.map((metrics) => metrics.complexity),
          ),
          progressions: distribution(
            workout.map((metrics) => metrics.progression),
          ),
          strategies: distribution(
            workout.flatMap((metrics) => metrics.strategies),
          ),
          prohibitedStrategies: distribution(
            workout.flatMap((metrics) => metrics.prohibitedStrategies),
          ),
          conflicts: distribution(
            workout.flatMap((metrics) => metrics.conflicts),
          ),
          priorities: distribution(
            workout.flatMap((metrics) =>
              metrics.priorities.map(
                (priority) => `${priority.name}:${priority.priority}`,
              ),
            ),
          ),
        },
        longitudinal: {
          states: distribution(
            reports.map((report) => report.longitudinal.state),
          ),
          decisions: distribution(
            reports.map((report) => report.longitudinal.decision),
          ),
        },
        comparator: {
          overall: distribution(
            reports.map((report) => report.comparator.overallCategory),
          ),
          nutrition: distribution(
            reports
              .map((report) => report.comparator.nutritionCategory)
              .filter(isNotNull),
          ),
          workout: distribution(
            reports
              .map((report) => report.comparator.workoutCategory)
              .filter(isNotNull),
          ),
          longitudinal: distribution(
            reports.map((report) => report.comparator.longitudinalCategory),
          ),
          divergences: distribution(
            reports.flatMap((report) => report.comparator.divergenceDimensions),
          ),
          agreementRate: percent(
            comparatorCategories.filter(
              (category) =>
                category === 'EXACT_MATCH' || category === 'COMPATIBLE',
            ).length,
            comparatorCategories.length,
          ),
          conflictRate: percent(
            comparatorCategories.filter((category) => category === 'CONFLICT')
              .length,
            comparatorCategories.length,
          ),
          modalityDivergenceRate: rate(
            reports,
            (report) => report.comparator.modalityDivergence,
          ),
          objectiveDivergenceRate: rate(
            reports,
            (report) => report.comparator.objectiveDivergence,
          ),
          intensityDivergenceRate: rate(
            reports,
            (report) => report.comparator.intensityDivergence,
          ),
          complexityDivergenceRate: rate(
            reports,
            (report) => report.comparator.complexityDivergence,
          ),
          longitudinalDivergenceRate: rate(
            reports,
            (report) => report.comparator.longitudinalDivergence,
          ),
        },
        safety: {
          categories: distribution(
            reports.flatMap((report) => report.safety.categories),
          ),
          runRate: percent(
            reports.filter((report) => report.safety.categories.length > 0)
              .length,
            reports.length,
          ),
        },
        indices: {
          nutritionIntensity: average(
            nutrition.map((metrics) =>
              nutritionIntensityRank(metrics.intensity),
            ),
          ),
          workoutIntensity: average(
            workout.map((metrics) => workoutIntensityRank(metrics.intensity)),
          ),
          personalization: average(
            reports.map((report) => report.scorecard.personalizationScore),
          ),
        },
      },
      performance: this.performance(reports),
      scorecard: this.scorecard(reports),
      versions: uniqueSorted(
        reports.flatMap((report) => [
          report.versions.pipeline,
          report.versions.adapter,
          report.versions.comparator,
          report.versions.longitudinalPolicy,
          ...(report.versions.nutritionReasoning
            ? [report.versions.nutritionReasoning]
            : []),
          ...(report.versions.workoutReasoning
            ? [report.versions.workoutReasoning]
            : []),
        ]),
      ),
    });
  }

  private performance(
    reports: readonly ShadowEvaluationReport[],
  ): ShadowComponentMetrics {
    return deepFreeze({
      collector: statistics(
        reports.map((report) => report.performance.collector.mean),
      ),
      planner: statistics(
        reports.map((report) => report.performance.planner.mean),
      ),
      longitudinal: statistics(
        reports.map((report) => report.performance.longitudinal.mean),
      ),
      nutrition: nullableStatistics(
        reports.flatMap((report) =>
          report.performance.nutrition
            ? [report.performance.nutrition.mean]
            : [],
        ),
      ),
      workout: nullableStatistics(
        reports.flatMap((report) =>
          report.performance.workout ? [report.performance.workout.mean] : [],
        ),
      ),
      adapters: statistics(
        reports.map((report) => report.performance.adapters.mean),
      ),
      comparator: statistics(
        reports.map((report) => report.performance.comparator.mean),
      ),
      total: statistics(reports.map((report) => report.performance.total.mean)),
    });
  }

  private scorecard(
    reports: readonly ShadowEvaluationReport[],
  ): ShadowEvaluationScorecard {
    return deepFreeze({
      coverageScore: average(
        reports.map((report) => report.scorecard.coverageScore),
      ),
      agreementScore: average(
        reports.map((report) => report.scorecard.agreementScore),
      ),
      safetyScore: average(
        reports.map((report) => report.scorecard.safetyScore),
      ),
      consistencyScore: average(
        reports.map((report) => report.scorecard.consistencyScore),
      ),
      determinismScore: average(
        reports.map((report) => report.scorecard.determinismScore),
      ),
      personalizationScore: average(
        reports.map((report) => report.scorecard.personalizationScore),
      ),
    });
  }
}

function distribution(
  values: readonly string[],
): readonly ShadowDistributionEntry[] {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return Object.freeze(
    [...counts.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([value, count]) =>
        Object.freeze({
          value,
          count,
          percentage: percent(count, values.length),
        }),
      ),
  );
}

function isNotNull<T>(value: T | null): value is T {
  return value !== null;
}

function rate(
  reports: readonly ShadowEvaluationReport[],
  predicate: (report: ShadowEvaluationReport) => boolean,
): number {
  return percent(reports.filter(predicate).length, reports.length);
}

function nullableStatistics(values: readonly number[]) {
  return values.length === 0 ? null : statistics(values);
}

function nutritionIntensityRank(value: string): number {
  return value === 'RESTRICTED'
    ? 0
    : value === 'LOW'
      ? 1
      : value === 'MODERATE'
        ? 2
        : 3;
}

function workoutIntensityRank(value: string): number {
  return value === 'BLOCKED' || value === 'RECOVERY'
    ? 0
    : value === 'LOW'
      ? 1
      : value === 'MODERATE'
        ? 2
        : value === 'MODERATE_HIGH'
          ? 3
          : 4;
}

function uniqueSorted(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].sort());
}

function average(values: readonly number[]): number {
  return values.length === 0
    ? 0
    : round(values.reduce((total, value) => total + value, 0) / values.length);
}

function percent(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : round((numerator / denominator) * 100);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value))
    return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}
