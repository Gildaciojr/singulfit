import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CONVERSATION_GOAL,
  ConversationGoal,
} from '../context/conversation-goal-planner.contract';
import type { CoachProfileCompletionState } from '../context/coach-profile-snapshot.contract';
import type {
  LongitudinalCoachingAction,
  LongitudinalCoachingState,
} from '../longitudinal-coaching/longitudinal-coaching.contract';
import type {
  NutritionInterventionIntensity,
  NutritionPersonalizationLevel,
  NutritionRecommendedComplexity,
} from '../nutrition-reasoning/nutrition-reasoning.contract';
import type {
  UnifiedShadowComparisonCategory,
  UnifiedShadowExecutionArtifacts,
} from '../unified-shadow-decision/unified-shadow-decision.contract';
import type {
  WorkoutComplexityLevel,
  WorkoutInterventionIntensity,
  WorkoutProgressionDecision,
} from '../workout-reasoning/workout-reasoning.contract';
import {
  WORKOUT_MODALITY,
  WorkoutModality,
} from '../workout/v2/workout-planning-artifact.contract';
import type {
  ShadowEvaluationRunInput,
  ShadowMetricsSnapshot,
} from './shadow-evaluation.contract';
import { ShadowEvaluationPlatform } from './shadow-evaluation-platform';
import { ShadowMetricsAggregator } from './shadow-metrics-aggregator';
import { ShadowMetricsVersionComparator } from './shadow-metrics-version-comparator';

interface FixtureOptions {
  readonly runId?: string;
  readonly availableFields?: number;
  readonly completionState?: CoachProfileCompletionState;
  readonly confirmation?: boolean;
  readonly plannerGoal?: ConversationGoal;
  readonly nutritionIntensity?: NutritionInterventionIntensity;
  readonly nutritionComplexity?: NutritionRecommendedComplexity;
  readonly nutritionPersonalization?: NutritionPersonalizationLevel;
  readonly workoutModality?: WorkoutModality | null;
  readonly workoutIntensity?: WorkoutInterventionIntensity;
  readonly workoutComplexity?: WorkoutComplexityLevel;
  readonly workoutProgression?: WorkoutProgressionDecision;
  readonly longitudinalState?: LongitudinalCoachingState;
  readonly longitudinalDecision?: LongitudinalCoachingAction;
  readonly comparisonCategory?: UnifiedShadowComparisonCategory;
  readonly safetyCritical?: boolean;
  readonly clinicalContext?: boolean;
  readonly latencyBase?: number;
}

