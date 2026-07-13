import type {
  ConversationComparisonCheckCode,
  ConversationComparisonMetrics,
} from './conversation-comparison.contract';
import type {
  ConversationEvaluationReport,
  ConversationEvaluationScenario,
  ConversationEvaluationScores,
} from './conversation-evaluation-harness.contract';
import { NutritionConversationComparator } from './nutrition-conversation-comparator';
import { NutritionConversationLegacyCandidateAdapter } from './nutrition-conversation-legacy-candidate.adapter';

const FACTUAL_CHECKS: readonly ConversationComparisonCheckCode[] = [
  'AUTHORIZED_FACTS_PRESERVED',
  'AUTHORIZED_NUMBERS_PRESERVED',
  'DISCLAIMER_PRESERVED',
];
const STRUCTURAL_CHECKS: readonly ConversationComparisonCheckCode[] = [
  'LENGTH_WITHIN_LIMIT',
  'PARAGRAPH_COUNT_WITHIN_PLAN',
  'LIST_PRESENTATION_VALID',
  'QUESTION_COUNT_VALID',
  'EMOJI_COUNT_VALID',
  'NO_TECHNICAL_TITLE',
  'NO_REPORT_STRUCTURE',
  'NO_STRUCTURAL_REPETITION',
];
const DECISION_CHECKS: readonly ConversationComparisonCheckCode[] = [
  'DECISIONS_COVERED',
  'QUESTION_AUTHORIZED',
  'CLOSING_PRESERVED',
];
const COVERAGE_CHECKS: readonly ConversationComparisonCheckCode[] = [
  'BLOCKS_COVERED',
  'NO_UNDECLARED_OMISSIONS',
];

export class NutritionConversationEvaluationHarnessService {
  constructor(
    private readonly adapter = new NutritionConversationLegacyCandidateAdapter(),
    private readonly comparator = new NutritionConversationComparator(),
  ) {}

  evaluate(
    scenario: ConversationEvaluationScenario,
  ): ConversationEvaluationReport {
    const envelope = this.adapter.adapt(
      scenario.expectedLegacyResponse,
      scenario.candidate,
    );
    const comparison = this.comparator.compare({
      envelope,
      candidate: scenario.candidate,
      payload: scenario.payload,
      incrementalLatencyMs: scenario.incrementalLatencyMs,
    });
    const foodsPreserved = this.hasExpectedFoods(scenario);
    const recommendationsPreserved = this.hasExpectedRecommendations(scenario);
    const metrics = Object.freeze({
      ...comparison.metrics,
      promptTokens: scenario.usage.promptTokens,
      completionTokens: scenario.usage.completionTokens,
      totalTokens: scenario.usage.totalTokens,
      foodsPreserved,
      recommendationsPreserved,
      density: scenario.payload.structure.density,
      depth: scenario.payload.structure.depth,
    });
    const scores = this.scores(
      comparison.passedChecks,
      comparison.candidateEligible,
      foodsPreserved,
      recommendationsPreserved,
    );
    const objectiveReasons = Object.freeze([
      ...comparison.failedChecks.map((code) => `FAILED:${code}`),
      ...comparison.warnings.map((code) => `WARNING:${code}`),
      ...(!foodsPreserved ? ['FAILED:FOODS_PRESERVED'] : []),
      ...(!recommendationsPreserved
        ? ['FAILED:RECOMMENDATIONS_PRESERVED']
        : []),
    ]);

    return Object.freeze({
      scenarioId: scenario.id,
      summary: Object.freeze({
        passedCheckCount: comparison.passedChecks.length,
        failedCheckCount: comparison.failedChecks.length,
        warningCount: comparison.warnings.length,
        candidateState: comparison.candidateState,
      }),
      passedChecks: comparison.passedChecks,
      failedChecks: comparison.failedChecks,
      warnings: comparison.warnings,
      objectiveReasons,
      comparison,
      metrics,
      scores,
    });
  }

  private hasExpectedFoods(scenario: ConversationEvaluationScenario): boolean {
    const realizedFoods = new Set(
      scenario.candidate?.realizedUnits.flatMap((unit) => unit.claims.foods) ??
        [],
    );
    return scenario.expectedFoods.every((food) => realizedFoods.has(food));
  }

  private hasExpectedRecommendations(
    scenario: ConversationEvaluationScenario,
  ): boolean {
    return (
      scenario.expectedRecommendations.length === 0 ||
      scenario.candidate?.realizedUnits.some(
        (unit) => unit.claims.usesRecommendation,
      ) === true
    );
  }

  private scores(
    passed: readonly ConversationComparisonCheckCode[],
    candidateEligible: boolean,
    foodsPreserved: boolean,
    recommendationsPreserved: boolean,
  ): ConversationEvaluationScores {
    const factual = this.score(FACTUAL_CHECKS, passed, foodsPreserved);
    const structural = this.score(STRUCTURAL_CHECKS, passed);
    const decisionAdherence = this.score(DECISION_CHECKS, passed);
    const coverage = this.score(COVERAGE_CHECKS, passed);
    const completeness = candidateEligible
      ? this.score(COVERAGE_CHECKS, passed)
      : 0;
    const consistency =
      candidateEligible && recommendationsPreserved
        ? this.score(FACTUAL_CHECKS, passed)
        : 0;
    const final = this.round(
      (factual +
        structural +
        decisionAdherence +
        coverage +
        completeness +
        consistency) /
        6,
    );

    return Object.freeze({
      factual,
      structural,
      decisionAdherence,
      coverage,
      completeness,
      consistency,
      final,
    });
  }

  private score(
    checks: readonly ConversationComparisonCheckCode[],
    passed: readonly ConversationComparisonCheckCode[],
    additionalPassed = true,
  ): number {
    const passedCount = checks.filter((check) => passed.includes(check)).length;
    const denominator = checks.length + (additionalPassed === true ? 0 : 1);
    return this.round((passedCount / denominator) * 100);
  }

  private round(value: number): number {
    return Math.round(value * 100) / 100;
  }
}
