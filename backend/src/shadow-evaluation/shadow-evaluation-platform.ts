import type { CoachProfileField } from '../context/coach-profile-snapshot.contract';
import type { UnifiedShadowComparisonCategory } from '../unified-shadow-decision/unified-shadow-decision.contract';
import {
  SHADOW_EVALUATION_PLATFORM_VERSION,
  SHADOW_EVALUATION_SCHEMA_VERSION,
  ShadowCollectorMetrics,
  ShadowComponentMetrics,
  ShadowDescriptiveStatistics,
  ShadowEvaluationReport,
  ShadowEvaluationRunInput,
  ShadowEvaluationScorecard,
  ShadowNutritionMetrics,
  ShadowPlannerMetrics,
  ShadowSafetyCategory,
  ShadowSafetyMetrics,
  ShadowWorkoutMetrics,
} from './shadow-evaluation.contract';

export class ShadowEvaluationPlatform {
  evaluate(input: ShadowEvaluationRunInput): ShadowEvaluationReport {
    const collector = this.collector(input);
    const planner = this.planner(input);
    const nutrition = this.nutrition(input);
    const workout = this.workout(input);
    const longitudinalDecision = input.artifacts.longitudinalDecision;
    const longitudinal = deepFreeze({
      state: longitudinalDecision.currentState,
      decision: longitudinalDecision.decision,
      safetyPriority: longitudinalDecision.priorities.safety,
      interventionIntensity: longitudinalDecision.interventionIntensity,
      riskCategories: uniqueSorted(
        longitudinalDecision.risks.map((risk) => risk.code),
      ),
    });
    const comparator = this.comparator(input);
    const safety = this.safety(input, nutrition, workout);
    const performance = this.performance(
      input.pipelineResult.auditMetadata.latency,
    );
    const scorecard = this.scorecard(
      input,
      collector,
      nutrition,
      workout,
      comparator,
      safety,
    );
    const categories = [
      comparator.nutritionCategory,
      comparator.workoutCategory,
      comparator.longitudinalCategory,
    ].filter(
      (value): value is UnifiedShadowComparisonCategory => value !== null,
    );

    return deepFreeze({
      schemaVersion: SHADOW_EVALUATION_SCHEMA_VERSION,
      platformVersion: SHADOW_EVALUATION_PLATFORM_VERSION,
      runId: input.runId,
      referenceDate: input.snapshot.referenceDate,
      collector,
      planner,
      nutrition,
      workout,
      longitudinal,
      comparator,
      safety,
      performance,
      scorecard,
      summary: {
        complete:
          input.snapshot.completion.overall === 'COMPLETE' &&
          !categories.includes('CONFLICT'),
        observedDomains: categories.length,
        conflictCount: categories.filter((value) => value === 'CONFLICT')
          .length,
        divergenceCount: comparator.divergenceDimensions.length,
        safetySignalCount: safety.signalCount,
      },
      versions: { ...input.pipelineResult.auditMetadata.versions },
    });
  }

  private collector(input: ShadowEvaluationRunInput): ShadowCollectorMetrics {
    const sections = input.snapshot.completion.sections;
    const totalFields = uniqueSorted(
      sections.flatMap((section) => section.requiredFields),
    );
    const collectedFields = uniqueSorted(
      sections.flatMap((section) => section.availableFields),
    );
    const pendingFields = uniqueSorted(
      sections.flatMap((section) => section.missingFields),
    );
    const candidates = input.artifacts.adaptiveDecision.orderedCandidates;
    const unknownFields = uniqueSorted(
      candidates
        .filter((candidate) => candidate.knowledgeStatus === 'UNKNOWN')
        .map((candidate) => candidate.field),
    );
    const confirmationFields = uniqueSorted([
      ...sections.flatMap((section) => section.confirmationRequiredFields),
      ...candidates
        .filter(
          (candidate) =>
            candidate.knowledgeStatus === 'REQUIRES_CONFIRMATION' ||
            candidate.state === 'WAITING_CONFIRMATION',
        )
        .map((candidate) => candidate.field),
    ]);
    const questions = uniqueSorted([...pendingFields, ...confirmationFields]);
    const denominator = Math.max(totalFields.length, candidates.length);

    return deepFreeze({
      intent: input.artifacts.adaptiveDecision.intent,
      completionState: input.snapshot.completion.overall,
      collectedFields,
      pendingFields,
      unknownFields,
      confirmationFields,
      totalRequiredFields: totalFields.length,
      availableRequiredFields: collectedFields.filter((field) =>
        totalFields.includes(field),
      ).length,
      completionRate: percent(
        collectedFields.filter((field) => totalFields.includes(field)).length,
        totalFields.length,
      ),
      unknownRate: percent(unknownFields.length, denominator),
      confirmationRate: percent(confirmationFields.length, denominator),
      estimatedQuestionsRequired: questions.length,
      snapshotCoverageRate: percent(collectedFields.length, totalFields.length),
      shouldAsk: input.artifacts.adaptiveDecision.shouldAsk,
    });
  }