describe('Shadow Observability & Evaluation Platform', () => {
  const platform = new ShadowEvaluationPlatform();
  const aggregator = new ShadowMetricsAggregator();
  const versionComparator = new ShadowMetricsVersionComparator();

  function fixture<T>(value: unknown): T {
    return value as T;
  }

  function input(options: FixtureOptions = {}): ShadowEvaluationRunInput {
    const requiredFields = ['DISPLAY_NAME', 'AGE', 'PRIMARY_GOAL'] as const;
    const availableCount = options.availableFields ?? 3;
    const availableFields = requiredFields.slice(0, availableCount);
    const missingFields = requiredFields.slice(availableCount);
    const confirmationFields = options.confirmation
      ? (['PRIMARY_GOAL'] as const)
      : ([] as const);
    const completionState =
      options.completionState ??
      (availableCount === requiredFields.length
        ? 'COMPLETE'
        : availableCount === 0
          ? 'INSUFFICIENT'
          : 'PARTIAL');
    const nutritionIntensity = options.nutritionIntensity ?? 'MODERATE';
    const nutritionComplexity = options.nutritionComplexity ?? 'MODERATE';
    const nutritionPersonalization =
      options.nutritionPersonalization ?? 'CONTEXTUAL';
    const workoutModality =
      options.workoutModality === undefined
        ? WORKOUT_MODALITY.GENERAL_FITNESS
        : options.workoutModality;
    const workoutIntensity = options.workoutIntensity ?? 'MODERATE';
    const workoutComplexity = options.workoutComplexity ?? 'STANDARD';
    const workoutProgression = options.workoutProgression ?? 'MAINTAIN';
    const longitudinalDecision = options.longitudinalDecision ?? 'KEEP_PLAN';
    const comparisonCategory = options.comparisonCategory ?? 'EXACT_MATCH';
    const latencyBase = options.latencyBase ?? 1;
    const artifacts = fixture<UnifiedShadowExecutionArtifacts>({
      adaptiveDecision: {
        intent: 'COMBINED_PLAN_REQUEST',
        shouldAsk: missingFields.length > 0 || options.confirmation === true,
        selectedCandidate: null,
        orderedCandidates: missingFields.map((field) => ({
          field,
          knowledgeStatus: 'UNKNOWN',
          state: 'READY_TO_ASK',
        })),
        readiness: [],
        reason: missingFields.length > 0 ? 'FIELD_SELECTED' : 'PROFILE_READY',
      },
      plannerDecision: {
        recognizedIntent: 'COMBINED_PLAN_REQUEST',
        goal: options.plannerGoal ?? CONVERSATION_GOAL.GENERATE_COMBINED_PLANS,
        targetPlan: 'BOTH',
        canExecute: true,
      },
      longitudinalDecision: {
        currentState: options.longitudinalState ?? 'STABLE',
        decision: longitudinalDecision,
        priorities: { safety: options.safetyCritical ? 'CRITICAL' : 'LOW' },
        interventionIntensity: options.safetyCritical ? 'RESTRICTED' : 'LOW',
        risks: options.clinicalContext
          ? [{ code: 'CLINICAL_BOUNDARY', severity: 'HIGH', domain: 'SAFETY' }]
          : [],
        metadata: { deterministic: true, policyVersion: '2026.07.1' },
      },
      nutritionReasoning: {
        packageDecisions: [
          { packageId: 'weight-loss', disposition: 'REQUIRED' },
          { packageId: 'sports-nutrition', disposition: 'DISCARDED' },
        ],
        resolvedConflicts: [{ conflict: 'ADHERENCE_OVER_COMPLEXITY' }],
        priorities: { adherence: 'HIGH', safety: 'CRITICAL' },
        interventionIntensity: nutritionIntensity,
        recommendedComplexity: nutritionComplexity,
        personalizationLevel: nutritionPersonalization,
        selectedStrategies: [{ strategy: 'ENERGY_BALANCE' }],
        prohibitedStrategies: [{ strategy: 'AGGRESSIVE_RESTRICTION' }],
        metadata: {
          safetyRestricted: nutritionIntensity === 'RESTRICTED',
          deterministic: true,
          strategyVersion: '2026.07.1',
        },
      },
      workoutReasoning: {
        primaryObjective: 'HYPERTROPHY',
        modality: { resolved: workoutModality },
        knowledgeDecisions: [
          { packageId: 'hypertrophy', disposition: 'REQUIRED' },
          { packageId: 'advanced-training', disposition: 'DISCARDED' },
        ],
        resolvedConflicts: [{ conflict: 'LOW_ADHERENCE_COMPLEX_PLAN' }],
        priorities: { safety: 'CRITICAL', adherence: 'HIGH' },
        interventionIntensity: workoutIntensity,
        authorizedComplexity: workoutComplexity,
        progressionDecision: workoutProgression,
        selectedStrategies: [{ strategy: 'ADHERENCE_FIRST' }],
        prohibitedStrategies: [
          { prohibition: 'ADVANCED_MOVEMENTS_FOR_BEGINNER' },
        ],
        metadata: {
          safetyRestricted: workoutIntensity === 'BLOCKED',
          deterministic: true,
          strategyVersion: '2026.07.1',
        },
      },
      nutritionLegacyStrategy: {},
      workoutLegacyStrategy: {
        objective: { status: 'CONFIRMED', value: 'HYPERTROPHY' },
      },
      nutritionShadowStrategy: { personalization: nutritionPersonalization },
      workoutShadowStrategy: { personalization: nutritionPersonalization },
    });
    const differences =
      comparisonCategory === 'EXACT_MATCH'
        ? []
        : [
            {
              domain: 'WORKOUT',
              dimension: 'INTENSITY',
              legacyValue: 'LOW',
              shadowValue: workoutIntensity,
            },
            {
              domain: 'LONGITUDINAL',
              dimension: 'LONGITUDINAL_DECISION',
              legacyValue: 'WAIT',
              shadowValue: longitudinalDecision,
            },
          ];

    return fixture<ShadowEvaluationRunInput>({
      runId: options.runId ?? 'run-1',
      snapshot: {
        completion: {
          overall: completionState,
          sections: [
            {
              section: 'GENERAL',
              state: completionState,
              ready: completionState === 'COMPLETE',
              requiredFields,
              availableFields,
              missingFields,
              confirmationRequiredFields: confirmationFields,
            },
          ],
        },
        referenceDate: '2026-07-16T12:00:00.000Z',
      },
      artifacts,
      pipelineResult: {
        status: 'COMPLETED',
        comparison: {
          comparatorVersion: '2026.07.1',
          nutrition: {
            category: comparisonCategory,
            exact: comparisonCategory === 'EXACT_MATCH',
            differences,
          },
          workout: {
            category: comparisonCategory,
            exact: comparisonCategory === 'EXACT_MATCH',
            differences,
          },
          longitudinal: {
            category: comparisonCategory,
            exact: comparisonCategory === 'EXACT_MATCH',
            differences,
          },
          overallCategory: comparisonCategory,
        },
        auditMetadata: {
          latency: {
            collectorMs: latencyBase,
            plannerMs: latencyBase + 1,
            longitudinalMs: latencyBase + 2,
            nutritionReasoningMs: latencyBase + 3,
            workoutReasoningMs: latencyBase + 4,
            nutritionStrategyMs: latencyBase + 5,
            workoutStrategyMs: latencyBase + 6,
            adaptersMs: latencyBase + 7,
            comparatorMs: latencyBase + 8,
            totalMs: latencyBase + 9,
          },
          versions: {
            adapter: '2026.07.1',
            comparator: '2026.07.1',
            pipeline: '2026.07.1',
            nutritionReasoning: '2026.07.1',
            workoutReasoning: '2026.07.1',
            longitudinalPolicy: '2026.07.1',
          },
        },
        auditPersisted: false,
      },
    });
  }

  it.each([
    [3, 'COMPLETE', 100, 0],
    [1, 'PARTIAL', 33.33, 2],
    [0, 'INSUFFICIENT', 0, 3],
  ] as const)(
    'measures complete, partial and empty snapshots',
    (availableFields, state, expectedCoverage, expectedQuestions) => {
      const report = platform.evaluate(
        input({ availableFields, completionState: state }),
      );

      expect(report.collector.snapshotCoverageRate).toBe(expectedCoverage);
      expect(report.collector.estimatedQuestionsRequired).toBe(
        expectedQuestions,
      );
      expect(report.collector.completionState).toBe(state);
    },
  );

  it('measures confirmation separately from unknown fields', () => {
    const report = platform.evaluate(
      input({ availableFields: 2, confirmation: true }),
    );

    expect(report.collector.confirmationFields).toEqual(['PRIMARY_GOAL']);
    expect(report.collector.confirmationRate).toBeGreaterThan(0);
    expect(report.collector.unknownRate).toBeGreaterThan(0);
  });

  it('supports every Planner goal without interpreting or changing it', () => {
    for (const goal of Object.values(CONVERSATION_GOAL)) {
      const report = platform.evaluate(input({ plannerGoal: goal }));
      expect(report.planner.selectedGoal).toBe(goal);
    }
  });

  it('covers every Nutrition intensity and complexity', () => {
    const intensities: readonly NutritionInterventionIntensity[] = [
      'LOW',
      'MODERATE',
      'HIGH',
      'RESTRICTED',
    ];
    const complexities: readonly NutritionRecommendedComplexity[] = [
      'MINIMAL',
      'SIMPLE',
      'MODERATE',
      'DETAILED',
    ];
    for (const intensity of intensities) {
      for (const complexity of complexities) {
        const report = platform.evaluate(
          input({
            nutritionIntensity: intensity,
            nutritionComplexity: complexity,
          }),
        );
        expect(report.nutrition).toMatchObject({ intensity, complexity });
      }
    }
  });

  it('reports Nutrition packages, conflicts, priorities and strategies', () => {
    const nutrition = platform.evaluate(input()).nutrition;

    expect(nutrition).toMatchObject({
      usedKnowledgePackages: ['weight-loss'],
      discardedKnowledgePackages: ['sports-nutrition'],
      conflicts: ['ADHERENCE_OVER_COMPLEXITY'],
      strategies: ['ENERGY_BALANCE'],
      prohibitedStrategies: ['AGGRESSIVE_RESTRICTION'],
    });
    expect(nutrition?.priorities.map((priority) => priority.name)).toEqual([
      'adherence',
      'safety',
    ]);
  });

  it('covers Workout modalities, intensities, complexities and progressions', () => {
    const intensities: readonly WorkoutInterventionIntensity[] = [
      'RECOVERY',
      'LOW',
      'MODERATE',
      'MODERATE_HIGH',
      'HIGH',
      'BLOCKED',
    ];
    const complexities: readonly WorkoutComplexityLevel[] = [
      'MINIMAL',
      'SIMPLE',
      'STANDARD',
      'DETAILED',
      'ADVANCED',
      'RESTRICTED',
    ];
    const progressions: readonly WorkoutProgressionDecision[] = [
      'MAINTAIN',
      'PROGRESS',
      'REGRESS',
      'DELOAD',
      'REASSESS',
      'PAUSE',
    ];
    for (const modality of Object.values(WORKOUT_MODALITY)) {
      expect(
        platform.evaluate(input({ workoutModality: modality })).workout
          ?.modality,
      ).toBe(modality);
    }
    for (const intensity of intensities) {
      expect(
        platform.evaluate(input({ workoutIntensity: intensity })).workout
          ?.intensity,
      ).toBe(intensity);
    }
    for (const complexity of complexities) {
      expect(
        platform.evaluate(input({ workoutComplexity: complexity })).workout
          ?.complexity,
      ).toBe(complexity);
    }
    for (const progression of progressions) {
      expect(
        platform.evaluate(input({ workoutProgression: progression })).workout
          ?.progression,
      ).toBe(progression);
    }
  });

  it('covers every Longitudinal state and decision', () => {
    const states: readonly LongitudinalCoachingState[] = [
      'IMPROVING',
      'STABLE',
      'PLATEAU',
      'REGRESSING',
      'UNKNOWN',
    ];
    const decisions: readonly LongitudinalCoachingAction[] = [
      'KEEP_PLAN',
      'ADAPT_PLAN',
      'REVIEW',
      'DELOAD',
      'INCREASE',
      'REDUCE',
      'WAIT',
      'ASK_INFORMATION',
    ];
    for (const state of states) {
      expect(
        platform.evaluate(input({ longitudinalState: state })).longitudinal
          .state,
      ).toBe(state);
    }
    for (const decision of decisions) {
      expect(
        platform.evaluate(input({ longitudinalDecision: decision }))
          .longitudinal.decision,
      ).toBe(decision);
    }
  });

  it('covers every Comparator category and divergence dimension', () => {
    const categories: readonly UnifiedShadowComparisonCategory[] = [
      'EXACT_MATCH',
      'COMPATIBLE',
      'MORE_CONSERVATIVE',
      'MORE_AGGRESSIVE',
      'MORE_PERSONALIZED',
      'LESS_PERSONALIZED',
      'CONFLICT',
    ];
    for (const category of categories) {
      const report = platform.evaluate(input({ comparisonCategory: category }));
      expect(report.comparator.overallCategory).toBe(category);
      expect(report.comparator.intensityDivergence).toBe(
        category !== 'EXACT_MATCH',
      );
      expect(report.comparator.longitudinalDivergence).toBe(
        category !== 'EXACT_MATCH',
      );
    }
  });

  it('records only safety categories, never clinical details', () => {
    const report = platform.evaluate(
      input({
        nutritionIntensity: 'RESTRICTED',
        workoutIntensity: 'BLOCKED',
        workoutProgression: 'PAUSE',
        longitudinalDecision: 'REVIEW',
        safetyCritical: true,
        clinicalContext: true,
      }),
    );

    expect(report.safety.categories).toEqual([
      'CLINICAL_CONTEXT',
      'MANDATORY_REVIEW',
      'PAUSE',
      'SAFETY_BLOCKED',
      'SAFETY_CRITICAL',
    ]);
    expect(JSON.stringify(report.safety)).not.toMatch(
      /diagnosis|medicalCondition|freeText/i,
    );
  });

  it('aggregates distributions and performance statistics', () => {
    const reports = [
      platform.evaluate(input({ runId: 'a', latencyBase: 1 })),
      platform.evaluate(input({ runId: 'b', latencyBase: 3 })),
      platform.evaluate(input({ runId: 'c', latencyBase: 5 })),
    ];
    const snapshot = aggregator.aggregate('v1', reports);

    expect(snapshot.runCount).toBe(3);
    expect(snapshot.performance.collector).toEqual({
      count: 3,
      mean: 3,
      median: 3,
      minimum: 1,
      maximum: 5,
    });
    expect(snapshot.metrics.planner.goals).toEqual([
      { value: 'GENERATE_COMBINED_PLANS', count: 3, percentage: 100 },
    ]);
    expect(snapshot.metrics.nutrition.packagesUsed).toEqual([
      { value: 'weight-loss', count: 3, percentage: 100 },
    ]);
    expect(snapshot.metrics.nutrition.priorities).toContainEqual({
      value: 'adherence:HIGH',
      count: 3,
      percentage: 50,
    });
    expect(snapshot.metrics.workout.priorities).toContainEqual({
      value: 'safety:CRITICAL',
      count: 3,
      percentage: 50,
    });
    expect(snapshot.metrics.comparator.intensityDivergenceRate).toBe(0);
  });

  it('calculates a deterministic scorecard from documented ratios', () => {
    const report = platform.evaluate(input());

    expect(report.scorecard).toEqual({
      coverageScore: 100,
      agreementScore: 100,
      safetyScore: 100,
      consistencyScore: 100,
      determinismScore: 100,
      personalizationScore: 50,
    });
  });

  it('compares versions and exposes deterministic directional deltas', () => {
    const previous = aggregator.aggregate('v1', [
      platform.evaluate(
        input({
          comparisonCategory: 'CONFLICT',
          nutritionIntensity: 'HIGH',
          workoutIntensity: 'HIGH',
          nutritionPersonalization: 'BASIC',
          safetyCritical: true,
          longitudinalDecision: 'KEEP_PLAN',
        }),
      ),
    ]);
    const current = aggregator.aggregate('v2', [
      platform.evaluate(
        input({
          comparisonCategory: 'EXACT_MATCH',
          nutritionIntensity: 'LOW',
          workoutIntensity: 'LOW',
          nutritionPersonalization: 'HIGH',
          safetyCritical: true,
          longitudinalDecision: 'REVIEW',
        }),
      ),
    ]);
    const comparison = versionComparator.compare(previous, current);

    expect(comparison).toMatchObject({
      agreementImproved: true,
      conflictsReduced: true,
      personalizationImproved: true,
      intensityReduced: true,
      safetyImproved: true,
      distributionChanged: true,
    });
    expect(Object.isFrozen(comparison.comparatorDistribution)).toBe(true);
  });

  it('is deterministic, serializable, deeply frozen and does not mutate input', () => {
    const observed = input();
    const before = JSON.stringify(observed);
    const first = platform.evaluate(observed);
    const second = platform.evaluate(observed);

    expect(first).toEqual(second);
    expect(JSON.stringify(observed)).toBe(before);
    expect(JSON.parse(JSON.stringify(first))).toEqual(first);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.collector.collectedFields)).toBe(true);
    expect(Object.isFrozen(first.scorecard)).toBe(true);
    expect(() =>
      Object.defineProperty(first.scorecard, 'coverageScore', { value: 0 }),
    ).toThrow();
  });

  it('keeps aggregate snapshots deterministic and deeply frozen', () => {
    const reports = [platform.evaluate(input({ runId: 'a' }))];
    const first = aggregator.aggregate('v1', reports);
    const second = aggregator.aggregate('v1', reports);

    expect(first).toEqual(second);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.metrics.comparator.overall)).toBe(true);
  });

  it('is absent from production modules and protected execution services', () => {
    const protectedSources = [
      'responses/response.module.ts',
      'responses/response-builder.service.ts',
      'automation/automation.module.ts',
      'automation/coach-command.service.ts',
      'unified-shadow-decision/unified-shadow-decision-pipeline.service.ts',
    ].map((path) => readFileSync(join(__dirname, '..', path), 'utf8'));

    for (const source of protectedSources) {
      expect(source).not.toContain('ShadowEvaluationPlatform');
      expect(source).not.toContain('ShadowMetricsAggregator');
    }
  });

  it('does not require mutable state between aggregations', () => {
    const empty: ShadowMetricsSnapshot = aggregator.aggregate('empty', []);
    expect(empty.runCount).toBe(0);
    expect(empty.metrics.comparator.overall).toEqual([]);
    expect(empty.performance.total.count).toBe(0);
  });
});
