import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ShadowObservationEnvelope } from '../shadow-evaluation/shadow-observation-envelope.contract';
import { CoachingQualityEvaluationEngine } from './coaching-quality-evaluation-engine';

interface ObservationOptions {
  readonly nutritionPackages?: readonly string[];
  readonly nutritionStrategies?: readonly string[];
  readonly nutritionComplexity?: string;
  readonly nutritionPersonalization?: string;
  readonly nutritionRestricted?: boolean;
  readonly workoutPackages?: readonly string[];
  readonly workoutStrategies?: readonly string[];
  readonly workoutComplexity?: string;
  readonly workoutIntensity?: string;
  readonly workoutPersonalization?: string;
  readonly workoutProgression?: string;
  readonly workoutModality?: string | null;
  readonly workoutRestricted?: boolean;
  readonly state?: string;
  readonly action?: string;
  readonly shouldAsk?: boolean;
  readonly canExecute?: boolean;
  readonly goal?: string;
  readonly recognizedIntent?: string;
  readonly overallCategory?: string;
}

const EXCELLENT_NUTRITION_PACKAGES = [
  'FOOD_RESTRICTION_SAFETY',
  'FOOD_PREFERENCES',
  'BUDGET_LOW',
  'LIMITED_COOKING_TIME',
  'HYDRATION',
  'NUTRITION_EDUCATION_FOUNDATION',
  'SPORTS_NUTRITION_FOUNDATION',
  'HYPERTROPHY',
  'BEHAVIOR_ADHERENCE',
] as const;

const EXCELLENT_NUTRITION_STRATEGIES = [
  'CONSTRAINT_PRESERVATION',
  'EXTENSIVE_VARIETY',
  'PRACTICAL_MEALS',
  'QUICK_MEALS',
  'ECONOMIC_SELECTION',
  'HYDRATION_SUPPORT',
  'NUTRITION_EDUCATION',
  'PROTEIN_DISTRIBUTION',
  'RECOVERY_SUPPORT',
  'SATIETY_SUPPORT',
] as const;

const COMPLETE_WORKOUT_PACKAGES = [
  'BEGINNER',
  'EQUIPMENT_AVAILABLE',
  'ENVIRONMENT',
  'LIMITED_TIME',
  'MOTIVATION',
  'ADHERENCE',
  'RECOVERY',
  'SAFETY_FOUNDATION',
] as const;

const COMPLETE_WORKOUT_STRATEGIES = [
  'TECHNIQUE_PRIORITY',
  'CONSERVATIVE_PROGRESSION',
  'SIMPLE_SESSION',
  'LOW_FRICTION',
  'SHORT_SESSIONS',
  'EQUIPMENT_COMPATIBILITY',
  'ENVIRONMENT_COMPATIBILITY',
  'BETWEEN_SESSION_RECOVERY',
  'TRAINING_EDUCATION',
  'SUSTAINABLE_MOTIVATION',
] as const;