  private planner(input: ShadowEvaluationRunInput): ShadowPlannerMetrics {
    const decision = input.artifacts.plannerDecision;
    const revisionGoals = new Set([
      'UPDATE_DIET_PLAN',
      'UPDATE_WORKOUT_PLAN',
      'REVIEW_PROGRESS',
    ]);
    const planGoals = new Set([
      'GENERATE_DIET_PLAN',
      'GENERATE_WORKOUT_PLAN',
      'GENERATE_COMBINED_PLANS',
      'UPDATE_DIET_PLAN',
      'UPDATE_WORKOUT_PLAN',
    ]);
    return deepFreeze({
      recognizedIntent: decision.recognizedIntent,
      selectedGoal: decision.goal,
      targetPlan: decision.targetPlan,
      revision: revisionGoals.has(decision.goal),
      informationRequest: decision.goal === 'ASK_PROFILE_INFORMATION',
      planRequest: planGoals.has(decision.goal),
      canExecute: decision.canExecute,
    });
  }

  private nutrition(
    input: ShadowEvaluationRunInput,
  ): ShadowNutritionMetrics | null {
    const reasoning = input.artifacts.nutritionReasoning;
    if (!reasoning) return null;
    return deepFreeze({
      usedKnowledgePackages: uniqueSorted(
        reasoning.packageDecisions
          .filter((decision) => decision.disposition !== 'DISCARDED')
          .map((decision) => decision.packageId),
      ),
      discardedKnowledgePackages: uniqueSorted(
        reasoning.packageDecisions
          .filter((decision) => decision.disposition === 'DISCARDED')
          .map((decision) => decision.packageId),
      ),
      conflicts: uniqueSorted(
        reasoning.resolvedConflicts.map((conflict) => conflict.conflict),
      ),
      priorities: sortedPriorities(reasoning.priorities),
      intensity: reasoning.interventionIntensity,
      complexity: reasoning.recommendedComplexity,
      personalization: reasoning.personalizationLevel,
      strategies: uniqueSorted(
        reasoning.selectedStrategies.map((strategy) => strategy.strategy),
      ),
      prohibitedStrategies: uniqueSorted(
        reasoning.prohibitedStrategies.map((strategy) => strategy.strategy),
      ),
      safetyRestricted: reasoning.metadata.safetyRestricted,
    });
  }

  private workout(
    input: ShadowEvaluationRunInput,
  ): ShadowWorkoutMetrics | null {
    const reasoning = input.artifacts.workoutReasoning;
    if (!reasoning) return null;
    return deepFreeze({
      modality: reasoning.modality.resolved,
      usedKnowledgePackages: uniqueSorted(
        reasoning.knowledgeDecisions
          .filter((decision) => decision.disposition !== 'DISCARDED')
          .map((decision) => decision.packageId),
      ),
      discardedKnowledgePackages: uniqueSorted(
        reasoning.knowledgeDecisions
          .filter((decision) => decision.disposition === 'DISCARDED')
          .map((decision) => decision.packageId),
      ),
      conflicts: uniqueSorted(
        reasoning.resolvedConflicts.map((conflict) => conflict.conflict),
      ),
      priorities: sortedPriorities(reasoning.priorities),
      intensity: reasoning.interventionIntensity,
      complexity: reasoning.authorizedComplexity,
      progression: reasoning.progressionDecision,
      regression: reasoning.progressionDecision === 'REGRESS',
      deload: reasoning.progressionDecision === 'DELOAD',
      recovery: reasoning.interventionIntensity === 'RECOVERY',
      strategies: uniqueSorted(
        reasoning.selectedStrategies.map((strategy) => strategy.strategy),
      ),
      prohibitedStrategies: uniqueSorted(
        reasoning.prohibitedStrategies.map((strategy) => strategy.prohibition),
      ),
      safetyRestricted: reasoning.metadata.safetyRestricted,
    });
  }

