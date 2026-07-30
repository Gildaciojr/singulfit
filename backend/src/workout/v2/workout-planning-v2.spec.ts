import { Test } from '@nestjs/testing';
import {
  ActivityLevel,
  AIJobStatus,
  AIJobType,
  FitnessGoal,
} from '@prisma/client';
import { AIService } from '../../ai/ai.service';
import {
  COACH_PROFILE_DATA_SOURCE,
  type CoachProfileDatum,
  type CoachProfileSnapshot,
} from '../../context/coach-profile-snapshot.contract';
import {
  CONVERSATION_GOAL,
  CONVERSATION_RECOGNIZED_INTENT,
  type ConversationGoalDecision,
} from '../../context/conversation-goal-planner.contract';
import { PrismaService } from '../../prisma/prisma.service';
import { WorkoutArtifactResolverService } from './workout-artifact-resolver.service';
import { WorkoutPlanV2Formatter } from './workout-plan-v2.formatter';
import { WorkoutPlanV2Parser } from './workout-plan-v2.parser';
import { WorkoutPlanV2Validator } from './workout-plan-v2.validator';
import type {
  GeneratedWorkoutPlanV2Candidate,
  WorkoutActivityV2,
} from './workout-plan-v2.contract';
import {
  WORKOUT_ARTIFACT_TYPE,
  type WorkoutModality,
  type WorkoutSafetyFlag,
} from './workout-planning-artifact.contract';
import { WorkoutPlanningContextBuilder } from './workout-planning-context.builder';
import type {
  WorkoutEquipment,
  WorkoutRecognizedContext,
} from './workout-planning-context.contract';
import { WorkoutPlanningEngineV2Service } from './workout-planning-engine-v2.service';
import { WorkoutPlanningReadinessService } from './workout-planning-readiness.service';
import { WorkoutPlanningSafetyService } from './workout-planning-safety.service';
import { WorkoutPlanningStrategyService } from './workout-planning-strategy.service';

