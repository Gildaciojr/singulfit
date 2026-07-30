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
import { NutritionConversationCoachStyleEngine } from './nutrition-conversation-coach-style.engine';

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
    private readonly coachStyleEngine = new NutritionConversationCoachStyleEngine(),
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
    const recognitionEvidencePreserved =
      this.recognitionEvidencePreserved(scenario);
    const genericPraiseAbsent = this.genericPraiseAbsent(scenario);
    const emotionalEvidencePreserved =
      this.emotionalEvidencePreserved(scenario);
    const unsafeEmotionalLanguageAbsent =
      this.unsafeEmotionalLanguageAbsent(scenario);
    const dialogue = this.dialogueMetrics(scenario);
    const episodicMemory = this.episodicMemoryMetrics(scenario);
    const humanization = this.coachStyleEngine.evaluate(
      scenario.payload,
      scenario.candidate?.candidateText ?? '',
      scenario.candidate?.realizedUnits ?? [],
    );
    const metrics = Object.freeze({
      ...comparison.metrics,
      promptTokens: scenario.usage.promptTokens,
      completionTokens: scenario.usage.completionTokens,
      totalTokens: scenario.usage.totalTokens,
      foodsPreserved,
      recommendationsPreserved,
      recognitionEvidencePreserved,
      genericPraiseAbsent,
      emotionalEvidencePreserved,
      unsafeEmotionalLanguageAbsent,
      ...dialogue,
      ...episodicMemory,
      ...humanization.metrics,
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
      ...(!recognitionEvidencePreserved
        ? ['FAILED:RECOGNITION_EVIDENCE_PRESERVED']
        : []),
      ...(!genericPraiseAbsent ? ['FAILED:GENERIC_PRAISE_PRESENT'] : []),
      ...(!emotionalEvidencePreserved
        ? ['FAILED:EMOTIONAL_EVIDENCE_PRESERVED']
        : []),
      ...(!unsafeEmotionalLanguageAbsent
        ? ['FAILED:UNSAFE_EMOTIONAL_LANGUAGE_PRESENT']
        : []),
      ...Object.entries(dialogue).flatMap(([metric, passed]) =>
        passed ? [] : [`FAILED:${this.metricCode(metric)}`],
      ),
      ...Object.entries(episodicMemory).flatMap(([metric, passed]) =>
        passed ? [] : [`FAILED:${this.metricCode(metric)}`],
      ),
      ...humanization.violations.map(
        (violation) => `FAILED:COACH_STYLE_${violation}`,
      ),
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

  private recognitionEvidencePreserved(
    scenario: ConversationEvaluationScenario,
  ): boolean {
    const decisions = new Set([
      'ACKNOWLEDGE_EFFORT',
      'ACKNOWLEDGE_PROGRESS',
      'ACKNOWLEDGE_RECOVERY',
      'ACKNOWLEDGE_SMALL_WIN',
      'ACKNOWLEDGE_CONSISTENCY',
      'ACKNOWLEDGE_STRATEGY',
      'ACKNOWLEDGE_DISCIPLINE',
      'ACKNOWLEDGE_IMPROVEMENT',
    ]);
    return (
      scenario.candidate?.realizedUnits.every((unit) => {
        const recognizes = unit.decisionCodes.some((decision) =>
          decisions.has(decision),
        );
        return (
          !recognizes ||
          unit.factKeys.some((fact) => fact.startsWith('recognition.'))
        );
      }) ?? true
    );
  }

  private genericPraiseAbsent(
    scenario: ConversationEvaluationScenario,
  ): boolean {
    const text = scenario.candidate?.candidateText?.trim() ?? '';
    return !/^(?:parab[eé]ns|excelente|muito bem|continue assim)[!.\s]*$/iu.test(
      text,
    );
  }

  private emotionalEvidencePreserved(
    scenario: ConversationEvaluationScenario,
  ): boolean {
    const decisions = new Set([
      'VALIDATE_FRUSTRATION',
      'REINFORCE_CONFIDENCE',
      'REDUCE_COGNITIVE_LOAD',
      'NORMALIZE_SETBACK',
      'SIMPLIFY_GUIDANCE',
      'ENCOURAGE_CONTINUITY',
      'ANSWER_CURIOSITY',
    ]);
    return (
      scenario.candidate?.realizedUnits.every((unit) => {
        const adaptsEmotionally = unit.decisionCodes.some((decision) =>
          decisions.has(decision),
        );
        return (
          !adaptsEmotionally ||
          unit.factKeys.some((fact) => fact.startsWith('emotional.'))
        );
      }) ?? true
    );
  }

  private unsafeEmotionalLanguageAbsent(
    scenario: ConversationEvaluationScenario,
  ): boolean {
    const text = scenario.candidate?.candidateText ?? '';
    return ![
      /\bvoc[eê] (?:est[aá]|parece) (?:triste|ansios[oa]|desmotivad[oa]|frustrad[oa]|sobrecarregad[oa]|satisfeit[oa]|confiante|resistente|curios[oa]|cansad[oa])\b/iu,
      /\b(?:a culpa [ée] sua|voc[eê] falhou|se voc[eê] realmente quisesse|tenho pena|coitad[oa]|garanto que|prometo que)\b/iu,
    ].some((pattern) => pattern.test(text));
  }

  private dialogueMetrics(scenario: ConversationEvaluationScenario) {
    const payload = scenario.payload;
    const candidate = scenario.candidate;
    const decisions = new Set<string>(candidate?.realizedDecisions ?? []);
    const units = candidate?.realizedUnits ?? [];
    const paragraphCount = candidate?.candidateText
      ? candidate.candidateText.split(/\n\s*\n/u).filter(Boolean).length
      : 0;
    const actionCount = units.filter(
      (unit) => unit.claims.usesRecommendation,
    ).length;
    const hasTechnicalHeading =
      /^(?:resumo nutricional|motivação|seu ritmo|evolução longitudinal|evidência nutricional|acompanhamento comportamental)\s*:/imu.test(
        candidate?.candidateText ?? '',
      );
    const profileRespected =
      payload.structure.blocks.length <= payload.limits.maximumBlocks &&
      payload.structure.paragraphCount <= payload.limits.maximumParagraphs;
    const questionBudgetRespected =
      (candidate?.producedQuestionCount ?? 0) <=
      payload.limits.maximumQuestions;
    const actionBudgetRespected = actionCount <= payload.limits.maximumActions;
    const unnecessaryQuestionAbsent =
      payload.limits.maximumQuestions > 0 ||
      (candidate?.producedQuestionCount ?? 0) === 0;
    const unnecessaryRecommendationAbsent =
      decisions.has('PROVIDE_RECOMMENDATION') || actionCount === 0;
    const detailedAnalysisUsedOnlyWhenEligible =
      payload.structure.dialogueProfile === 'DETAILED_ANALYSIS'
        ? decisions.has('DETAIL_ANALYSIS') && payload.structure.depth === 'DEEP'
        : !decisions.has('DETAIL_ANALYSIS');
    const recoveryStayedBrief =
      payload.structure.dialogueProfile !== 'RECOVERY' ||
      (paragraphCount <= 3 &&
        !decisions.has('DETAIL_ANALYSIS') &&
        (candidate?.producedLength ?? 0) <= payload.limits.maximumLength);
    const celebrationStayedFocused =
      payload.structure.dialogueProfile !== 'CELEBRATE' ||
      (paragraphCount <= 2 &&
        !decisions.has('PROVIDE_RECOMMENDATION') &&
        !decisions.has('CORRECT_LIMITING_FACTOR'));
    const clarificationAvoidedSpeculation =
      payload.structure.dialogueProfile !== 'CLARIFY_BEFORE_ANALYSIS' ||
      (![
        'SHOW_CALORIES',
        'SHOW_PROTEIN',
        'SHOW_CARBOHYDRATES',
        'SHOW_FAT',
        'SHOW_QUALITY',
        'PROVIDE_RECOMMENDATION',
      ].some((decision) => decisions.has(decision)) &&
        decisions.has('ASK_QUESTION'));
    const technicalHeadingsAbsentWhenProhibited =
      payload.structure.dialogueProfile === 'DETAILED_ANALYSIS' ||
      !hasTechnicalHeading;

    return Object.freeze({
      profileRespected,
      centralIntentPreserved: profileRespected,
      paragraphBudgetRespected:
        paragraphCount <= payload.limits.maximumParagraphs,
      questionBudgetRespected,
      actionBudgetRespected,
      unnecessaryQuestionAbsent,
      unnecessaryRecommendationAbsent,
      detailedAnalysisUsedOnlyWhenEligible,
      recoveryStayedBrief,
      celebrationStayedFocused,
      clarificationAvoidedSpeculation,
      technicalHeadingsAbsentWhenProhibited,
      structuralDiversity:
        profileRespected &&
        payload.structure.dialogueProfile.length > 0 &&
        payload.structure.centralIntent.length > 0,
    });
  }

  private episodicMemoryMetrics(scenario: ConversationEvaluationScenario) {
    const payloadFacts = [
      ...scenario.payload.facts.allowed,
      ...scenario.payload.facts.sensitive,
    ];
    const episodicFacts = new Set(
      payloadFacts
        .filter((fact) => fact.key.startsWith('episodicMemory.'))
        .map((fact) => fact.key),
    );
    const units = scenario.candidate?.realizedUnits ?? [];
    const memoryUnits = units.filter((unit) => unit.claims.usesMemory);
    const realizedEpisodicFacts = memoryUnits.flatMap((unit) =>
      unit.factKeys.filter((fact) => fact.startsWith('episodicMemory.')),
    );
    const serializedFacts = JSON.stringify(payloadFacts);
    const continuityNatural = memoryUnits.every(
      (unit) =>
        !/^(?:memória|histórico|última conversa|continuidade)\s*:/imu.test(
          unit.text,
        ),
    );
    const episodeRelevance = payloadFacts
      .filter((fact) => episodicFacts.has(fact.key))
      .every(
        (fact) =>
          this.isRecord(fact.value) &&
          typeof fact.value.relationToContext === 'string' &&
          fact.value.relationToContext.trim().length > 0 &&
          typeof fact.value.recallReason === 'string',
      );

    return Object.freeze({
      memoryRecallCorrect: realizedEpisodicFacts.every((fact) =>
        episodicFacts.has(fact),
      ),
      memoryRecallNecessary:
        episodicFacts.size > 0 || realizedEpisodicFacts.length === 0,
      memoryNotInvented: memoryUnits.every((unit) =>
        unit.factKeys.some(
          (fact) => fact === 'userContext.memory' || episodicFacts.has(fact),
        ),
      ),
      continuityNatural,
      episodeRelevance,
      episodeReuse:
        new Set(realizedEpisodicFacts).size === realizedEpisodicFacts.length,
      episodeExpiration:
        !/expiresAt|createdAtLogical|lifecycle|confidence|continuityKey/iu.test(
          serializedFacts,
        ),
    });
  }

  private metricCode(metric: string): string {
    return metric.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase();
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
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