  private comparator(input: ShadowEvaluationRunInput) {
    const comparison = input.pipelineResult.comparison;
    const dimensions = uniqueSorted(
      [
        ...(comparison.nutrition?.differences ?? []),
        ...(comparison.workout?.differences ?? []),
        ...comparison.longitudinal.differences,
      ].map((difference) => difference.dimension),
    );
    const categories = [
      comparison.nutrition?.category,
      comparison.workout?.category,
      comparison.longitudinal.category,
    ].filter(
      (value): value is UnifiedShadowComparisonCategory => value !== undefined,
    );
    return deepFreeze({
      overallCategory: comparison.overallCategory,
      nutritionCategory: comparison.nutrition?.category ?? null,
      workoutCategory: comparison.workout?.category ?? null,
      longitudinalCategory: comparison.longitudinal.category,
      agreementRate: percent(
        categories.filter(
          (category) => category === 'EXACT_MATCH' || category === 'COMPATIBLE',
        ).length,
        categories.length,
      ),
      divergenceDimensions: dimensions,
      modalityDivergence: dimensions.includes('MODALITY'),
      objectiveDivergence: this.objectiveDivergence(input),
      intensityDivergence: dimensions.includes('INTENSITY'),
      complexityDivergence: dimensions.includes('COMPLEXITY'),
      longitudinalDivergence: dimensions.includes('LONGITUDINAL_DECISION'),
    });
  }

  private objectiveDivergence(input: ShadowEvaluationRunInput): boolean {
    const legacy = input.artifacts.workoutLegacyStrategy;
    const shadow = input.artifacts.workoutReasoning;
    if (!legacy || !shadow || legacy.objective.status === 'NOT_SET')
      return false;
    return legacy.objective.value !== shadow.primaryObjective;
  }

  private safety(
    input: ShadowEvaluationRunInput,
    nutrition: ShadowNutritionMetrics | null,
    workout: ShadowWorkoutMetrics | null,
  ): ShadowSafetyMetrics {
    const longitudinal = input.artifacts.longitudinalDecision;
    const blocked =
      nutrition?.intensity === 'RESTRICTED' || workout?.intensity === 'BLOCKED';
    const critical = longitudinal.priorities.safety === 'CRITICAL';
    const mandatoryReview =
      longitudinal.decision === 'REVIEW' || workout?.progression === 'REASSESS';
    const mandatoryDeload =
      longitudinal.decision === 'DELOAD' || workout?.progression === 'DELOAD';
    const paused = workout?.progression === 'PAUSE';
    const clinicalContext = longitudinal.risks.some(
      (risk) => risk.code === 'CLINICAL_BOUNDARY',
    );
    const categories: ShadowSafetyCategory[] = [];
    if (blocked) categories.push('SAFETY_BLOCKED');
    if (critical) categories.push('SAFETY_CRITICAL');
    if (mandatoryReview) categories.push('MANDATORY_REVIEW');
    if (mandatoryDeload) categories.push('MANDATORY_DELOAD');
    if (paused) categories.push('PAUSE');
    if (clinicalContext) categories.push('CLINICAL_CONTEXT');

    const signals = [
      nutrition?.safetyRestricted ?? false,
      workout?.safetyRestricted ?? false,
      critical || clinicalContext,
    ];
    const responses = [
      nutrition?.intensity === 'RESTRICTED',
      workout
        ? workout.intensity === 'BLOCKED' ||
          workout.intensity === 'RECOVERY' ||
          workout.progression === 'REASSESS' ||
          workout.progression === 'DELOAD' ||
          workout.progression === 'PAUSE'
        : false,
      ['REVIEW', 'WAIT', 'ASK_INFORMATION', 'DELOAD', 'REDUCE'].includes(
        longitudinal.decision,
      ),
    ];
    return deepFreeze({
      categories: uniqueSorted(categories),
      blocked,
      critical,
      mandatoryReview,
      mandatoryDeload,
      paused,
      clinicalContext,
      signalCount: signals.filter(Boolean).length,
      restrictiveResponseCount: signals.filter(
        (signal, index) => signal && responses[index],
      ).length,
    });
  }

