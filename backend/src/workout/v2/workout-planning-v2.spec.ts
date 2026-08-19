import { Test } from '@nestjs/testing';
import { BadGatewayException } from '@nestjs/common';
import {
  ActivityLevel,
  AIJobStatus,
  AIJobType,
  FitnessGoal,
  Gender,
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
  WorkoutPlanningContext,
  WorkoutRecognizedContext,
} from './workout-planning-context.contract';
import { WorkoutPlanningEngineV2Service } from './workout-planning-engine-v2.service';
import { WorkoutPlanningReadinessService } from './workout-planning-readiness.service';
import { WorkoutPlanningSafetyService } from './workout-planning-safety.service';
import { WorkoutPlanningStrategyService } from './workout-planning-strategy.service';
import { WORKOUT_PLANNING_V2_PROMPT } from './workout-planning-v2.prompt.definition';

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
      muscleFocus?: NonNullable<
        WorkoutRecognizedContext['muscleFocus']
      >['value'];
      targetDistanceKm?: number;
      currentRunningDistanceKm?: number;
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
      muscleFocus: options.muscleFocus
        ? Object.freeze({
            status: 'CONFIRMED',
            value: Object.freeze([...options.muscleFocus]),
          })
        : undefined,
      targetDistanceKm:
        options.targetDistanceKm === undefined
          ? undefined
          : Object.freeze({
              status: 'CONFIRMED',
              value: options.targetDistanceKm,
            }),
      currentRunningDistanceKm:
        options.currentRunningDistanceKm === undefined
          ? undefined
          : Object.freeze({
              status: 'CONFIRMED',
              value: options.currentRunningDistanceKm,
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

  async function engineWith(aiService: object) {
    const module = await Test.createTestingModule({
      providers: [
        WorkoutPlanningEngineV2Service,
        WorkoutArtifactResolverService,
        WorkoutPlanningReadinessService,
        WorkoutPlanningContextBuilder,
        WorkoutPlanningStrategyService,
        WorkoutPlanningSafetyService,
        WorkoutPlanV2Validator,
        { provide: AIService, useValue: aiService },
      ],
    }).compile();

    return module.get(WorkoutPlanningEngineV2Service);
  }

  it('prepares Workout V2 without AIJob or provider side effects', async () => {
    const aiService = {
      createStandaloneJob: jest.fn(),
      runTextJob: jest.fn(),
      completeJobInTransaction: jest.fn(),
      failJob: jest.fn(),
    };
    const engine = await engineWith(aiService);

    const prepared = engine.prepare({
      userId: 'user-id',
      decision: decision(),
      snapshot: snapshot(),
      recognizedContext: recognized('HOME_WORKOUT', ['BODYWEIGHT']),
      referenceDate,
    });

    expect(prepared.resolution.status).toBe('RESOLVED');
    expect(Object.isFrozen(prepared)).toBe(true);
    expect(aiService.createStandaloneJob).not.toHaveBeenCalled();
    expect(aiService.runTextJob).not.toHaveBeenCalled();
    expect(aiService.completeJobInTransaction).not.toHaveBeenCalled();
    expect(aiService.failJob).not.toHaveBeenCalled();
  });

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
        'CROSSFIT',
        recognized('CROSSFIT', ['BODYWEIGHT'], {
          environment: 'HOME',
          experience: 'INTERMEDIATE',
        }),
        false,
      ).missingFields,
    ).toContain('ENVIRONMENT');
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

  it('requires clarification for a recognized movement constraint awaiting confirmation', () => {
    const result = new WorkoutPlanningReadinessService().evaluate(
      snapshot(),
      'WEEKLY_PLAN',
      'GYM_STRENGTH',
      {
        ...recognized('GYM_STRENGTH', ['BODYWEIGHT', 'DUMBBELL'], {
          environment: 'FULL_GYM',
        }),
        movementConstraints: Object.freeze([
          Object.freeze({
            code: 'KNEE_LOAD' as const,
            label: 'joelho',
            status: 'REQUIRES_CONFIRMATION' as const,
          }),
        ]),
      },
      false,
    );

    expect(result.status).toBe('REQUIRES_CONFIRMATION');
    expect(result.executionLevel).toBe('CLARIFICATION_ONLY');
    expect(result.safetyFlags).toContain('UNCONFIRMED_LIMITATION');
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
    expect(new WorkoutPlanV2Formatter()).toBeDefined();
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
    const generation = await module
      .get(WorkoutPlanningEngineV2Service)
      .generateCandidate({
        userId: 'user-id',
        decision: decision(CONVERSATION_GOAL.GENERAL_GUIDANCE),
        snapshot: snapshot(),
        recognizedContext: input,
        referenceDate,
      });
    expect(generation).toMatchObject({
      status: 'PENDING_COMPLETION',
      reused: false,
      aiJobId: 'job-id',
      operationKey: expect.stringMatching(/^workout-planning-v2:/),
      storedResult: {
        candidateOutput: response.outputText,
        model: response.model,
      },
      output: { validation: { status: 'VALID' } },
    });
    expect(generation.completion).toEqual({
      userId: 'user-id',
      aiJobId: 'job-id',
      jobType: AIJobType.WORKOUT,
      response,
      result: {
        candidateOutput: response.outputText,
        model: response.model,
      },
    });
    expect(Object.isFrozen(generation)).toBe(true);
    expect(Object.isFrozen(generation.output)).toBe(true);
    expect(ai.createStandaloneJob).toHaveBeenCalledWith(
      expect.objectContaining({
        type: AIJobType.WORKOUT,
        operationKey: expect.stringMatching(/^workout-planning-v2:/),
      }),
    );
    expect(ai.runTextJob.mock.calls[0][1].input).not.toContain('user-id');
    expect(ai.completeJobInTransaction).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma).not.toHaveProperty('workoutPlan');
  });

  it('reuses a completed Workout candidate without calling the provider', async () => {
    const input = recognized('HOME_WORKOUT', ['BODYWEIGHT'], {
      artifact: 'POINT_GUIDANCE',
    });
    const storedResult = {
      candidateOutput: JSON.stringify(candidate(input)),
      model: 'stored-model',
    };
    const aiService = {
      createStandaloneJob: jest.fn().mockResolvedValue({
        id: 'completed-job-id',
        status: AIJobStatus.COMPLETED,
        promptVersionId: 'prompt-id',
        result: storedResult,
      }),
      runTextJob: jest.fn(),
      completeJobInTransaction: jest.fn(),
      failJob: jest.fn(),
    };

    const generation = await (
      await engineWith(aiService)
    ).generateCandidate({
      userId: 'user-id',
      decision: decision(CONVERSATION_GOAL.GENERAL_GUIDANCE),
      snapshot: snapshot(),
      recognizedContext: input,
      referenceDate,
    });

    expect(generation).toMatchObject({
      status: 'ALREADY_COMPLETED',
      aiJobId: 'completed-job-id',
      reused: true,
      completion: null,
      storedResult,
      output: { validation: { status: 'VALID' } },
    });
    expect(aiService.runTextJob).not.toHaveBeenCalled();
    expect(aiService.completeJobInTransaction).not.toHaveBeenCalled();
    expect(aiService.failJob).not.toHaveBeenCalled();
  });

  it('does not reclaim or fail an idempotent Workout job already processing', async () => {
    const aiService = {
      createStandaloneJob: jest.fn().mockResolvedValue({
        id: 'processing-job-id',
        status: AIJobStatus.PROCESSING,
        promptVersionId: 'prompt-id',
        result: null,
      }),
      runTextJob: jest.fn(),
      completeJobInTransaction: jest.fn(),
      failJob: jest.fn(),
    };

    await expect(
      (await engineWith(aiService)).generateCandidate({
        userId: 'user-id',
        decision: decision(),
        snapshot: snapshot(),
        recognizedContext: recognized('HOME_WORKOUT', ['BODYWEIGHT']),
        referenceDate,
      }),
    ).rejects.toThrow('em andamento');
    expect(aiService.runTextJob).not.toHaveBeenCalled();
    expect(aiService.completeJobInTransaction).not.toHaveBeenCalled();
    expect(aiService.failJob).not.toHaveBeenCalled();
  });

  it('fails the Workout AIJob when fresh candidate generation fails', async () => {
    const providerError = new BadGatewayException('provider unavailable');
    const aiService = {
      createStandaloneJob: jest.fn().mockResolvedValue({
        id: 'job-id',
        status: AIJobStatus.PENDING,
        promptVersionId: 'prompt-id',
        result: null,
      }),
      runTextJob: jest.fn().mockRejectedValue(providerError),
      completeJobInTransaction: jest.fn(),
      failJob: jest.fn().mockResolvedValue(undefined),
    };

    await expect(
      (await engineWith(aiService)).generateCandidate({
        userId: 'user-id',
        decision: decision(),
        snapshot: snapshot(),
        recognizedContext: recognized('HOME_WORKOUT', ['BODYWEIGHT']),
        referenceDate,
      }),
    ).rejects.toBe(providerError);
    expect(aiService.failJob).toHaveBeenCalledWith(
      'job-id',
      providerError,
      undefined,
    );
    expect(aiService.completeJobInTransaction).not.toHaveBeenCalled();
  });

  it.each([
    [Gender.MALE, ['CHEST', 'BACK'], 4],
    [Gender.FEMALE, ['GLUTES', 'LOWER_BODY'], 4],
    [Gender.FEMALE, ['UPPER_BODY'], 3],
    [Gender.MALE, ['LOWER_BODY'], 4],
  ] as const)(
    'uses sex as context without overriding explicit focus: %s / %j',
    (sex, muscleFocus, frequency) => {
      const base = snapshot();
      const profile = Object.freeze({
        ...base,
        physical: Object.freeze({ ...base.physical, sex: known(sex) }),
      });
      const planningContext = context(
        recognized(
          'GYM_STRENGTH',
          ['BARBELL', 'DUMBBELL', 'MACHINE', 'CABLE', 'BENCH'],
          {
            objective: 'HYPERTROPHY',
            experience: 'INTERMEDIATE',
            frequency,
            duration: 60,
            environment: 'FULL_GYM',
            muscleFocus,
          },
        ),
        profile,
      );
      const strategy = new WorkoutPlanningStrategyService().build(
        planningContext,
      );

      expect(planningContext.profile.sex).toEqual({
        status: 'CONFIRMED',
        value: sex,
      });
      expect(strategy.muscleFocus).toEqual(muscleFocus);
      expect(strategy.sessionCount).toBe(frequency);
      expect(strategy.personalizationFactors).toEqual(
        expect.arrayContaining(['SEX', 'MUSCLE_FOCUS']),
      );
    },
  );

  it.each([
    WORKOUT_ARTIFACT_TYPE.PLAN_ADAPTATION,
    WORKOUT_ARTIFACT_TYPE.EXERCISE_SUBSTITUTION,
  ] as const)(
    'preserves the canonical previous-plan session count for %s without an explicit frequency change',
    (artifactType) => {
      const base = context(
        recognized('GYM_STRENGTH', ['BODYWEIGHT'], { artifact: artifactType }),
      );
      const mutationContext = {
        ...base,
        training: {
          ...base.training,
          weeklyFrequency: { status: 'NOT_SET' },
        },
        previousPlan: { sessionCount: 4 },
      } as unknown as WorkoutPlanningContext;

      expect(
        new WorkoutPlanningStrategyService().build(mutationContext)
          .sessionCount,
      ).toBe(4);
    },
  );

  it('uses an explicit adaptation frequency instead of the previous-plan count', () => {
    const base = context(
      recognized('GYM_STRENGTH', ['BODYWEIGHT'], {
        artifact: WORKOUT_ARTIFACT_TYPE.PLAN_ADAPTATION,
        frequency: 2,
      }),
    );
    const mutationContext = {
      ...base,
      previousPlan: { sessionCount: 4 },
    } as unknown as WorkoutPlanningContext;

    expect(
      new WorkoutPlanningStrategyService().build(mutationContext).sessionCount,
    ).toBe(2);
  });

  it('specializes CrossFit for experience, environment and constraints', () => {
    const beginner = new WorkoutPlanningStrategyService().build(
      context(
        recognized('CROSSFIT', ['BODYWEIGHT', 'ROW_ERGOMETER'], {
          environment: 'CROSSFIT_BOX',
          experience: 'BEGINNER',
          frequency: 3,
        }),
      ),
    );
    const intermediateInput = Object.freeze({
      ...recognized('CROSSFIT', ['BODYWEIGHT', 'DUMBBELL'], {
        environment: 'CROSSFIT_BOX',
        experience: 'INTERMEDIATE',
      }),
      movementConstraints: Object.freeze([
        Object.freeze({
          code: 'KNEE_LOAD' as const,
          label: 'restrição de joelho',
          status: 'CONFIRMED' as const,
        }),
      ]),
    });
    const intermediate = new WorkoutPlanningStrategyService().build(
      context(intermediateInput),
    );

    expect(beginner.requiredBlocks).toEqual([
      'WARM_UP',
      'TECHNIQUE',
      'CONDITIONING',
      'COOLDOWN',
    ]);
    expect(beginner.technicalMovementsAllowed).toBe(false);
    expect(intermediate.technicalMovementsAllowed).toBe(true);
    expect(intermediate.appliedConstraints).toEqual([
      expect.objectContaining({ code: 'KNEE_LOAD' }),
    ]);
  });

  it('carries existing format, intensity, days and windows into personalization', () => {
    const base = snapshot();
    const profile = Object.freeze({
      ...base,
      training: Object.freeze({
        ...base.training,
        intensityPreference: known('HIGH'),
        trainingFormatPreference: known('INDIVIDUAL'),
      }),
      routine: Object.freeze({
        ...base.routine,
        availableTrainingDays: known(Object.freeze(['MONDAY', 'WEDNESDAY'])),
        dailyTrainingWindows: known(Object.freeze(['MONDAY:18:00-19:00'])),
      }),
    });
    const planningContext = context(
      recognized('GYM_STRENGTH', ['DUMBBELL'], {
        environment: 'LIMITED_GYM',
      }),
      profile,
    );
    const strategy = new WorkoutPlanningStrategyService().build(
      planningContext,
    );

    expect(planningContext.training).toMatchObject({
      intensityPreference: { status: 'CONFIRMED', value: 'MODERATE' },
      formatPreference: { status: 'CONFIRMED', value: 'INDIVIDUAL' },
      availableTrainingDays: {
        status: 'CONFIRMED',
        value: ['MONDAY', 'WEDNESDAY'],
      },
      dailyTrainingWindows: {
        status: 'CONFIRMED',
        value: ['MONDAY:18:00-19:00'],
      },
    });
    expect(strategy.personalizationFactors).toEqual(
      expect.arrayContaining([
        'INTENSITY_PREFERENCE',
        'FORMAT_PREFERENCE',
        'AVAILABLE_TRAINING_DAYS',
        'DAILY_TRAINING_WINDOWS',
      ]),
    );
  });

  it('specializes beginner street running and distance readiness', () => {
    const starter = recognized('RUNNING', [], {
      objective: 'CONDITIONING',
      environment: 'STREET',
      experience: 'BEGINNER',
      frequency: 3,
    });
    const distanceReady = recognized('RUNNING', [], {
      objective: 'COMPLETE_DISTANCE',
      environment: 'STREET',
      experience: 'INTERMEDIATE',
      frequency: 3,
      targetDistanceKm: 10,
      currentRunningDistanceKm: 5,
    });
    const distanceMissingAbility = recognized('RUNNING', [], {
      objective: 'COMPLETE_DISTANCE',
      environment: 'STREET',
      experience: 'BEGINNER',
      frequency: 3,
      targetDistanceKm: 10,
    });
    const strategy = new WorkoutPlanningStrategyService().build(
      context(starter),
    );
    const readiness = new WorkoutPlanningReadinessService();

    expect(strategy.requiredBlocks).toEqual([
      'WARM_UP',
      'ENDURANCE',
      'COOLDOWN',
    ]);
    expect(strategy.intensityPolicy.scale).toBe('CONVERSATIONAL_PACE');
    expect(
      readiness.evaluate(
        snapshot(),
        'WEEKLY_PLAN',
        'RUNNING',
        distanceReady,
        false,
      ),
    ).toMatchObject({ status: 'READY', missingFields: [] });
    expect(
      readiness.evaluate(
        snapshot(),
        'WEEKLY_PLAN',
        'RUNNING',
        distanceMissingAbility,
        false,
      ),
    ).toMatchObject({
      status: 'BLOCKED',
      missingFields: ['CURRENT_RUNNING_DISTANCE'],
    });
    const missingWithRecentInjury = readiness.evaluate(
      snapshot(),
      'WEEKLY_PLAN',
      'RUNNING',
      Object.freeze({
        ...distanceMissingAbility,
        safetySignals: Object.freeze(['RECENT_INJURY' as const]),
      }),
      false,
    );
    expect(
      new WorkoutPlanningSafetyService().evaluateBeforeGeneration(
        snapshot(),
        missingWithRecentInjury,
      ).outcome,
    ).toBe('PROFESSIONAL_REVIEW_RECOMMENDED');
  });

  it.each([
    ['CARDIO_CONDITIONING', 'CONDITIONING'],
    ['HOME_WORKOUT', 'CONDITIONING'],
  ] as const)(
    'uses conditioning blocks without mandatory strength for %s',
    (modality, objective) => {
      const strategy = new WorkoutPlanningStrategyService().build(
        context(
          recognized(modality, [], {
            objective,
            environment: 'HOME',
            duration: 30,
          }),
        ),
      );

      expect(strategy.requiredBlocks).toContain('CONDITIONING');
      expect(strategy.requiredBlocks).not.toContain('STRENGTH');
      expect(strategy.requiredBlocks).not.toContain('HYPERTROPHY');
      expect(strategy.authorizedEquipment).toEqual([]);
    },
  );

  it('publishes prompt V2 with explicit personalization and stereotype guards', () => {
    expect(WORKOUT_PLANNING_V2_PROMPT).toMatchObject({
      name: 'workout_planning_v2',
      version: 2,
      capability: 'WORKOUT_PLANNING_V2',
    });
    expect(WORKOUT_PLANNING_V2_PROMPT.instructions).toContain(
      'Nunca derive foco muscular',
    );
    expect(WORKOUT_PLANNING_V2_PROMPT.instructions).toContain(
      'Preferências e foco muscular explicitamente confirmados prevalecem',
    );
    expect(WORKOUT_PLANNING_V2_PROMPT.instructions).toContain(
      'não repita full-body indiscriminadamente',
    );
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
