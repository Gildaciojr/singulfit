import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ActivityLevel,
  FitnessGoal,
  Gender,
  StageOfChange,
} from '@prisma/client';
import {
  COACH_PROFILE_DATA_SOURCE,
  CoachProfileConstraint,
  CoachProfileDatum,
  CoachProfileSnapshot,
} from '../context/coach-profile-snapshot.contract';
import { LongitudinalCoachingEngineService } from './longitudinal-coaching-engine.service';
import {
  LONGITUDINAL_COACHING_DECISION,
  LONGITUDINAL_COACHING_STATE,
  LONGITUDINAL_INTERVENTION_INTENSITY,
  LONGITUDINAL_LEVEL,
  LONGITUDINAL_PRIORITY,
  LONGITUDINAL_TREND,
  LONGITUDINAL_WEIGHT_TREND,
  LongitudinalActivePlanReference,
  LongitudinalCoachingInput,
  LongitudinalFitnessCheckInObservation,
  LongitudinalHistoryObservation,
  LongitudinalProgressObservation,
  LongitudinalSafetySignals,
  PreviousLongitudinalDecisionReference,
} from './longitudinal-coaching.contract';

describe('LongitudinalCoachingEngineService', () => {
  interface SnapshotOptions {
    readonly goal?: FitnessGoal;
    readonly modality?: string;
    readonly adherenceScore?: number;
    readonly stage?: StageOfChange;
    readonly medicalConditions?: readonly string[];
  }

  interface InputOptions extends SnapshotOptions {
    readonly history?: readonly LongitudinalHistoryObservation[];
    readonly progress?: readonly LongitudinalProgressObservation[];
    readonly checkIns?: readonly LongitudinalFitnessCheckInObservation[];
    readonly plans?: readonly LongitudinalActivePlanReference[];
    readonly previousDecisions?: readonly PreviousLongitudinalDecisionReference[];
    readonly safety?: Partial<LongitudinalSafetySignals>;
  }

  const engine = new LongitudinalCoachingEngineService();

  function known<T>(value: T): CoachProfileDatum<T> {
    return Object.freeze({
      status: 'KNOWN',
      value,
      sources: Object.freeze([COACH_PROFILE_DATA_SOURCE.USER]),
    });
  }

  function unknown<T>(): CoachProfileDatum<T> {
    return Object.freeze({ status: 'UNKNOWN', sources: Object.freeze([]) });
  }

  function optionalKnown<T>(value: T | undefined): CoachProfileDatum<T> {
    return value === undefined ? unknown<T>() : known(value);
  }

  function constraint(description: string): CoachProfileConstraint {
    return Object.freeze({
      type: 'DECLARED',
      description,
      source: COACH_PROFILE_DATA_SOURCE.USER,
    });
  }

  function snapshot(options: SnapshotOptions = {}): CoachProfileSnapshot {
    const goal = options.goal ?? FitnessGoal.MAINTENANCE;
    return Object.freeze({
      identity: Object.freeze({
        userId: known('technical-user-id'),
        displayName: known('Ana'),
        onboardingCompleted: known(true),
      }),
      physical: Object.freeze({
        sex: known(Gender.FEMALE),
        birthDate: known('1991-01-01'),
        ageYears: known(35),
        heightCm: known(165),
        currentWeightKg: known(70),
        targetWeightKg: known(64),
        activityLevel: known(ActivityLevel.MODERATE),
      }),
      nutrition: Object.freeze({
        primaryGoal: known(goal),
        desiredOutcome: unknown<string>(),
        desiredMealCount: known(3),
        dietaryPattern: known('OMNIVORE'),
        foodIntolerances: known(Object.freeze([])),
        declaredFoodPreferences: known(Object.freeze([])),
        declaredFoodRejections: known(Object.freeze([])),
        cookingAvailability: known('MODERATE'),
        mealsAwayFromHome: known(false),
        eatingOutFrequency: known('SOMETIMES'),
        foodBudget: known('MODERATE'),
        supplementation: unknown<readonly string[]>(),
        hydration: known('ADEQUATE'),
      }),
      training: Object.freeze({
        primaryGoal: known(goal),
        experienceLevel: known('INTERMEDIATE'),
        preferredModality: optionalKnown(options.modality),
        weeklyFrequency: known(3),
        sessionDurationMinutes: known(50),
        environment: known('ACADEMIA'),
        availableEquipment: known(Object.freeze(['HALTERES'])),
        perceivedConditioning: known('MODERATE'),
        intensityPreference: known('MODERATE'),
        cardioAvailability: known(true),
        trainingFormatPreference: known('STRUCTURED'),
        returningAfterBreak: known(false),
      }),
      routine: Object.freeze({
        wakeUpTime: known('07:00'),
        sleepTime: known('23:00'),
        trainingTime: known('18:30'),
        mealTimes: known(Object.freeze(['08:00', '13:00', '20:00'])),
        availableTrainingDays: known(Object.freeze(['MON', 'WED', 'FRI'])),
        dailyTrainingWindows: unknown<readonly string[]>(),
      }),
      restrictions: Object.freeze({
        foodRestrictions: known(Object.freeze([])),
        allergies: known(Object.freeze([])),
        medicalConditions: known(
          Object.freeze((options.medicalConditions ?? []).map(constraint)),
        ),
        physicalLimitations: known(Object.freeze([])),
      }),
      preferences: Object.freeze({ foodPreferences: known(Object.freeze([])) }),
      longitudinal: Object.freeze({
        adherenceScore: optionalKnown(options.adherenceScore),
        latestProgressWeightKg: known(70),
        goalProgression: unknown(),
        nutritionEvolution: unknown(),
        coachAdaptation: unknown(),
      }),
      plans: Object.freeze({
        currentDiet: unknown(),
        currentWorkout: unknown(),
      }),
      conversation: Object.freeze({
        preferredLanguage: known('pt-BR'),
        timezone: known('America/Sao_Paulo'),
        coachStyle: unknown(),
        behavioralStyle: unknown(),
        behavioralStage: optionalKnown(options.stage),
        classifiedGoal: unknown(),
        memorySummaries: unknown<readonly string[]>(),
      }),
      completion: Object.freeze({
        overall: 'PARTIAL',
        sections: Object.freeze([]),
      }),
      conflicts: Object.freeze([]),
      referenceDate: '2026-07-16T12:00:00.000Z',
    });
  }

  function history(
    values: readonly number[] = [70, 71, 70, 72],
    overrides: Partial<LongitudinalHistoryObservation> = {},
  ): readonly LongitudinalHistoryObservation[] {
    const dates = [
      '2026-06-01T12:00:00.000Z',
      '2026-06-15T12:00:00.000Z',
      '2026-07-01T12:00:00.000Z',
      '2026-07-10T12:00:00.000Z',
    ];
    return values.map((value, index) => ({
      observedAt: dates[index],
      adherenceScore: value,
      consistencyScore: value,
      hydrationScore: value,
      nutritionScore: value,
      trainingFrequency: 3,
      trainingCompletionScore: value,
      goalProgressScore: value,
      ...overrides,
    }));
  }

  function progress(
    weights: readonly number[] = [70, 70.1, 70],
    muscleMass?: readonly number[],
  ): readonly LongitudinalProgressObservation[] {
    const dates = [
      '2026-06-01T12:00:00.000Z',
      '2026-06-20T12:00:00.000Z',
      '2026-07-10T12:00:00.000Z',
    ];
    return weights.map((weightKg, index) => ({
      observedAt: dates[index],
      weightKg,
      muscleMassKg: muscleMass?.[index],
      bmi: 25,
    }));
  }

  function checkIns(
    adherence: readonly number[] = [72, 76, 78],
    energy: LongitudinalFitnessCheckInObservation['energyLevel'] = 'HIGH',
  ): readonly LongitudinalFitnessCheckInObservation[] {
    const dates = [
      '2026-06-10T12:00:00.000Z',
      '2026-06-28T12:00:00.000Z',
      '2026-07-11T12:00:00.000Z',
    ];
    return adherence.map((adherenceScore, index) => ({
      observedAt: dates[index],
      adherenceScore,
      energyLevel: energy,
    }));
  }

  function defaultPlans(
    objective: LongitudinalActivePlanReference['objective'] = 'MAINTENANCE',
    modality: LongitudinalActivePlanReference['modality'] = 'STRENGTH_TRAINING',
  ): readonly LongitudinalActivePlanReference[] {
    return [
      {
        domain: 'NUTRITION',
        objective,
        generatedAt: '2026-05-15T12:00:00.000Z',
      },
      {
        domain: 'WORKOUT',
        objective,
        modality,
        generatedAt: '2026-05-15T12:00:00.000Z',
      },
    ];
  }

  function input(options: InputOptions = {}): LongitudinalCoachingInput {
    return {
      snapshot: snapshot(options),
      history: options.history ?? history(),
      progressSnapshots: options.progress ?? progress(),
      fitnessCheckIns: options.checkIns ?? checkIns(),
      activePlans: options.plans ?? defaultPlans(),
      previousDecisions: options.previousDecisions ?? [],
      safetySignals: {
        clinicalContext: false,
        acutePain: false,
        fever: false,
        rehabilitation: false,
        poorRecovery: false,
        physicalIncapacity: false,
        ...options.safety,
      },
    };
  }

  it('keeps a consistently improving weight-loss trajectory', () => {
    const result = engine.decide(
      input({
        goal: FitnessGoal.WEIGHT_LOSS,
        history: history([55, 62, 75, 84]),
        progress: progress([82, 79, 76]),
        plans: defaultPlans('WEIGHT_LOSS'),
      }),
    );

    expect(result.currentState).toBe(LONGITUDINAL_COACHING_STATE.IMPROVING);
    expect(result.decision).toBe(LONGITUDINAL_COACHING_DECISION.KEEP_PLAN);
    expect(result.trends.weight).toBe(LONGITUDINAL_WEIGHT_TREND.DECREASING);
    expect(result.rationaleCodes).toEqual(
      expect.arrayContaining(['CONSISTENT_IMPROVEMENT', 'WEIGHT_GOAL_ALIGNED']),
    );
  });

  it('detects a prolonged plateau and requests adaptation', () => {
    const result = engine.decide(
      input({
        goal: FitnessGoal.WEIGHT_LOSS,
        plans: defaultPlans('WEIGHT_LOSS'),
      }),
    );

    expect(result.currentState).toBe(LONGITUDINAL_COACHING_STATE.PLATEAU);
    expect(result.decision).toBe(LONGITUDINAL_COACHING_DECISION.ADAPT_PLAN);
    expect(result.needs.adaptation).toBe(true);
    expect(result.risks).toContainEqual(
      expect.objectContaining({ code: 'PLATEAU' }),
    );
  });

  it('detects regression when weight and nutrition diverge from weight loss', () => {
    const result = engine.decide(
      input({
        goal: FitnessGoal.WEIGHT_LOSS,
        history: history([82, 75, 60, 48]),
        progress: progress([76, 78, 81]),
        plans: defaultPlans('WEIGHT_LOSS'),
      }),
    );

    expect(result.currentState).toBe(LONGITUDINAL_COACHING_STATE.REGRESSING);
    expect(result.regression.detected).toBe(true);
    expect(result.decision).toBe(LONGITUDINAL_COACHING_DECISION.REVIEW);
  });

  it('reduces after a long interruption without changing a plan', () => {
    const oldHistoryDates = [
      '2026-03-01T12:00:00.000Z',
      '2026-03-15T12:00:00.000Z',
      '2026-04-01T12:00:00.000Z',
      '2026-04-10T12:00:00.000Z',
    ];
    const oldProgressDates = [
      '2026-03-01T12:00:00.000Z',
      '2026-03-20T12:00:00.000Z',
      '2026-04-10T12:00:00.000Z',
    ];
    const oldHistory = history().map((item, index) => ({
      ...item,
      observedAt: oldHistoryDates[index],
    }));
    const oldProgress = progress().map((item, index) => ({
      ...item,
      observedAt: oldProgressDates[index],
    }));

    const result = engine.decide(
      input({ history: oldHistory, progress: oldProgress, checkIns: [] }),
    );

    expect(result.currentState).toBe(LONGITUDINAL_COACHING_STATE.REGRESSING);
    expect(result.decision).toBe(LONGITUDINAL_COACHING_DECISION.REDUCE);
    expect(result.rationaleCodes).toContain('LONG_INTERRUPTION');
  });

  it('classifies high adherence without inventing motivation', () => {
    const result = engine.decide(input({ checkIns: checkIns([85, 88, 92]) }));

    expect(result.adherence.level).toBe(LONGITUDINAL_LEVEL.HIGH);
    expect(result.adherence.score).toBeGreaterThanOrEqual(75);
    expect(result.rationaleCodes).toContain('HIGH_ADHERENCE');
  });

  it('prioritizes behavior and adaptation for low adherence', () => {
    const result = engine.decide(
      input({
        history: history([35, 38, 40, 42]),
        checkIns: checkIns([30, 35, 40], 'LOW'),
      }),
    );

    expect(result.adherence.level).toBe(LONGITUDINAL_LEVEL.LOW);
    expect(result.priorities.behavioral).toBe(LONGITUDINAL_PRIORITY.HIGH);
    expect(result.decision).toBe(LONGITUDINAL_COACHING_DECISION.ADAPT_PLAN);
  });

  it('treats weight gain as regression for a weight-loss objective', () => {
    const result = engine.decide(
      input({
        goal: FitnessGoal.WEIGHT_LOSS,
        progress: progress([74, 76, 79]),
        plans: defaultPlans('WEIGHT_LOSS'),
      }),
    );

    expect(result.trends.weight).toBe(LONGITUDINAL_WEIGHT_TREND.INCREASING);
    expect(result.progress.trend).toBe(LONGITUDINAL_TREND.DECLINING);
  });

  it('treats consistent weight loss as aligned progress', () => {
    const result = engine.decide(
      input({
        goal: FitnessGoal.WEIGHT_LOSS,
        progress: progress([90, 86, 83]),
        plans: defaultPlans('WEIGHT_LOSS'),
      }),
    );

    expect(result.trends.weight).toBe(LONGITUDINAL_WEIGHT_TREND.DECREASING);
    expect(result.progress.trend).toBe(LONGITUDINAL_TREND.IMPROVING);
  });

  it('recognizes hypertrophy through structured muscle-mass progress', () => {
    const result = engine.decide(
      input({
        goal: FitnessGoal.MUSCLE_GAIN,
        progress: progress([70, 70.5, 71], [28, 28.5, 29.2]),
        plans: defaultPlans('HYPERTROPHY'),
      }),
    );

    expect(result.currentState).toBe(LONGITUDINAL_COACHING_STATE.IMPROVING);
    expect(result.rationaleCodes).toContain('MUSCLE_PROGRESS');
    expect(result.priorities.training).toBe(LONGITUDINAL_PRIORITY.MEDIUM);
  });

  it('supports a deterministic running trajectory', () => {
    const runningHistory = history([70, 72, 76, 80]).map((item, index) => ({
      ...item,
      trainingFrequency: index + 1,
      trainingCompletionScore: 55 + index * 10,
    }));
    const result = engine.decide(
      input({
        modality: 'corrida',
        history: runningHistory,
        plans: defaultPlans('HEALTH', 'RUNNING'),
        progress: [],
      }),
    );

    expect(result.trends.frequency).toBe(LONGITUDINAL_TREND.IMPROVING);
    expect(result.trends.training).toBe(LONGITUDINAL_TREND.IMPROVING);
    expect(result.currentState).toBe(LONGITUDINAL_COACHING_STATE.IMPROVING);
    expect(result.rationaleCodes).toContain('TRAINING_MODALITY_CONTEXT');
  });

  it('chooses deload for poor recovery in a CrossFit context', () => {
    const result = engine.decide(
      input({
        modality: 'CrossFit',
        plans: defaultPlans('HEALTH', 'CROSSFIT'),
        safety: { poorRecovery: true },
      }),
    );

    expect(result.decision).toBe(LONGITUDINAL_COACHING_DECISION.DELOAD);
    expect(result.needs.deload).toBe(true);
    expect(result.risks).toContainEqual(
      expect.objectContaining({ code: 'POOR_RECOVERY' }),
    );
  });

  it('keeps maintenance when weight remains stable', () => {
    const result = engine.decide(input());

    expect(result.currentState).toBe(LONGITUDINAL_COACHING_STATE.STABLE);
    expect(result.decision).toBe(LONGITUDINAL_COACHING_DECISION.KEEP_PLAN);
    expect(result.needs.maintenance).toBe(true);
    expect(result.rationaleCodes).toContain('MAINTENANCE_ALIGNED');
  });

  it('allows a structured increase for hypertrophy plateau with high adherence', () => {
    const result = engine.decide(
      input({
        goal: FitnessGoal.MUSCLE_GAIN,
        adherenceScore: 90,
        history: history([82, 84, 85, 86]),
        checkIns: checkIns([85, 88, 90]),
        progress: progress([70, 70.1, 70], [28, 28.1, 28]),
        plans: defaultPlans('HYPERTROPHY'),
      }),
    );

    expect(result.currentState).toBe(LONGITUDINAL_COACHING_STATE.PLATEAU);
    expect(result.decision).toBe(LONGITUDINAL_COACHING_DECISION.INCREASE);
    expect(result.interventionIntensity).toBe(
      LONGITUDINAL_INTERVENTION_INTENSITY.HIGH,
    );
  });

  it('escalates repeated unsuccessful adaptation to review', () => {
    const previous: readonly PreviousLongitudinalDecisionReference[] = [
      {
        decidedAt: '2026-06-10T12:00:00.000Z',
        state: 'PLATEAU',
        decision: 'ADAPT_PLAN',
      },
      {
        decidedAt: '2026-06-28T12:00:00.000Z',
        state: 'PLATEAU',
        decision: 'ADAPT_PLAN',
      },
    ];
    const result = engine.decide(
      input({
        goal: FitnessGoal.WEIGHT_LOSS,
        plans: defaultPlans('WEIGHT_LOSS'),
        previousDecisions: previous,
      }),
    );

    expect(result.decision).toBe(LONGITUDINAL_COACHING_DECISION.REVIEW);
    expect(result.rationaleCodes).toContain('REPEATED_ADAPTATION');
  });

  it('captures a structured relapse without reading free messages', () => {
    const relapseHistory = history().map((item, index) => ({
      ...item,
      relapseSeverity: index === 3 ? ('HIGH' as const) : undefined,
    }));
    const result = engine.decide(input({ history: relapseHistory }));

    expect(result.relapse).toEqual({ detected: true, severity: 'HIGH' });
    expect(result.currentState).toBe(LONGITUDINAL_COACHING_STATE.REGRESSING);
    expect(result.risks).toContainEqual(
      expect.objectContaining({ code: 'RELAPSE' }),
    );
  });

  it('asks for information when evidence and active plans are absent', () => {
    const result = engine.decide(
      input({ history: [], progress: [], checkIns: [], plans: [] }),
    );

    expect(result.currentState).toBe(LONGITUDINAL_COACHING_STATE.UNKNOWN);
    expect(result.decision).toBe(
      LONGITUDINAL_COACHING_DECISION.ASK_INFORMATION,
    );
    expect(result.needs.information).toBe(true);
  });

  it('waits when a new active plan has insufficient observations', () => {
    const result = engine.decide(
      input({
        history: [],
        progress: [],
        checkIns: [],
        plans: [
          {
            domain: 'WORKOUT',
            objective: 'HEALTH',
            modality: 'GENERAL_FITNESS',
            generatedAt: '2026-07-10T12:00:00.000Z',
          },
        ],
      }),
    );

    expect(result.decision).toBe(LONGITUDINAL_COACHING_DECISION.WAIT);
    expect(result.rationaleCodes).toContain('NEW_ACTIVE_PLAN');
  });

  it.each([
    ['clinical context', { clinicalContext: true }, 'CLINICAL_BOUNDARY'],
    ['acute pain', { acutePain: true }, 'ACUTE_PAIN'],
    ['fever', { fever: true }, 'FEVER'],
    ['rehabilitation', { rehabilitation: true }, 'REHABILITATION'],
    [
      'physical incapacity',
      { physicalIncapacity: true },
      'PHYSICAL_INCAPACITY',
    ],
  ] as const)(
    'never adapts automatically for %s',
    (_label, safety, expectedRisk) => {
      const result = engine.decide(input({ safety }));

      expect(result.decision).toBe(LONGITUDINAL_COACHING_DECISION.REVIEW);
      expect(result.needs.adaptation).toBe(false);
      expect(result.needs.reassessment).toBe(true);
      expect(result.interventionIntensity).toBe(
        LONGITUDINAL_INTERVENTION_INTENSITY.RESTRICTED,
      );
      expect(result.risks.map((risk) => risk.code)).toContain(expectedRisk);
    },
  );

  it('treats a persisted medical condition as a clinical boundary', () => {
    const result = engine.decide(
      input({ medicalConditions: ['condição clínica declarada'] }),
    );

    expect(result.decision).toBe(LONGITUDINAL_COACHING_DECISION.REVIEW);
    expect(result.priorities.safety).toBe(LONGITUDINAL_PRIORITY.CRITICAL);
    expect(result.interventionIntensity).toBe(
      LONGITUDINAL_INTERVENTION_INTENSITY.RESTRICTED,
    );
    expect(result.rationaleCodes).toContain('CLINICAL_CONTEXT');
  });

  it('tracks hydration and adherence trends independently', () => {
    const changing = history([80, 72, 60, 45]).map((item, index) => ({
      ...item,
      hydrationScore: 85 - index * 15,
    }));
    const result = engine.decide(
      input({ history: changing, checkIns: checkIns([80, 65, 40], 'LOW') }),
    );

    expect(result.trends.hydration).toBe(LONGITUDINAL_TREND.DECLINING);
    expect(result.trends.adherence).toBe(LONGITUDINAL_TREND.DECLINING);
    expect(result.rationaleCodes).toContain('HYDRATION_DECLINING');
  });

  it('is deterministic and independent from input collection order', () => {
    const source = input({ goal: FitnessGoal.WEIGHT_LOSS });
    const reordered: LongitudinalCoachingInput = {
      ...source,
      history: [...source.history].reverse(),
      progressSnapshots: [...source.progressSnapshots].reverse(),
      fitnessCheckIns: [...source.fitnessCheckIns].reverse(),
      activePlans: [...source.activePlans].reverse(),
    };

    expect(engine.decide(source)).toEqual(engine.decide(source));
    expect(engine.decide(reordered)).toEqual(engine.decide(source));
  });

  it('deep-freezes the result and every nested collection', () => {
    const result = engine.decide(input());

    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.trends)).toBe(true);
    expect(Object.isFrozen(result.needs)).toBe(true);
    expect(Object.isFrozen(result.risks)).toBe(true);
    expect(Object.isFrozen(result.rationaleCodes)).toBe(true);
    expect(Object.isFrozen(result.metadata)).toBe(true);
    expect(() =>
      result.risks.push({
        code: 'PLATEAU',
        severity: 'LOW',
        domain: 'GENERAL',
      }),
    ).toThrow();
  });

  it('does not mutate Snapshot, history, progress, check-ins or decisions', () => {
    const source = input();
    const before = JSON.stringify(source);

    engine.decide(source);

    expect(JSON.stringify(source)).toBe(before);
  });

  it('rejects future observations and invalid scores', () => {
    expect(() =>
      engine.decide(
        input({
          history: [
            {
              observedAt: '2026-07-17T12:00:00.000Z',
              adherenceScore: 80,
            },
          ],
        }),
      ),
    ).toThrow('não pode estar no futuro');
    expect(() =>
      engine.decide(
        input({
          checkIns: [
            {
              observedAt: '2026-07-10T12:00:00.000Z',
              energyLevel: 'HIGH',
              adherenceScore: 101,
            },
          ],
        }),
      ),
    ).toThrow('fora do intervalo permitido');
  });

  it('serializes only structured decisions and never generates plans or text', () => {
    const serialized = JSON.stringify(engine.decide(input()));

    expect(serialized).not.toContain('technical-user-id');
    expect(serialized).not.toContain('Ana');
    expect(serialized).not.toMatch(
      /exercise|exercicio|session|sessao|message/i,
    );
    expect(JSON.parse(serialized)).toEqual(expect.any(Object));
  });

  it('has no AI, persistence, prompt, event or production registration', () => {
    const engineSource = readFileSync(
      join(__dirname, 'longitudinal-coaching-engine.service.ts'),
      'utf8',
    );
    const moduleSource = readFileSync(
      join(__dirname, '..', 'longitudinal', 'longitudinal.module.ts'),
      'utf8',
    );

    expect(engineSource).not.toMatch(
      /PrismaService|AIService|PromptService|OpenAI|EventBus|Outbox|Math\.random|Date\.now|console\.log|\bany\b/,
    );
    expect(moduleSource).not.toContain('LongitudinalCoachingEngineService');
  });
});