describe('CoachingQualityEvaluationEngine', () => {
  const engine = new CoachingQualityEvaluationEngine();

  describe('nutrition quality', () => {
    it('scores a complete, safe and personalized nutrition strategy as excellent', () => {
      const report = engine.evaluate(observation());

      expect(report.nutrition.score).toBeGreaterThanOrEqual(90);
      expect(report.nutrition.codes).toEqual(
        expect.arrayContaining([
          'RESTRICTIONS_RESPECTED',
          'GOOD_PROTEIN_DISTRIBUTION',
          'HYDRATION_SUPPORTED',
          'NUTRITION_EDUCATION_PRESENT',
        ]),
      );
    });

    it('scores a complex strategy without supporting factors below the excellent case', () => {
      const poor = engine.evaluate(
        observation({
          nutritionPackages: [],
          nutritionStrategies: [],
          nutritionComplexity: 'DETAILED',
          nutritionPersonalization: 'BASIC',
          workoutPersonalization: 'BASIC',
        }),
      );
      const excellent = engine.evaluate(observation());

      expect(poor.nutrition.score).toBeLessThan(excellent.nutrition.score);
      expect(poor.nutrition.codes).toContain('HIGH_COMPLEXITY');
    });

    it('reports controlled variety and does not invent actual repetition evidence', () => {
      const report = engine.evaluate(
        observation({ nutritionStrategies: ['CONTROLLED_VARIETY'] }),
      );

      expect(report.nutrition.codes).toContain('VARIETY_CONTROLLED');
      expect(
        criterionScore(report.nutrition.criteria, 'NUTRITION_REPETITION'),
      ).toBeNull();
      expect(report.nutrition.codes).toContain('REPETITION_NOT_OBSERVED');
    });

    it('recognizes an economical strategy', () => {
      const report = engine.evaluate(
        observation({
          nutritionPackages: ['BUDGET_LOW'],
          nutritionStrategies: ['ECONOMIC_SELECTION'],
        }),
      );

      expect(
        criterionScore(report.nutrition.criteria, 'NUTRITION_BUDGET'),
      ).toBe(100);
      expect(report.nutrition.codes).toContain('BUDGET_ALIGNED');
    });

    it('recognizes sports nutrition support without calculating calories', () => {
      const report = engine.evaluate(
        observation({
          nutritionPackages: ['SPORTS_NUTRITION_FOUNDATION', 'RUNNING'],
          nutritionStrategies: [
            'PROTEIN_DISTRIBUTION',
            'RECOVERY_SUPPORT',
            'HYDRATION_SUPPORT',
            'SPORTS_FUELING',
          ],
        }),
      );

      expect(report.nutrition.codes).toEqual(
        expect.arrayContaining([
          'GOOD_PROTEIN_DISTRIBUTION',
          'RECOVERY_SUPPORTED',
          'HYDRATION_SUPPORTED',
        ]),
      );
      expect(JSON.stringify(report)).not.toMatch(/calorie|caloria/i);
    });
  });

  describe('workout quality', () => {
    it('recognizes beginner compatibility and safe progress', () => {
      const report = engine.evaluate(observation());

      expect(report.workout.codes).toEqual(
        expect.arrayContaining(['EXPERIENCE_COMPATIBLE', 'SAFE_PROGRESS']),
      );
    });

    it('supports an advanced training context without generating a workout', () => {
      const report = engine.evaluate(
        observation({
          workoutPackages: ['ADVANCED', 'EQUIPMENT_AVAILABLE', 'ENVIRONMENT'],
          workoutComplexity: 'ADVANCED',
          workoutIntensity: 'HIGH',
        }),
      );

      expect(report.workout.codes).toContain('EXPERIENCE_COMPATIBLE');
      expect(report.workout.codes).toContain('HIGH_COMPLEXITY');
    });

    it.each([
      ['CrossFit', 'CROSSFIT', 'CROSSFIT'],
      ['running', 'RUNNING', 'RUNNING_ADAPTATION'],
      ['gym', 'GYM_STRENGTH', 'RESISTANCE_TRAINING'],
    ] as const)('recognizes the %s modality', (_label, modality, packageId) => {
      const report = engine.evaluate(
        observation({
          workoutModality: modality,
          workoutPackages: [packageId, 'INTERMEDIATE'],
        }),
      );

      expect(criterionScore(report.workout.criteria, 'WORKOUT_MODALITY')).toBe(
        100,
      );
      expect(report.workout.codes).toContain('MODALITY_ALIGNED');
    });
  });

  describe('longitudinal quality', () => {
    it.each([
      ['IMPROVING', 'KEEP_PLAN', 'PROGRESSION_TIMELY'],
      ['PLATEAU', 'ADAPT_PLAN', 'ADAPTATION_TIMELY'],
      ['REGRESSING', 'REDUCE', 'REGRESSION_HANDLED'],
      ['STABLE', 'DELOAD', 'DELOAD_TIMELY'],
      ['PLATEAU', 'REVIEW', 'REVIEW_TIMELY'],
    ] as const)('evaluates %s with %s', (state, action, expectedCode) => {
      const report = engine.evaluate(observation({ state, action }));

      expect(report.longitudinal.codes).toContain(expectedCode);
    });
  });

  describe('conversation quality', () => {
    it('recognizes high structural personalization', () => {
      const report = engine.evaluate(observation());

      expect(report.conversation.codes).toContain('HIGH_PERSONALIZATION');
    });

    it('recognizes low personalization', () => {
      const report = engine.evaluate(
        observation({
          nutritionPersonalization: 'BASIC',
          workoutPersonalization: 'BASIC',
          nutritionPackages: [],
          workoutPackages: [],
        }),
      );

      expect(report.conversation.codes).toContain('LOW_PERSONALIZATION');
    });

    it('detects an unnecessary acquisition question when the goal can execute', () => {
      const report = engine.evaluate(
        observation({ shouldAsk: true, canExecute: true }),
      );

      expect(report.conversation.codes).toContain('EXCESS_QUESTIONS');
    });

    it('recognizes educational structure from selected strategies', () => {
      const report = engine.evaluate(observation());

      expect(report.conversation.codes).toContain('EDUCATIONAL_STRUCTURE');
    });

    it('does not infer textual empathy from an envelope without text', () => {
      const report = engine.evaluate(observation());

      expect(
        criterionScore(
          report.conversation.criteria,
          'CONVERSATION_STRUCTURAL_EMPATHY',
        ),
      ).toBeNull();
      expect(report.conversation.codes).toContain(
        'STRUCTURAL_EMPATHY_NOT_OBSERVED',
      );
    });
  });

  describe('report invariants', () => {
    it('scores explicitly restricted nutrition and workout paths as safe', () => {
      const report = engine.evaluate(
        observation({ nutritionRestricted: true, workoutRestricted: true }),
      );

      expect(report.safety.score).toBe(100);
      expect(report.safety.codes).toEqual(
        expect.arrayContaining([
          'NUTRITION_SAFETY_RESTRICTED',
          'WORKOUT_SAFETY_RESTRICTED',
          'CLINICAL_BOUNDARY_RESPECTED',
        ]),
      );
    });

    it('derives personalization only from observed structured factors', () => {
      const rich = engine.evaluate(observation());
      const sparse = engine.evaluate(
        observation({ nutritionPackages: [], workoutPackages: [] }),
      );

      expect(rich.personalization.score).toBeGreaterThan(
        sparse.personalization.score,
      );
      expect(rich.personalization.codes).toContain('FACTORS_USED');
      expect(sparse.personalization.codes).toContain('NO_FACTORS_USED');
    });

    it('predicts lower adherence for complex regressing contexts without support', () => {
      const supported = engine.evaluate(observation());
      const unsupported = engine.evaluate(
        observation({
          nutritionPackages: [],
          nutritionComplexity: 'DETAILED',
          workoutPackages: [],
          workoutStrategies: [],
          workoutComplexity: 'ADVANCED',
          state: 'REGRESSING',
          action: 'REDUCE',
        }),
      );

      expect(unsupported.adherencePrediction.score).toBeLessThan(
        supported.adherencePrediction.score,
      );
      expect(unsupported.adherencePrediction.codes).toContain(
        'HISTORICAL_ADHERENCE_USED',
      );
    });

    it('normalizes every score to the inclusive 0-100 range', () => {
      const report = engine.evaluate(observation());
      const domains = [
        report.nutrition,
        report.workout,
        report.longitudinal,
        report.conversation,
        report.safety,
        report.personalization,
        report.adherencePrediction,
      ];

      for (const domain of domains) {
        expect(domain.score).toBeGreaterThanOrEqual(0);
        expect(domain.score).toBeLessThanOrEqual(100);
        expect(domain.coverage).toBeGreaterThanOrEqual(0);
        expect(domain.coverage).toBeLessThanOrEqual(100);
        for (const criterion of domain.criteria) {
          if (criterion.score !== null) {
            expect(criterion.score).toBeGreaterThanOrEqual(0);
            expect(criterion.score).toBeLessThanOrEqual(100);
          }
        }
      }
      expect(report.overall.score).toBeGreaterThanOrEqual(0);
      expect(report.overall.score).toBeLessThanOrEqual(100);
    });

    it('is deterministic, deeply frozen and serializable', () => {
      const input = observation();
      const first = engine.evaluate(input);
      const second = engine.evaluate(input);

      expect(first).toEqual(second);
      expect(JSON.parse(JSON.stringify(first))).toEqual(first);
      expectDeepFrozen(first);
    });

    it('does not mutate its input', () => {
      const input = observation();
      const before = JSON.stringify(input);

      engine.evaluate(input);

      expect(JSON.stringify(input)).toBe(before);
    });

    it('keeps absent nutrition and workout domains explicitly unobserved', () => {
      const input = observation();
      const report = engine.evaluate(
        fixture<ShadowObservationEnvelope>({
          ...input,
          artifacts: {
            ...input.artifacts,
            nutritionReasoning: null,
            nutritionShadowStrategy: null,
            workoutReasoning: null,
            workoutShadowStrategy: null,
          },
        }),
      );

      expect(report.nutrition.availability).toBe('NOT_OBSERVED');
      expect(report.workout.availability).toBe('NOT_OBSERVED');
      expect(report.overall.observedWeight).toBeLessThan(100);
    });

    it('has no forbidden runtime integration or nondeterministic dependency', () => {
      const source = readFileSync(
        join(__dirname, 'coaching-quality-evaluation-engine.ts'),
        'utf8',
      );

      expect(source).not.toMatch(
        /@nestjs|Prisma|OpenAI|PromptService|EventBus|ResponseBuilder|Formatter|Math\.random|Date\.now|console\.log|@ts-ignore/,
      );
    });
  });
});

