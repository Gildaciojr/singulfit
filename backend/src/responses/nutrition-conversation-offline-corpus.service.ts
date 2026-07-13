import type {
  ConversationCorpusAcceptanceCriteria,
  ConversationCorpusAggregateReport,
  ConversationCorpusClassification,
  ConversationCorpusScenario,
  ConversationCorpusScenarioResult,
  RunConversationCorpusOptions,
} from './conversation-offline-corpus.contract';
import type {
  ConversationEvaluationReport,
  ConversationEvaluationScores,
} from './conversation-evaluation-harness.contract';
import { NutritionConversationEvaluationHarnessService } from './nutrition-conversation-evaluation-harness.service';

const DEFAULT_CRITERIA: ConversationCorpusAcceptanceCriteria = Object.freeze({
  minimumFactualScore: 90,
  minimumStructuralScore: 85,
  minimumConsistencyScore: 90,
});

const CRITICAL_CODES = new Set([
  'AUTHORIZED_FACTS_PRESERVED',
  'AUTHORIZED_NUMBERS_PRESERVED',
  'DISCLAIMER_PRESERVED',
  'QUESTION_AUTHORIZED',
  'LENGTH_WITHIN_LIMIT',
  'FOODS_PRESERVED',
  'RECOMMENDATIONS_PRESERVED',
]);

export class NutritionConversationOfflineCorpusService {
  constructor(
    private readonly harness = new NutritionConversationEvaluationHarnessService(),
    private readonly criteria: ConversationCorpusAcceptanceCriteria = DEFAULT_CRITERIA,
  ) {}

  async run(
    scenarios: readonly ConversationCorpusScenario[],
    options: RunConversationCorpusOptions = {},
  ): Promise<ConversationCorpusAggregateReport> {
    const mode = options.mode ?? 'DETERMINISTIC';
    const factory = this.resolveFactory(mode, options);
    const results = await Promise.all(
      scenarios.map(async (scenario) => {
        const candidate = factory
          ? await factory.realize(scenario)
          : scenario.candidate;
        const report = this.harness.evaluate({ ...scenario, candidate });
        return this.classify(scenario.id, report);
      }),
    );

    return this.aggregate(mode, results);
  }

  private resolveFactory(
    mode: 'DETERMINISTIC' | 'EXPERIMENTAL',
    options: RunConversationCorpusOptions,
  ) {
    if (mode === 'DETERMINISTIC') return undefined;
    if (!options.experimentalEnabled || !options.candidateFactory) {
      throw new Error('EXPERIMENTAL_CORPUS_REQUIRES_EXPLICIT_FACTORY');
    }
    return options.candidateFactory;
  }

  private classify(
    scenarioId: string,
    report: ConversationEvaluationReport,
  ): ConversationCorpusScenarioResult {
    const reasons = Object.freeze([
      ...report.objectiveReasons,
      ...this.criticalReasons(report),
    ]);
    const state = report.summary.candidateState;
    const classification: ConversationCorpusClassification =
      state === 'FALLBACK' || state === 'TIMEOUT'
        ? 'FALLBACK_REQUIRED'
        : state === 'INVALID_STRUCTURE' ||
            state === 'INELIGIBLE' ||
            state === 'NOT_EXECUTED'
          ? 'INVALID_CANDIDATE'
          : this.hasCriticalViolation(reasons)
            ? 'INVALID_CANDIDATE'
            : !this.meetsThresholds(report.scores)
              ? 'LEGACY_PREFERRED'
              : report.warnings.length > 0 || state === 'PARTIAL'
                ? 'ELIGIBLE_WITH_WARNING'
                : 'ELIGIBLE';

    return Object.freeze({ scenarioId, classification, reasons, report });
  }

  private criticalReasons(
    report: ConversationEvaluationReport,
  ): readonly string[] {
    return Object.freeze(
      report.failedChecks
        .filter((code) => CRITICAL_CODES.has(code))
        .map((code) => `CRITICAL:${code}`),
    );
  }