describe('Workout Planning Engine V2', () => {
  const referenceDate = new Date('2026-07-16T12:00:00.000Z');
  const known = <T>(value: T): CoachProfileDatum<T> =>
    Object.freeze({
      status: 'KNOWN',
      value,
      sources: Object.freeze([COACH_PROFILE_DATA_SOURCE.USER]),
    });
  const unknown = <T>(): CoachProfileDatum<T> =>
    Object.freeze({ status: 'UNKNOWN', sources: Object.freeze([]) });

  function snapshot(limitations: readonly string[] = []): CoachProfileSnapshot {
    return Object.freeze({
      identity: {
        userId: known('technical-user-id'),
        displayName: known('Ana'),
        onboardingCompleted: known(true),
      },
      physical: {
        sex: unknown(),
        birthDate: unknown(),
        ageYears: known(32),
        heightCm: known(170),
        currentWeightKg: known(70),
        targetWeightKg: known(65),
        activityLevel: known(ActivityLevel.MODERATE),
      },
      nutrition: {
        primaryGoal: known(FitnessGoal.MUSCLE_GAIN),
        desiredOutcome: unknown(),
        desiredMealCount: unknown(),
        dietaryPattern: unknown(),
        cookingAvailability: unknown(),
        mealsAwayFromHome: unknown(),
        foodBudget: unknown(),
        supplementation: unknown(),
        hydration: unknown(),
      },
      training: {
        primaryGoal: known(FitnessGoal.MUSCLE_GAIN),
        experienceLevel: unknown(),
        preferredModality: unknown(),
        weeklyFrequency: unknown(),
        sessionDurationMinutes: unknown(),
        environment: unknown(),
        availableEquipment: unknown(),
        perceivedConditioning: unknown(),
        intensityPreference: unknown(),
        cardioAvailability: unknown(),
        trainingFormatPreference: unknown(),
      },
      routine: {
        wakeUpTime: unknown(),
        sleepTime: unknown(),
        trainingTime: known('18:00'),
        mealTimes: unknown(),
      },
      restrictions: {
        foodRestrictions: known(Object.freeze([])),
        allergies: known(Object.freeze([])),
        medicalConditions: known(Object.freeze([])),
        physicalLimitations: known(
          Object.freeze(
            limitations.map((description) =>
              Object.freeze({
                description,
                source: COACH_PROFILE_DATA_SOURCE.FITNESS_PROFILE,
              }),
            ),
          ),
        ),
      },
      preferences: { foodPreferences: unknown() },
      longitudinal: {
        adherenceScore: unknown(),
        latestProgressWeightKg: unknown(),
        goalProgression: unknown(),
        nutritionEvolution: unknown(),
        coachAdaptation: unknown(),
      },
      plans: { currentDiet: unknown(), currentWorkout: unknown() },
      conversation: {
        preferredLanguage: known('pt-BR'),
        timezone: known('America/Sao_Paulo'),
        coachStyle: unknown(),
        behavioralStyle: unknown(),
        behavioralStage: unknown(),
        classifiedGoal: unknown(),
        memorySummaries: unknown(),
      },
      completion: { overall: 'PARTIAL', sections: Object.freeze([]) },
      conflicts: Object.freeze([]),
      referenceDate: referenceDate.toISOString(),
    });
  }

  function decision(
    goal: ConversationGoalDecision['goal'] = CONVERSATION_GOAL.GENERATE_WORKOUT_PLAN,
  ): ConversationGoalDecision {
    return Object.freeze({
      recognizedIntent:
        goal === CONVERSATION_GOAL.GENERAL_GUIDANCE
          ? CONVERSATION_RECOGNIZED_INTENT.GENERAL_GUIDANCE_REQUEST
          : CONVERSATION_RECOGNIZED_INTENT.WORKOUT_PLAN_REQUEST,
      goal,
      reason:
        goal === CONVERSATION_GOAL.GENERAL_GUIDANCE
          ? 'GENERAL_GUIDANCE_REQUESTED'
          : 'WORKOUT_PROFILE_READY',
      targetPlan:
        goal === CONVERSATION_GOAL.GENERAL_GUIDANCE ? null : 'WORKOUT',
      profileCompletionState: 'PARTIAL',
      canExecute: true,
      confidence: 'HIGH',
      selectedProfileField: null,
      metPreconditions: Object.freeze([]),
      missingPreconditions: Object.freeze([]),
      pendingDependencies: Object.freeze([]),
    });
  }

  function recognized(
    modality: WorkoutModality,
    equipment: readonly WorkoutEquipment[],
    options: {
      artifact?: WorkoutRecognizedContext['artifactType'];
      experience?: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';
      frequency?: number;
      duration?: number;
      environment?: NonNullable<
        WorkoutRecognizedContext['environment']
      >['value'];
      objective?: NonNullable<WorkoutRecognizedContext['objective']>['value'];
      safety?: readonly WorkoutSafetyFlag[];
    } = {},
  ): WorkoutRecognizedContext {
    return Object.freeze({
      artifactType: options.artifact ?? WORKOUT_ARTIFACT_TYPE.WEEKLY_PLAN,
      modality: Object.freeze({ status: 'CONFIRMED', value: modality }),
      objective: Object.freeze({
        status: 'CONFIRMED',
        value: options.objective ?? 'GENERAL_HEALTH',
      }),
      experience: Object.freeze({
        status: 'CONFIRMED',
        value: options.experience ?? 'BEGINNER',
      }),
      weeklyFrequency: Object.freeze({
        status: 'CONFIRMED',
        value: options.frequency ?? 3,
      }),
      sessionDurationMinutes: Object.freeze({
        status: 'CONFIRMED',
        value: options.duration ?? 45,
      }),
      environment: Object.freeze({
        status: 'CONFIRMED',
        value: options.environment ?? 'HOME',
      }),
      equipment: Object.freeze({
        status: 'CONFIRMED',
        value: Object.freeze(equipment),
      }),
      perceivedConditioning: Object.freeze({
        status: 'CONFIRMED',
        value: 'MODERATE',
      }),
      intensityPreference: Object.freeze({
        status: 'CONFIRMED',
        value: 'MODERATE',
      }),
      safetySignals: Object.freeze(options.safety ?? []),
    });
  }

  function context(input: WorkoutRecognizedContext, profile = snapshot()) {
    const modality =
      input.modality?.status === 'NOT_SET' || !input.modality
        ? 'GENERAL_FITNESS'
        : input.modality.value;
    return new WorkoutPlanningContextBuilder().build({
      snapshot: profile,
      artifactType: input.artifactType ?? 'WEEKLY_PLAN',
      modality,
      recognizedContext: input,
      referenceDate,
    });
  }

  function activity(
    key: string,
    block: string,
    modality: WorkoutModality,
    equipment: WorkoutEquipment = 'BODYWEIGHT',
  ): WorkoutActivityV2 {
    const base = {
      activityKey: key,
      name:
        block === 'TECHNIQUE'
          ? 'Técnica básica escalada'
          : `Atividade ${block}`,
      source: 'MODEL_GENERATED' as const,
      movementPattern: 'OTHER' as const,
      equipment: Object.freeze([equipment]),
      instruction: 'Execução controlada',
      alerts: Object.freeze([]),
      appliedConstraintCodes: Object.freeze([]),
    };
    if (block === 'ENDURANCE')
      return Object.freeze({
        ...base,
        kind: 'ENDURANCE',
        mode:
          modality === 'CYCLING'
            ? 'CYCLE'
            : modality === 'WALKING'
              ? 'WALK'
              : 'RUN',
        durationMinutes: 20,
        distanceKm: null,
        intensity: 'CONVERSATIONAL',
      });
    if (block === 'MOBILITY' || block === 'RECOVERY')
      return Object.freeze({
        ...base,
        kind: 'MOBILITY',
        repetitions: null,
        holdSeconds: null,
        durationSeconds: 300,
      });
    return Object.freeze({
      ...base,
      kind: 'TIMED',
      durationSeconds: 300,
      workSeconds: 30,
      recoverySeconds: 30,
      rounds: 5,
      intensity: 'MODERATE',
    });
  }

  function candidate(
    input: WorkoutRecognizedContext,
  ): GeneratedWorkoutPlanV2Candidate {
    const ctx = context(input);
    const strategy = new WorkoutPlanningStrategyService().build(ctx);
    return Object.freeze({
      artifactType: strategy.artifactType,
      modality: strategy.modality,
      objective:
        strategy.objective.status === 'NOT_SET'
          ? 'GENERAL_HEALTH'
          : strategy.objective.value,
      title: 'Plano V2',
      sessions: Object.freeze(
        Array.from({ length: strategy.sessionCount }, (_, sessionIndex) =>
          Object.freeze({
            sessionKey: `session-${sessionIndex + 1}`,
            sequence: sessionIndex + 1,
            label: `Sessão ${sessionIndex + 1}`,
            estimatedDurationMinutes:
              strategy.sessionDurationMinutes.status === 'NOT_SET'
                ? 30
                : strategy.sessionDurationMinutes.value,
            blocks: Object.freeze(
              strategy.requiredBlocks.map((block, blockIndex) =>
                Object.freeze({
                  blockKey: `block-${sessionIndex + 1}-${blockIndex + 1}`,
                  type: block,
                  title: block,
                  estimatedDurationMinutes: 5,
                  activities: Object.freeze([
                    activity(
                      `activity-${sessionIndex + 1}-${blockIndex + 1}`,
                      block,
                      strategy.modality,
                      strategy.authorizedEquipment[0] ?? 'BODYWEIGHT',
                    ),
                  ]),
                }),
              ),
            ),
          }),
        ),
      ),
      progression: Object.freeze([
        {
          ruleKey: 'rule-1',
          state: 'PROGRESS',
          conditionCode: 'SESSIONS_COMPLETED_WITH_EXPECTED_EFFORT',
          actionCode: 'CHANGE_ONE_VARIABLE',
          maximumChangePercent:
            strategy.progressionPolicy.maximumWeeklyIncreasePercent,
        },
      ]),
      substitutions: Object.freeze([]),
      adaptationRules: Object.freeze([]),
      safetyFlags: Object.freeze([]),
    });
  }

  it('resolves explicit artifacts without classifying free text', () => {
    const resolver = new WorkoutArtifactResolverService();
    expect(resolver.resolve({ decision: decision() })).toMatchObject({
      status: 'REQUIRES_CLARIFICATION',
      reason: 'ARTIFACT_REQUIRED',
    });
    expect(
      resolver.resolve({
        decision: decision(),
        explicitArtifactType: 'SINGLE_SESSION',
        explicitModality: 'HOME_WORKOUT',
      }),
    ).toMatchObject({
      status: 'RESOLVED',
      artifactType: 'SINGLE_SESSION',
      modality: 'HOME_WORKOUT',
    });
  });

  it('evaluates modality-specific readiness and blocks unsafe signals', () => {
    const service = new WorkoutPlanningReadinessService();
    const profile = snapshot();
    expect(
      service.evaluate(
        profile,
        'WEEKLY_PLAN',
        'GYM_STRENGTH',
        recognized('GYM_STRENGTH', ['BODYWEIGHT', 'DUMBBELL'], {
          environment: 'FULL_GYM',
        }),
        false,
      ).status,
    ).toBe('READY');
    const missingExperience = {
      ...recognized('RUNNING', ['BODYWEIGHT'], { environment: 'STREET' }),
      experience: undefined,
    };
    expect(
      service.evaluate(
        profile,
        'WEEKLY_PLAN',
        'RUNNING',
        missingExperience,
        false,
      ).missingFields,
    ).toContain('EXPERIENCE');
    expect(
      service.evaluate(
        profile,
        'WEEKLY_PLAN',
        'CROSSFIT',
        recognized('CROSSFIT', ['BODYWEIGHT'], {
          environment: 'CROSSFIT_BOX',
          safety: ['ACUTE_PAIN'],
        }),
        false,
      ).status,
    ).toBe('BLOCKED');
    expect(
      service.evaluate(
        profile,
        'WEEKLY_PLAN',
        'CYCLING',
        recognized('CYCLING', ['BODYWEIGHT'], {
          environment: 'ROAD',
        }),
        false,
      ).missingFields,
    ).toContain('EQUIPMENT');
    expect(
      service.evaluate(
        profile,
        'WEEKLY_PLAN',
        'RUNNING',
        {
          ...recognized('RUNNING', [], { environment: 'STREET' }),
          equipment: undefined,
        },
        false,
      ).missingFields,
    ).not.toContain('EQUIPMENT');
  });

  it('moves workout readiness to ready from confirmed Snapshot acquisition data', () => {
    const base = snapshot();
    const acquired: CoachProfileSnapshot = Object.freeze({
      ...base,
      training: Object.freeze({
        ...base.training,
        experienceLevel: known('BEGINNER'),
        preferredModality: known('GYM_STRENGTH'),
        weeklyFrequency: known(3),
        sessionDurationMinutes: known(45),
        environment: known('FULL_GYM'),
        availableEquipment: known(
          Object.freeze(['BODYWEIGHT', 'DUMBBELL', 'BENCH']),
        ),
        perceivedConditioning: known('MODERATE'),
        intensityPreference: known('MODERATE'),
        cardioAvailability: known(true),
        trainingFormatPreference: known('INDIVIDUAL'),
        returningAfterBreak: known(false),
      }),
      routine: Object.freeze({
        ...base.routine,
        availableTrainingDays: known(
          Object.freeze(['MONDAY', 'WEDNESDAY', 'FRIDAY']),
        ),
        dailyTrainingWindows: known(Object.freeze(['MONDAY:18:00-19:00'])),
      }),
    });
    const emptyRecognized: WorkoutRecognizedContext = Object.freeze({});
    const readiness = new WorkoutPlanningReadinessService().evaluate(
      acquired,
      'WEEKLY_PLAN',
      'GYM_STRENGTH',
      emptyRecognized,
      false,
    );
    expect(readiness.status).toBe('READY');
    expect(readiness.missingFields).toEqual([]);

    const planningContext = new WorkoutPlanningContextBuilder().build({
      snapshot: acquired,
      artifactType: 'WEEKLY_PLAN',
      modality: 'GYM_STRENGTH',
      recognizedContext: emptyRecognized,
      referenceDate,
    });
    expect(planningContext.training).toMatchObject({
      experience: { status: 'CONFIRMED', value: 'BEGINNER' },
      weeklyFrequency: { status: 'CONFIRMED', value: 3 },
      sessionDurationMinutes: { status: 'CONFIRMED', value: 45 },
      environment: { status: 'CONFIRMED', value: 'FULL_GYM' },
      equipment: {
        status: 'CONFIRMED',
        value: ['BENCH', 'BODYWEIGHT', 'DUMBBELL'],
      },
      returningAfterBreak: { status: 'CONFIRMED', value: false },
    });
  });

  it.each([
    'FEVER',
    'SIGNIFICANT_MALAISE',
    'REPORTED_INCAPACITY',
    'EXTREME_REQUEST',
    'REHABILITATION_REQUEST',
  ] as const)('blocks %s before generation', (flag) => {
    const profile = snapshot();
    const request = recognized('HOME_WORKOUT', ['BODYWEIGHT'], {
      safety: [flag],
    });
    const readiness = new WorkoutPlanningReadinessService().evaluate(
      profile,
      'WEEKLY_PLAN',
      'HOME_WORKOUT',
      request,
      false,
    );
    expect(
      new WorkoutPlanningSafetyService().evaluateBeforeGeneration(
        profile,
        readiness,
      ).outcome,
    ).toBe('BLOCKED');
  });

  it('distinguishes limited recovery from recent-injury professional review', () => {
    const profile = snapshot();
    const evaluate = (flag: WorkoutSafetyFlag) => {
      const request = recognized('HOME_WORKOUT', ['BODYWEIGHT'], {
        safety: [flag],
      });
      const readiness = new WorkoutPlanningReadinessService().evaluate(
        profile,
        'WEEKLY_PLAN',
        'HOME_WORKOUT',
        request,
        false,
      );
      return new WorkoutPlanningSafetyService().evaluateBeforeGeneration(
        profile,
        readiness,
      ).outcome;
    };
    expect(evaluate('INSUFFICIENT_RECOVERY')).toBe('LIMITED');
    expect(evaluate('RETURN_AFTER_LONG_PAUSE')).toBe('LIMITED');
    expect(evaluate('RECENT_INJURY')).toBe('PROFESSIONAL_REVIEW_RECOMMENDED');
  });

  it('builds sanitized immutable context and materially different strategies A-E', () => {
    const inputs = [
      recognized('GYM_STRENGTH', ['BODYWEIGHT', 'DUMBBELL', 'BENCH'], {
        experience: 'BEGINNER',
        frequency: 3,
        duration: 45,
        environment: 'FULL_GYM',
        objective: 'HYPERTROPHY',
      }),
      recognized(
        'HOME_WORKOUT',
        ['BODYWEIGHT', 'DUMBBELL', 'RESISTANCE_BAND'],
        {
          experience: 'INTERMEDIATE',
          frequency: 4,
          duration: 30,
          environment: 'HOME',
          objective: 'WEIGHT_LOSS',
        },
      ),
      recognized('RUNNING', ['BODYWEIGHT'], {
        experience: 'BEGINNER',
        frequency: 3,
        environment: 'STREET',
        objective: 'COMPLETE_DISTANCE',
      }),
      recognized('CYCLING', ['BIKE'], {
        experience: 'INTERMEDIATE',
        frequency: 2,
        environment: 'ROAD',
        objective: 'CONDITIONING',
      }),
      recognized('CROSSFIT', ['BODYWEIGHT', 'DUMBBELL', 'ROW_ERGOMETER'], {
        experience: 'BEGINNER',
        frequency: 3,
        environment: 'CROSSFIT_BOX',
        objective: 'CONDITIONING',
      }),
    ];
    const strategies = inputs.map((input) =>
      new WorkoutPlanningStrategyService().build(context(input)),
    );
    expect(strategies.map((strategy) => strategy.modality)).toEqual([
      'GYM_STRENGTH',
      'HOME_WORKOUT',
      'RUNNING',
      'CYCLING',
      'CROSSFIT',
    ]);
    expect(strategies[2].requiredBlocks).toContain('ENDURANCE');
    expect(strategies[3].authorizedEquipment).toEqual(['BIKE']);
    expect(strategies[4]).toMatchObject({
      technicalMovementsAllowed: false,
      requiredBlocks: expect.arrayContaining(['TECHNIQUE', 'CONDITIONING']),
    });
    expect(JSON.stringify(context(inputs[0]))).not.toContain(
      'technical-user-id',
    );
    expect(Object.isFrozen(context(inputs[0]))).toBe(true);
  });

  it('validates complete modality plans and rejects equipment, technique, duration and progression violations', () => {
    const input = recognized('CROSSFIT', ['BODYWEIGHT'], {
      experience: 'BEGINNER',
      environment: 'CROSSFIT_BOX',
      duration: 30,
    });
    const ctx = context(input);
    const strategy = new WorkoutPlanningStrategyService().build(ctx);
    const validator = new WorkoutPlanV2Validator();
    expect(validator.validate(candidate(input), ctx, strategy).status).toBe(
      'VALID',
    );
    const unsafe = candidate(input);
    const firstSession = unsafe.sessions[0];
    const firstBlock = firstSession.blocks[0];
    const first = firstBlock.activities[0];
    const invalid = {
      ...unsafe,
      sessions: [
        {
          ...firstSession,
          estimatedDurationMinutes: 90,
          blocks: [
            {
              ...firstBlock,
              activities: [
                {
                  ...first,
                  name: 'Snatch pesado',
                  equipment: ['BARBELL'],
                  kind: 'TIMED' as const,
                  durationSeconds: 60,
                  workSeconds: 30,
                  recoverySeconds: 30,
                  rounds: 1,
                  intensity: 'HIGH' as const,
                },
              ],
            },
            ...firstSession.blocks.slice(1),
          ],
        },
      ],
      progression: [{ ...unsafe.progression[0], maximumChangePercent: 30 }],
    };
    expect(
      validator
        .validate(invalid, ctx, strategy)
        .issues.map((issue) => issue.code),
    ).toEqual(
      expect.arrayContaining([
        'SESSION_DURATION_EXCEEDED',
        'EQUIPMENT_UNAVAILABLE',
        'TECHNICAL_MOVEMENT_UNSAFE',
        'INTENSITY_EXCESSIVE',
        'AGGRESSIVE_PROGRESSION',
      ]),
    );
    const orphan = {
      ...candidate(input),
      substitutions: [
        {
          substitutionKey: 'orphan',
          sourceActivityKey: 'missing-source',
          alternativeActivityKey: 'missing-alternative',
          reason: 'EQUIPMENT' as const,
          functionPreserved: true,
          confirmationRequired: false,
        },
      ],
    };
    expect(
      validator
        .validate(orphan, ctx, strategy)
        .issues.map((issue) => issue.code),
    ).toContain('SUBSTITUTION_REFERENCE_INVALID');
  });

  it('blocks pain before AI and keeps the formatter pure', async () => {
    const ai = {
      createStandaloneJob: jest.fn(),
      runTextJob: jest.fn(),
      completeJobInTransaction: jest.fn(),
      failJob: jest.fn(),
    };
    const module = await Test.createTestingModule({
      providers: [
        WorkoutPlanningEngineV2Service,
        WorkoutArtifactResolverService,
        WorkoutPlanningReadinessService,
        WorkoutPlanningContextBuilder,
        WorkoutPlanningStrategyService,
        WorkoutPlanningSafetyService,
        WorkoutPlanV2Validator,
        { provide: AIService, useValue: ai },
        { provide: PrismaService, useValue: {} },
      ],
    }).compile();
    await expect(
      module.get(WorkoutPlanningEngineV2Service).generate({
        userId: 'user-id',
        decision: decision(),
        snapshot: snapshot(),
        recognizedContext: recognized('HOME_WORKOUT', ['BODYWEIGHT'], {
          safety: ['ACUTE_PAIN'],
        }),
        referenceDate,
      }),
    ).rejects.toThrow('BLOCKED');
    expect(ai.createStandaloneJob).not.toHaveBeenCalled();
    expect(new WorkoutPlanV2Formatter().format).toBeDefined();
  });

  it('uses AIJob lifecycle without creating a productive WorkoutPlan', async () => {
    const input = recognized('HOME_WORKOUT', ['BODYWEIGHT'], {
      artifact: 'POINT_GUIDANCE',
    });
    const output = candidate(input);
    const response = {
      responseId: 'response-id',
      model: 'model',
      outputText: JSON.stringify(output),
      promptTokens: 10,
      completionTokens: 10,
      totalTokens: 20,
    };
    const ai = {
      createStandaloneJob: jest.fn().mockResolvedValue({
        id: 'job-id',
        status: AIJobStatus.PENDING,
        promptVersionId: 'prompt-id',
        result: null,
      }),
      runTextJob: jest.fn().mockResolvedValue(response),
      completeJobInTransaction: jest.fn(),
      failJob: jest.fn(),
    };
    const transaction = Object.freeze({ marker: true });
    const prisma = {
      $transaction: jest.fn(
        async (callback: (client: object) => Promise<unknown>) =>
          callback(transaction),
      ),
    };
    const module = await Test.createTestingModule({
      providers: [
        WorkoutPlanningEngineV2Service,
        WorkoutArtifactResolverService,
        WorkoutPlanningReadinessService,
        WorkoutPlanningContextBuilder,
        WorkoutPlanningStrategyService,
        WorkoutPlanningSafetyService,
        WorkoutPlanV2Validator,
        { provide: AIService, useValue: ai },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    const plan = await module.get(WorkoutPlanningEngineV2Service).generate({
      userId: 'user-id',
      decision: decision(CONVERSATION_GOAL.GENERAL_GUIDANCE),
      snapshot: snapshot(),
      recognizedContext: input,
      referenceDate,
    });
    expect(plan.validation.status).toBe('VALID');
    expect(Object.isFrozen(plan)).toBe(true);
    expect(ai.createStandaloneJob).toHaveBeenCalledWith(
      expect.objectContaining({
        type: AIJobType.WORKOUT,
        operationKey: expect.stringMatching(/^workout-planning-v2:/),
      }),
    );
    expect(ai.runTextJob.mock.calls[0][1].input).not.toContain('user-id');
    expect(prisma).not.toHaveProperty('workoutPlan');
  });

  it('strictly parses discriminated activities and rejects malformed JSON', () => {
    const parser = new WorkoutPlanV2Parser();
    const input = recognized('RUNNING', ['BODYWEIGHT'], {
      experience: 'BEGINNER',
      environment: 'STREET',
    });
    expect(parser.parse(JSON.stringify(candidate(input))).modality).toBe(
      'RUNNING',
    );
    expect(() =>
      parser.parse(
        JSON.stringify({ ...candidate(input), unexpectedProperty: true }),
      ),
    ).toThrow('unexpectedProperty');
    expect(() => parser.parse('{bad')).toThrow('JSON inválido');
  });
});