function observation(
  options: ObservationOptions = {},
): ShadowObservationEnvelope {
  const nutritionPackages =
    options.nutritionPackages ?? EXCELLENT_NUTRITION_PACKAGES;
  const nutritionStrategies =
    options.nutritionStrategies ?? EXCELLENT_NUTRITION_STRATEGIES;
  const workoutPackages = options.workoutPackages ?? COMPLETE_WORKOUT_PACKAGES;
  const workoutStrategies =
    options.workoutStrategies ?? COMPLETE_WORKOUT_STRATEGIES;
  const nutritionRestricted = options.nutritionRestricted ?? false;
  const workoutRestricted = options.workoutRestricted ?? false;
  const workoutModality = options.workoutModality ?? 'GYM_STRENGTH';

  return fixture<ShadowObservationEnvelope>({
    schemaVersion: 1,
    runId: 'quality-run-1',
    snapshot: {
      referenceDate: '2026-07-17T12:00:00.000Z',
      completion: { overall: 'COMPLETE', sections: [] },
    },
    artifacts: {
      adaptiveDecision: {
        intent: 'COMBINED_PLAN_REQUEST',
        shouldAsk: options.shouldAsk ?? false,
        orderedCandidates: [],
      },
      plannerDecision: {
        recognizedIntent: options.recognizedIntent ?? 'COMBINED_PLAN_REQUEST',
        goal: options.goal ?? 'GENERATE_COMBINED_PLANS',
        targetPlan: 'BOTH',
        canExecute: options.canExecute ?? true,
      },
      longitudinalDecision: {
        currentState: options.state ?? 'IMPROVING',
        decision: options.action ?? 'KEEP_PLAN',
        priorities: { safety: 'LOW' },
        risks: [],
        interventionIntensity: 'LOW',
        metadata: { policyVersion: '2026.07.1', deterministic: true },
      },
      nutritionReasoning: {
        packageDecisions: nutritionPackages.map((packageId) => ({
          packageId,
          disposition: 'REQUIRED',
        })),
        resolvedConflicts: [],
        selectedStrategies: nutritionStrategies.map((strategy) => ({
          strategy,
        })),
        prohibitedStrategies: nutritionRestricted
          ? [{ strategy: 'AGGRESSIVE_RESTRICTION' }]
          : [],
        interventionIntensity: nutritionRestricted ? 'RESTRICTED' : 'MODERATE',
        personalizationLevel: options.nutritionPersonalization ?? 'HIGH',
        recommendedComplexity: options.nutritionComplexity ?? 'SIMPLE',
        priorities: {
          adherence: 'HIGH',
          performance: 'HIGH',
          recovery: 'HIGH',
          education: 'HIGH',
          practicality: 'HIGH',
          economy: 'HIGH',
          satiety: 'HIGH',
          behavior: 'HIGH',
        },
        metadata: {
          strategyVersion: '2026.07.1',
          deterministic: true,
          safetyRestricted: nutritionRestricted,
        },
      },
      workoutReasoning: {
        primaryObjective: 'HYPERTROPHY',
        modality: { resolved: workoutModality },
        knowledgeDecisions: workoutPackages.map((packageId) => ({
          packageId,
          disposition: 'REQUIRED',
        })),
        resolvedConflicts: [],
        selectedStrategies: workoutStrategies.map((strategy) => ({ strategy })),
        prohibitedStrategies: workoutRestricted
          ? [{ prohibition: 'AGGRESSIVE_PROGRESSION' }]
          : [],
        interventionIntensity: options.workoutIntensity ?? 'MODERATE',
        authorizedComplexity: options.workoutComplexity ?? 'SIMPLE',
        progressionDecision: options.workoutProgression ?? 'MAINTAIN',
        priorities: {
          safety: 'CRITICAL',
          technique: 'HIGH',
          adherence: 'HIGH',
          motivation: 'HIGH',
          education: 'HIGH',
          strength: 'HIGH',
          hypertrophy: 'HIGH',
          endurance: 'MEDIUM',
          conditioning: 'MEDIUM',
          mobility: 'MEDIUM',
          recovery: 'HIGH',
          progression: 'HIGH',
          practicality: 'HIGH',
          equipment: 'HIGH',
          environment: 'HIGH',
        },
        metadata: {
          strategyVersion: '2026.07.1',
          deterministic: true,
          safetyRestricted: workoutRestricted,
        },
      },
      workoutLegacyStrategy: { objective: 'HYPERTROPHY' },
      nutritionShadowStrategy: {
        adapterVersion: '2026.07.1',
        artifactType: 'DIET_PLAN',
        interventionIntensity: nutritionRestricted ? 'RESTRICTED' : 'MODERATE',
        complexity: options.nutritionComplexity ?? 'SIMPLE',
        personalization: options.nutritionPersonalization ?? 'HIGH',
        variationPolicy: 'DAILY',
        detailLevel: 'STANDARD',
        trainingAware: true,
        safetyRestricted: nutritionRestricted,
        restrictionCodes: nutritionRestricted ? ['SAFETY'] : ['PROFILE'],
        selectedStrategies: nutritionStrategies,
        prohibitedStrategies: nutritionRestricted
          ? ['AGGRESSIVE_RESTRICTION']
          : [],
      },
      workoutShadowStrategy: {
        adapterVersion: '2026.07.1',
        artifactType: 'WORKOUT_PLAN',
        modality: workoutModality,
        objective: 'HYPERTROPHY',
        interventionIntensity: options.workoutIntensity ?? 'MODERATE',
        complexity: options.workoutComplexity ?? 'SIMPLE',
        personalization: options.workoutPersonalization ?? 'HIGH',
        progression: options.workoutProgression ?? 'MAINTAIN',
        requiredBlocks: ['WARM_UP', 'MAIN'],
        maximumActivitiesPerSession: 8,
        technicalMovementsAllowed: true,
        safetyRestricted: workoutRestricted,
        constraintCodes: workoutRestricted ? ['SAFETY'] : ['PROFILE'],
        selectedStrategies: workoutStrategies,
        prohibitedStrategies: workoutRestricted
          ? ['AGGRESSIVE_PROGRESSION']
          : [],
      },
    },
    pipelineResult: {
      status: 'COMPLETED',
      comparison: {
        comparatorVersion: '2026.07.1',
        nutrition: { category: 'COMPATIBLE', exact: false, differences: [] },
        workout: { category: 'COMPATIBLE', exact: false, differences: [] },
        longitudinal: { category: 'EXACT_MATCH', exact: true, differences: [] },
        overallCategory: options.overallCategory ?? 'COMPATIBLE',
      },
      auditMetadata: {
        status: 'COMPLETED',
        plannerGoal: options.goal ?? 'GENERATE_COMBINED_PLANS',
        collectorShouldAsk: options.shouldAsk ?? false,
        overallCategory: options.overallCategory ?? 'COMPATIBLE',
        nutritionCategory: 'COMPATIBLE',
        workoutCategory: 'COMPATIBLE',
        longitudinalCategory: 'EXACT_MATCH',
        nutritionIntensity: 'MODERATE',
        nutritionComplexity: options.nutritionComplexity ?? 'SIMPLE',
        workoutIntensity: options.workoutIntensity ?? 'MODERATE',
        workoutComplexity: options.workoutComplexity ?? 'SIMPLE',
        workoutProgression: options.workoutProgression ?? 'MAINTAIN',
        longitudinalDecision: options.action ?? 'KEEP_PLAN',
        differenceDimensions: [],
        nutritionStrategyCodes: nutritionStrategies,
        workoutStrategyCodes: workoutStrategies,
        latency: { totalMs: 10 },
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
    safetyIndicators: {
      nutritionRestricted,
      workoutRestricted,
      longitudinalCritical: false,
      mandatoryReview: options.action === 'REVIEW',
      mandatoryDeload: options.action === 'DELOAD',
      paused: options.workoutProgression === 'PAUSE',
      clinicalBoundary: nutritionRestricted || workoutRestricted,
    },
  });
}

function criterionScore(
  criteria: readonly {
    readonly criterion: string;
    readonly score: number | null;
  }[],
  id: string,
): number | null | undefined {
  return criteria.find((criterion) => criterion.criterion === id)?.score;
}

function fixture<T>(value: unknown): T {
  return value as T;
}

function expectDeepFrozen(value: unknown): void {
  if (value === null || typeof value !== 'object') return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const nested of Object.values(value)) expectDeepFrozen(nested);
}