  private hasCriticalViolation(reasons: readonly string[]): boolean {
    return reasons.some(
      (reason) =>
        reason.startsWith('CRITICAL:') ||
        reason === 'FAILED:FOODS_PRESERVED' ||
        reason === 'FAILED:RECOMMENDATIONS_PRESERVED',
    );
  }

  private meetsThresholds(scores: ConversationEvaluationScores): boolean {
    return (
      scores.factual >= this.criteria.minimumFactualScore &&
      scores.structural >= this.criteria.minimumStructuralScore &&
      scores.consistency >= this.criteria.minimumConsistencyScore
    );
  }

  private aggregate(
    mode: 'DETERMINISTIC' | 'EXPERIMENTAL',
    results: readonly ConversationCorpusScenarioResult[],
  ): ConversationCorpusAggregateReport {
    const classificationCount = (
      classification: ConversationCorpusClassification,
    ) =>
      results.filter((result) => result.classification === classification)
        .length;
    const scores = results.map((result) => result.report.scores);
    const experimental =
      mode === 'EXPERIMENTAL'
        ? results.map((result) => result.report.metrics)
        : [];

    return Object.freeze({
      mode,
      totalScenarios: results.length,
      eligible: classificationCount('ELIGIBLE'),
      eligibleWithWarning: classificationCount('ELIGIBLE_WITH_WARNING'),
      legacyPreferred: classificationCount('LEGACY_PREFERRED'),
      invalidCandidates: classificationCount('INVALID_CANDIDATE'),
      fallbackRequired: classificationCount('FALLBACK_REQUIRED'),
      averageScores: this.averageScores(scores),
      lowestFinalScore: this.extreme(scores, 'min'),
      highestFinalScore: this.extreme(scores, 'max'),
      frequentDivergences: this.frequency(
        results.flatMap((result) => result.report.comparison.divergenceCodes),
      ),
      frequentWarnings: this.frequency(
        results.flatMap((result) => result.report.warnings),
      ),
      criticalScenarioIds: Object.freeze(
        results
          .filter((result) => result.classification !== 'ELIGIBLE')
          .map((result) => result.scenarioId),
      ),
      experimentalAverageLatencyMs: this.averageMetric(
        experimental.map((metric) => metric.incrementalLatencyMs),
      ),
      experimentalAverageTotalTokens: this.averageMetric(
        experimental.map((metric) => metric.totalTokens),
      ),
      scenarios: Object.freeze([...results]),
    });
  }

  private averageScores(
    scores: readonly ConversationEvaluationScores[],
  ): ConversationEvaluationScores {
    const average = (key: keyof ConversationEvaluationScores) =>
      this.round(
        scores.length === 0
          ? 0
          : scores.reduce((total, score) => total + score[key], 0) /
              scores.length,
      );
    return Object.freeze({
      factual: average('factual'),
      structural: average('structural'),
      decisionAdherence: average('decisionAdherence'),
      coverage: average('coverage'),
      completeness: average('completeness'),
      consistency: average('consistency'),
      final: average('final'),
    });
  }

  private extreme(
    scores: readonly ConversationEvaluationScores[],
    operation: 'min' | 'max',
  ): number {
    if (scores.length === 0) return 0;
    return scores.reduce(
      (current, score) =>
        operation === 'min'
          ? Math.min(current, score.final)
          : Math.max(current, score.final),
      scores[0].final,
    );
  }

  private frequency(values: readonly string[]) {
    const count = new Map<string, number>();
    for (const value of values) count.set(value, (count.get(value) ?? 0) + 1);
    return Object.freeze(
      [...count.entries()]
        .map(([code, value]) => Object.freeze({ code, count: value }))
        .sort((left, right) =>
          right.count === left.count
            ? left.code.localeCompare(right.code)
            : right.count - left.count,
        ),
    );
  }

  private averageMetric(values: readonly (number | null)[]): number | null {
    const available = values.filter((value): value is number => value !== null);
    return available.length === 0
      ? null
      : this.round(
          available.reduce((total, value) => total + value, 0) /
            available.length,
        );
  }

  private round(value: number): number {
    return Math.round(value * 100) / 100;
  }
}