  private performance(
    latency: ShadowEvaluationRunInput['pipelineResult']['auditMetadata']['latency'],
  ): ShadowComponentMetrics {
    return deepFreeze({
      collector: statistics([latency.collectorMs]),
      planner: statistics([latency.plannerMs]),
      longitudinal: statistics([latency.longitudinalMs]),
      nutrition:
        latency.nutritionReasoningMs === null
          ? null
          : statistics([latency.nutritionReasoningMs]),
      workout:
        latency.workoutReasoningMs === null
          ? null
          : statistics([latency.workoutReasoningMs]),
      adapters: statistics([latency.adaptersMs]),
      comparator: statistics([latency.comparatorMs]),
      total: statistics([latency.totalMs]),
    });
  }

  private scorecard(
    input: ShadowEvaluationRunInput,
    collector: ShadowCollectorMetrics,
    nutrition: ShadowNutritionMetrics | null,
    workout: ShadowWorkoutMetrics | null,
    comparator: ReturnType<ShadowEvaluationPlatform['comparator']>,
    safety: ShadowSafetyMetrics,
  ): ShadowEvaluationScorecard {
    const categories = [
      comparator.nutritionCategory,
      comparator.workoutCategory,
      comparator.longitudinalCategory,
    ].filter(
      (value): value is UnifiedShadowComparisonCategory => value !== null,
    );
    const deterministic = [
      input.artifacts.longitudinalDecision.metadata.deterministic,
      input.artifacts.nutritionReasoning?.metadata.deterministic,
      input.artifacts.workoutReasoning?.metadata.deterministic,
    ].filter((value): value is true => value !== undefined);
    const personalization = [
      nutrition ? personalizationRank(nutrition.personalization) : null,
      workout
        ? personalizationRank(
            input.artifacts.workoutShadowStrategy?.personalization ?? 'BASIC',
          )
        : null,
    ].filter((value): value is number => value !== null);
    return deepFreeze({
      coverageScore: collector.snapshotCoverageRate,
      agreementScore: comparator.agreementRate,
      safetyScore:
        safety.signalCount === 0
          ? 100
          : percent(safety.restrictiveResponseCount, safety.signalCount),
      consistencyScore: percent(
        categories.filter((category) => category !== 'CONFLICT').length,
        categories.length,
      ),
      determinismScore: percent(
        deterministic.filter(Boolean).length,
        deterministic.length,
      ),
      personalizationScore: mean(personalization),
    });
  }
}

export function statistics(
  values: readonly number[],
): ShadowDescriptiveStatistics {
  const ordered = [...values].sort((left, right) => left - right);
  if (ordered.length === 0) {
    return Object.freeze({
      count: 0,
      mean: 0,
      median: 0,
      minimum: 0,
      maximum: 0,
    });
  }
  const middle = Math.floor(ordered.length / 2);
  const median =
    ordered.length % 2 === 0
      ? (ordered[middle - 1] + ordered[middle]) / 2
      : ordered[middle];
  return Object.freeze({
    count: ordered.length,
    mean: round(
      ordered.reduce((total, value) => total + value, 0) / ordered.length,
    ),
    median: round(median),
    minimum: ordered[0],
    maximum: ordered[ordered.length - 1],
  });
}

function sortedPriorities<T extends string>(
  priorities: { readonly [key: string]: T } | object,
): readonly { readonly name: string; readonly priority: T }[] {
  const entries = Object.entries(priorities) as [string, T][];
  return Object.freeze(
    entries
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, priority]) => Object.freeze({ name, priority })),
  );
}

function uniqueSorted<T extends string>(values: readonly T[]): readonly T[] {
  return Object.freeze([...new Set(values)].sort());
}

function personalizationRank(value: string): number {
  return value === 'HIGH' ? 100 : value === 'CONTEXTUAL' ? 50 : 0;
}

function percent(numerator: number, denominator: number): number {
  return denominator === 0 ? 100 : round((numerator / denominator) * 100);
}

function mean(values: readonly number[]): number {
  return values.length === 0
    ? 0
    : round(values.reduce((total, value) => total + value, 0) / values.length);
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
