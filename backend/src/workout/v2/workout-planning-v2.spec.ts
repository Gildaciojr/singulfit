import { WorkoutPromptActivationService } from './workout-prompt-activation.service';
import { WorkoutApplicationExecutorService } from './execution/workout-application-executor.service';
import type { WorkoutPlanV2PersistenceService } from './persistence/workout-plan-v2-persistence.service';
import { createHash } from 'node:crypto';
import { GenerateWorkoutPlanV2InputBuilder } from './generate-workout-plan-v2-input.builder';
import type { CoachProfileSnapshotBuilder } from '../../context/coach-profile-snapshot.builder';
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
import {
  WorkoutPlanningEngineV2Service,
  WORKOUT_PLANNING_V2_EXECUTION_REVISION,
  WorkoutPostGenerationValidationError,
} from './workout-planning-engine-v2.service';
import { WorkoutPlanningReadinessService } from './workout-planning-readiness.service';
import { WorkoutPlanningSafetyService } from './workout-planning-safety.service';
import { WorkoutPlanningStrategyService } from './workout-planning-strategy.service';
import type { WorkoutBlockType } from './workout-planning-strategy.contract';
import {
  WORKOUT_PLANNING_V2_PROMPT,
  WORKOUT_PLANNING_V2_PROMPT_V9,
  WORKOUT_PLANNING_V2_PROMPT_V3,
  workoutSchemaForAuthorizedEquipment,
} from './workout-planning-v2.prompt.definition';

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
      secondaryObjectives?: readonly NonNullable<
        WorkoutRecognizedContext['objective']
      >['value'][];
      conditioning?: 'LOW' | 'MODERATE' | 'HIGH';
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
      secondaryObjectives: options.secondaryObjectives
        ? Object.freeze({
            status: 'CONFIRMED',
            value: Object.freeze([...options.secondaryObjectives]),
          })
        : undefined,
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
        value: options.conditioning ?? 'MODERATE',
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
    durationMinutes = 5,
  ): WorkoutActivityV2 {
    const base = {
      activityKey: key,
      name:
        block === 'TECHNIQUE'
          ? 'Técnica básica escalada'
          : `Atividade ${block}`,
      source: 'MODEL_GENERATED' as const,
      movementPattern: 'OTHER' as const,
      publicIdentity: {
        plane: 'SAGITTAL' as const,
        targetRegion: 'WHOLE_BODY' as const,
        bodyPosition: 'STANDING' as const,
        jointAction: 'STABILIZATION' as const,
      },
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
        durationMinutes,
        distanceKm: null,
        intensity: 'CONVERSATIONAL',
      });
    if (block === 'MOBILITY' || block === 'RECOVERY')
      return Object.freeze({
        ...base,
        kind: 'MOBILITY',
        repetitions: null,
        holdSeconds: null,
        durationSeconds: Math.round(durationMinutes * 60),
      });
    return Object.freeze({
      ...base,
      kind: 'TIMED',
      durationSeconds: Math.round(durationMinutes * 60),
      workSeconds: 30,
      recoverySeconds: 30,
      rounds: Math.max(1, Math.floor(durationMinutes)),
      intensity: 'MODERATE',
    });
  }

  function candidate(
    input: WorkoutRecognizedContext,
  ): GeneratedWorkoutPlanV2Candidate {
    const ctx = context(input);
    const strategy = new WorkoutPlanningStrategyService().build(ctx);
    const blocks: readonly WorkoutBlockType[] =
      strategy.modality === 'CROSSFIT'
        ? ['WARM_UP', 'TECHNIQUE', 'CONDITIONING', 'COOLDOWN']
        : [
            'WARM_UP',
            strategy.modality === 'RUNNING' ||
            strategy.modality === 'WALKING' ||
            strategy.modality === 'CYCLING'
              ? 'ENDURANCE'
              : 'STRENGTH',
            'COOLDOWN',
          ];
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
            weekday: (
              [
                'MONDAY',
                'WEDNESDAY',
                'FRIDAY',
                'SUNDAY',
                'TUESDAY',
                'THURSDAY',
                'SATURDAY',
              ] as const
            )[sessionIndex],
            sequence: sessionIndex + 1,
            label: `Sessão ${sessionIndex + 1}`,
            estimatedDurationMinutes:
              strategy.sessionDurationMinutes.status === 'NOT_SET'
                ? 30
                : strategy.sessionDurationMinutes.value,
            blocks: Object.freeze(
              blocks.map((block, blockIndex) =>
                Object.freeze({
                  blockKey: `block-${sessionIndex + 1}-${blockIndex + 1}`,
                  type: block,
                  title: block,
                  estimatedDurationMinutes:
                    (strategy.sessionDurationMinutes.status === 'NOT_SET'
                      ? 30
                      : strategy.sessionDurationMinutes.value) / blocks.length,
                  activities: Object.freeze([
                    activity(
                      `activity-${sessionIndex + 1}-${blockIndex + 1}`,
                      block,
                      strategy.modality,
                      strategy.authorizedEquipment[0] ?? 'BODYWEIGHT',
                      (strategy.sessionDurationMinutes.status === 'NOT_SET'
                        ? 30
                        : strategy.sessionDurationMinutes.value) /
                        blocks.length,
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
        {
          provide: WorkoutPromptActivationService,
          useValue: { ensureActive: jest.fn().mockResolvedValue(undefined) },
        },
      ],
    }).compile();

    return module.get(WorkoutPlanningEngineV2Service);
  }

  it('makes persisted FULL_GYM ready and preserves inferred equipment provenance', () => {
    const base = snapshot();
    const profile = {
      ...base,
      training: {
        ...base.training,
        environment: known('FULL_GYM'),
        availableEquipment: unknown<readonly string[]>(),
      },
    };
    const declared = recognized('GYM_STRENGTH', [], {
      frequency: 5,
      duration: 60,
      environment: 'FULL_GYM',
    });
    const { equipment: ignored, ...withoutInventory } = declared;
    void ignored;
    const readiness = new WorkoutPlanningReadinessService().evaluate(
      profile,
      'WEEKLY_PLAN',
      'GYM_STRENGTH',
      withoutInventory,
      false,
    );
    expect(readiness.missingFields).not.toContain('EQUIPMENT');
    expect(readiness.status).toBe('READY');
    const ctx = context(withoutInventory, profile);
    expect(ctx.training.equipment).toMatchObject({
      status: 'INFERRED',
      value: expect.arrayContaining(['BODYWEIGHT', 'BARBELL', 'MACHINE']),
    });
    expect(profile.training.availableEquipment.status).toBe('UNKNOWN');
  });

  function equipmentSchemas(
    value: unknown,
  ): readonly Record<string, unknown>[] {
    if (Array.isArray(value)) return value.flatMap(equipmentSchemas);
    if (value === null || typeof value !== 'object') return [];
    const record = value as Record<string, unknown>;
    return Object.entries(record).flatMap(([key, child]) =>
      key === 'equipment' && child !== null && typeof child === 'object'
        ? [child as Record<string, unknown>]
        : equipmentSchemas(child),
    );
  }
  it('restricts every strict activity variant to request equipment without changing the historical schema', () => {
    const schema = workoutSchemaForAuthorizedEquipment([
      'DUMBBELL',
      'BODYWEIGHT',
    ]);
    const variants = equipmentSchemas(schema.schema);
    expect(variants).toHaveLength(4);
    for (const variant of variants)
      expect(variant.items).toEqual({
        type: 'string',
        enum: ['DUMBBELL', 'BODYWEIGHT'],
      });
    expect(JSON.stringify(schema.schema)).toContain(
      '"additionalProperties":false',
    );
    expect(JSON.stringify(WORKOUT_PLANNING_V2_PROMPT_V3.schema)).toContain(
      'KETTLEBELL',
    );
    for (const variant of equipmentSchemas(
      workoutSchemaForAuthorizedEquipment([]).schema,
    ))
      expect(variant.maxItems).toBe(0);
    expect(WORKOUT_PLANNING_V2_PROMPT.version).toBe(11);
    expect(WORKOUT_PLANNING_V2_PROMPT_V3.version).toBe(3);
  });
  it('reproduces five 60-minute FULL_GYM sessions with bodyweight warm-up without unavailable-equipment failures', () => {
    const input = recognized(
      'GYM_STRENGTH',
      [
        'BARBELL',
        'BENCH',
        'CABLE',
        'DUMBBELL',
        'MACHINE',
        'PULL_UP_BAR',
        'TREADMILL',
      ],
      { frequency: 5, duration: 60, environment: 'FULL_GYM' },
    );
    const ctx = context(input);
    const strategy = new WorkoutPlanningStrategyService().build(ctx);
    const output = candidate(input);
    const withBodyweight = {
      ...output,
      sessions: output.sessions.map((session) => ({
        ...session,
        blocks: session.blocks.map((block) => ({
          ...block,
          activities: block.activities.map((item) => ({
            ...item,
            equipment: ['BODYWEIGHT'] as const,
          })),
        })),
      })),
    };
    const result = new WorkoutPlanV2Validator().validate(
      withBodyweight,
      ctx,
      strategy,
    );
    expect(strategy.sessionCount).toBe(5);
    expect(result.status).not.toBe('INVALID');
    expect(
      result.issues.filter((issue) => issue.code === 'EQUIPMENT_UNAVAILABLE'),
    ).toEqual([]);
    const limited = new WorkoutPlanningStrategyService().build(
      context(
        recognized('GYM_STRENGTH', ['DUMBBELL'], {
          frequency: 5,
          duration: 60,
        }),
      ),
    );
    const unauthorized = {
      ...withBodyweight,
      sessions: withBodyweight.sessions.map((session) => ({
        ...session,
        blocks: session.blocks.map((block) => ({
          ...block,
          activities: block.activities.map((item) => ({
            ...item,
            equipment: ['CABLE'] as const,
          })),
        })),
      })),
    };
    expect(
      new WorkoutPlanV2Validator()
        .validate(unauthorized, ctx, limited)
        .issues.some(
          (issue) =>
            issue.code === 'EQUIPMENT_UNAVAILABLE' &&
            issue.severity === 'ERROR',
        ),
    ).toBe(true);
  });

  it('uses persisted running distances when the current message has none, while current values win', () => {
    const base = snapshot();
    const persisted = Object.freeze({
      ...base,
      training: Object.freeze({
        ...base.training,
        targetDistanceKm: known(5),
        currentRunningDistanceKm: known(2.5),
      }),
    });
    const fallback = context(
      recognized('RUNNING', [], {
        objective: 'COMPLETE_DISTANCE',
        environment: 'STREET',
      }),
      persisted,
    );
    expect(fallback.training.targetDistanceKm).toEqual({
      status: 'CONFIRMED',
      value: 5,
    });
    expect(fallback.training.currentRunningDistanceKm).toEqual({
      status: 'CONFIRMED',
      value: 2.5,
    });
    const current = context(
      recognized('RUNNING', [], {
        objective: 'COMPLETE_DISTANCE',
        environment: 'STREET',
        targetDistanceKm: 10,
      }),
      persisted,
    );
    expect(current.training.targetDistanceKm).toEqual({
      status: 'CONFIRMED',
      value: 10,
    });
    expect(current.training.currentRunningDistanceKm).toEqual({
      status: 'CONFIRMED',
      value: 2.5,
    });
    const none = context(
      recognized('RUNNING', [], {
        objective: 'COMPLETE_DISTANCE',
        environment: 'STREET',
      }),
    );
    expect(none.training.targetDistanceKm).toEqual({ status: 'NOT_SET' });
    expect(none.training.currentRunningDistanceKm).toEqual({
      status: 'NOT_SET',
    });
  });

  it('sends individualized canonical payloads with deterministic user-isolated identities', async () => {
    const ai = {
      createStandaloneJob: jest.fn().mockResolvedValue({
        id: 'fake-job',
        status: AIJobStatus.PENDING,
        promptVersion: {
          version: WORKOUT_PLANNING_V2_PROMPT.version,
          name: WORKOUT_PLANNING_V2_PROMPT.name,
        },
      }),
      runTextJob: jest
        .fn()
        .mockRejectedValue(new Error('mock payload captured')),
      failJob: jest.fn(),
    };
    const engine = await engineWith(ai);
    const builder = new GenerateWorkoutPlanV2InputBuilder(
      {} as CoachProfileSnapshotBuilder,
      {} as PrismaService,
    );
    const makeProfile = (advanced: boolean): CoachProfileSnapshot => {
      const base = snapshot(advanced ? [] : ['evitar sobrecarga no joelho']);
      return {
        ...base,
        identity: {
          ...base.identity,
          userId: known(advanced ? 'fictional-b' : 'fictional-a'),
        },
        physical: {
          ...base.physical,
          activityLevel: known(
            advanced ? ActivityLevel.HIGH : ActivityLevel.SEDENTARY,
          ),
        },
        nutrition: {
          ...base.nutrition,
          primaryGoal: known(
            advanced ? FitnessGoal.MUSCLE_GAIN : FitnessGoal.WEIGHT_LOSS,
          ),
        },
        training: {
          ...base.training,
          experienceLevel: known(advanced ? 'ADVANCED' : 'BEGINNER'),
          weeklyFrequency: known(advanced ? 5 : 3),
          sessionDurationMinutes: known(45),
          perceivedConditioning: known(advanced ? 'HIGH' : 'LOW'),
          environment: known('FULL_GYM'),
        },
      };
    };
    const input = async (
      userId: string,
      profile: CoachProfileSnapshot,
      message = 'Monte um treino para academia',
    ) =>
      (
        await builder.build({
          userId,
          profileId: userId + '-profile',
          snapshot: profile,
          currentMessage: message,
          referenceDate,
        })
      ).generationInput;
    const a = await input('fictional-a', makeProfile(false));
    const b = await input('fictional-b', makeProfile(true));
    const before = JSON.stringify(a);
    const pa = engine.prepare(a);
    const pb = engine.prepare(b);
    expect(pa.readiness?.status).toBe('READY');
    expect(pb.readiness?.status).toBe('READY');
    expect(pa.context).not.toEqual(pb.context);
    expect(pa.strategy).not.toEqual(pb.strategy);
    expect(pa.context?.training).toMatchObject({
      experience: { value: 'BEGINNER' },
      weeklyFrequency: { value: 3 },
      perceivedConditioning: { value: 'LOW' },
    });
    expect(pb.context?.training).toMatchObject({
      experience: { value: 'ADVANCED' },
      weeklyFrequency: { value: 5 },
      perceivedConditioning: { value: 'HIGH' },
    });
    expect(pa.context?.movementConstraints.length).toBeGreaterThan(0);
    expect(pb.context?.movementConstraints).toEqual([]);
    for (const generationInput of [a, b, a, { ...a, userId: 'fictional-c' }]) {
      await expect(engine.generateCandidate(generationInput)).rejects.toThrow(
        'mock payload captured',
      );
    }
    const payloads = ai.runTextJob.mock.calls.map(
      (call) =>
        JSON.parse(call[1].input as string) as {
          context: WorkoutPlanningContext;
          strategy: unknown;
        },
    );
    expect(payloads[0].context).toEqual(pa.context);
    expect(payloads[1].context).toEqual(pb.context);
    expect(payloads[0].strategy).not.toEqual(payloads[1].strategy);
    expect(payloads[2]).toEqual(payloads[0]);
    expect(payloads[3]).toEqual(payloads[0]);
    const keys = ai.createStandaloneJob.mock.calls.map(
      (call) => (call[0] as { operationKey: string }).operationKey,
    );
    expect(keys[0]).toBe(keys[2]);
    expect(new Set([keys[0], keys[1], keys[3]]).size).toBe(3);
    expect(JSON.stringify(a)).toBe(before);

    for (const message of [
      'Monte um treino de CrossFit',
      'Quero correr na rua',
    ]) {
      await expect(
        engine.generateCandidate(
          await input('fictional-a', makeProfile(false), message),
        ),
      ).rejects.toThrow('mock payload captured');
    }
    const modalityPayloads = [0, 4, 5].map(
      (index) =>
        JSON.parse(ai.runTextJob.mock.calls[index][1].input as string) as {
          context: WorkoutPlanningContext;
          strategy: unknown;
        },
    );
    expect(
      modalityPayloads.map((payload) =>
        payload.context.modality.status === 'NOT_SET'
          ? null
          : payload.context.modality.value,
      ),
    ).toEqual(['GYM_STRENGTH', 'CROSSFIT', 'RUNNING']);
    expect(
      new Set(
        modalityPayloads.map((payload) => JSON.stringify(payload.strategy)),
      ).size,
    ).toBe(3);
    const renamed = {
      ...a,
      snapshot: {
        ...a.snapshot,
        identity: {
          ...a.snapshot.identity,
          displayName: known('Nome Alterado'),
        },
      },
    };
    await expect(engine.generateCandidate(renamed)).rejects.toThrow(
      'mock payload captured',
    );
    expect(ai.createStandaloneJob.mock.calls.at(-1)?.[0].operationKey).toBe(
      keys[0],
    );
    expect(ai.runTextJob.mock.calls.at(-1)?.[1].input).toBe(
      ai.runTextJob.mock.calls[0][1].input,
    );
    expect(ai.runTextJob.mock.calls.at(-1)?.[1].input).not.toContain(
      'Nome Alterado',
    );
  });

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
    ).not.toContain('EXPERIENCE');
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
    ).not.toContain('ENVIRONMENT');
    expect(
      service.evaluate(
        profile,
        'WEEKLY_PLAN',
        'CROSSFIT',
        {
          ...recognized('CROSSFIT', ['BODYWEIGHT'], {
            experience: 'INTERMEDIATE',
          }),
          environment: undefined,
        },
        false,
      ).missingFields,
    ).not.toContain('ENVIRONMENT');
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
    expect(strategies[2].requiredBlocks).toEqual([]);
    expect(strategies[3].authorizedEquipment).toEqual(['BIKE', 'BODYWEIGHT']);
    expect(strategies[4]).toMatchObject({
      technicalMovementsAllowed: false,
      requiredBlocks: [],
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
        {
          provide: WorkoutPromptActivationService,
          useValue: { ensureActive: jest.fn().mockResolvedValue(undefined) },
        },
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
        promptVersion: {
          version: WORKOUT_PLANNING_V2_PROMPT.version,
          name: WORKOUT_PLANNING_V2_PROMPT.name,
        },
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
        {
          provide: WorkoutPromptActivationService,
          useValue: { ensureActive: jest.fn().mockResolvedValue(undefined) },
        },
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
    expect(generation.completion).toMatchObject({
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
    const providerRequest = ai.runTextJob.mock.calls[0][1];
    expect(providerRequest.jsonSchema).toEqual(
      workoutSchemaForAuthorizedEquipment(
        generation.output.strategy.authorizedEquipment,
      ),
    );
    const keyForVersion = (version: number) =>
      `workout-planning-v2:${createHash('sha256').update(`user-id:${version}:${providerRequest.input}`).digest('hex')}`;
    expect(generation.operationKey).toBe(
      `workout-planning-v2:${createHash('sha256').update(`user-id:11:${WORKOUT_PLANNING_V2_EXECUTION_REVISION}:${providerRequest.input}`).digest('hex')}`,
    );
    expect(WORKOUT_PLANNING_V2_EXECUTION_REVISION).toBe(
      'ai-first-v10-weekday-v1',
    );
    expect(generation.operationKey).not.toBe(keyForVersion(6));
    expect(generation.operationKey).not.toBe(keyForVersion(7));
    expect(generation.operationKey).not.toBe(keyForVersion(3));
    expect(generation.operationKey).not.toBe(keyForVersion(5));
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
        promptVersion: {
          version: WORKOUT_PLANNING_V2_PROMPT.version,
          name: WORKOUT_PLANNING_V2_PROMPT.name,
        },
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
        promptVersion: {
          version: WORKOUT_PLANNING_V2_PROMPT.version,
          name: WORKOUT_PLANNING_V2_PROMPT.name,
        },
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

  it.each([AIJobStatus.PENDING, AIJobStatus.COMPLETED])(
    'canonicalizes the production incident for %s while preserving the raw provider clock',
    async (status) => {
      const input = recognized('GYM_STRENGTH', ['BODYWEIGHT', 'DUMBBELL'], {
        frequency: 5,
        duration: 60,
        environment: 'FULL_GYM',
      });
      const base = candidate(input);
      const raw = {
        ...base,
        sessions: base.sessions.map((session, index) =>
          index !== 4
            ? session
            : {
                ...session,
                blocks: session.blocks.map((block) =>
                  block.type !== 'STRENGTH'
                    ? block
                    : {
                        ...block,
                        activities: [
                          // Reserve time for the carry while keeping its incident clock unchanged.
                          ...block.activities.map((activity) =>
                            activity.kind === 'TIMED'
                              ? {
                                  ...activity,
                                  durationSeconds: 810,
                                  rounds: 14,
                                }
                              : activity,
                          ),
                          {
                            activityKey: 'FRIDAY_STRENGTH_3',
                            name: 'Farmer walk com halteres',
                            source: 'MODEL_GENERATED' as const,
                            movementPattern: 'CARRY' as const,
                            publicIdentity: {
                              plane: 'SAGITTAL' as const,
                              targetRegion: 'WHOLE_BODY' as const,
                              bodyPosition: 'STANDING' as const,
                              jointAction: null,
                            },
                            equipment: ['DUMBBELL' as const],
                            instruction: 'Caminhe com controle.',
                            alerts: [],
                            appliedConstraintCodes: [],
                            kind: 'TIMED' as const,
                            durationSeconds: 40,
                            workSeconds: 40,
                            recoverySeconds: 60,
                            rounds: 4,
                            intensity: 'MODERATE' as const,
                          },
                        ],
                      },
                ),
              },
        ),
      };
      const rawOutput = `  ${JSON.stringify(raw)}\n`;
      const storedResult = { candidateOutput: rawOutput, model: 'model' };
      const response = {
        responseId: 'provider-response',
        model: 'model',
        outputText: rawOutput,
        promptTokens: 10,
        completionTokens: 20,
        totalTokens: 30,
      };
      const ai = {
        createStandaloneJob: jest.fn().mockResolvedValue({
          id: 'job-id',
          status,
          promptVersionId: 'prompt-id',
          promptVersion: {
            version: WORKOUT_PLANNING_V2_PROMPT.version,
            name: WORKOUT_PLANNING_V2_PROMPT.name,
          },
          result: status === AIJobStatus.COMPLETED ? storedResult : null,
        }),
        runTextJob: jest.fn().mockResolvedValue(response),
        failJob: jest.fn(),
      };
      const result = await (
        await engineWith(ai)
      ).generateCandidate({
        userId: 'user-id',
        decision: decision(),
        snapshot: snapshot(),
        recognizedContext: input,
        referenceDate,
      });
      const activity = result.output.sessions
        .flatMap((session) =>
          session.blocks.flatMap((block) => block.activities),
        )
        .find((item) => item.activityKey === 'FRIDAY_STRENGTH_3');
      expect(activity).toMatchObject({
        kind: 'TIMED',
        durationSeconds: 340,
        workSeconds: 40,
        recoverySeconds: 60,
        rounds: 4,
      });
      expect(result.output.validation.status).not.toBe('INVALID');
      expect(
        result.output.validation.issues.some(
          (issue) => issue.code === 'TIMED_DURATION_IMPOSSIBLE',
        ),
      ).toBe(false);
      expect(result.storedResult).toMatchObject(storedResult);
      expect(result.output.generationMetadata).toMatchObject({
        engineVersion: 2,
        promptVersionId: 'prompt-id',
        reused: status === AIJobStatus.COMPLETED,
      });
      expect(result.output.schemaVersion).toBe(2);
      expect(result.status).toBe(
        status === AIJobStatus.COMPLETED
          ? 'ALREADY_COMPLETED'
          : 'PENDING_COMPLETION',
      );
      expect(ai.runTextJob).toHaveBeenCalledTimes(
        status === AIJobStatus.COMPLETED ? 0 : 1,
      );
      expect(ai.failJob).not.toHaveBeenCalled();
      if (result.status === 'PENDING_COMPLETION') {
        expect(result.completion.response.outputText).toBe(rawOutput);
        expect(result.completion.result).toMatchObject(storedResult);
      }
      expect(
        raw.sessions[4].blocks
          .flatMap((block) => block.activities)
          .find((item) => item.activityKey === 'FRIDAY_STRENGTH_3'),
      ).toMatchObject({ durationSeconds: 40 });
    },
  );

  it('preserves the exact rejected provider candidate without persisting or archiving an ACTIVE plan', async () => {
    const input = recognized('HOME_WORKOUT', ['BODYWEIGHT']);
    const base = candidate(input);
    const invalid = {
      ...base,
      sessions: base.sessions.map((session, index) =>
        index !== 0
          ? session
          : {
              ...session,
              blocks: session.blocks.map((block, blockIndex) =>
                blockIndex !== 0
                  ? block
                  : {
                      ...block,
                      activities: [
                        {
                          ...block.activities[0],
                          activityKey: 'incident',
                          name: 'equipamento indisponível',
                          kind: 'TIMED' as const,
                          rounds: 5,
                          workSeconds: 60,
                          recoverySeconds: 30,
                          durationSeconds: 300,
                        },
                      ],
                    },
              ),
            },
      ),
    };
    const response = {
      responseId: 'provider-response',
      model: 'model',
      outputText: `  ${JSON.stringify(invalid)}\n`,
      promptTokens: 10,
      completionTokens: 20,
      totalTokens: 30,
    };
    const aiService = {
      createStandaloneJob: jest.fn().mockResolvedValue({
        id: 'job-id',
        status: AIJobStatus.PENDING,
        promptVersionId: 'prompt-id',
        promptVersion: {
          version: WORKOUT_PLANNING_V2_PROMPT.version,
          name: WORKOUT_PLANNING_V2_PROMPT.name,
        },
        result: null,
      }),
      runTextJob: jest.fn().mockResolvedValue(response),
      completeJobInTransaction: jest.fn(),
      failJob: jest.fn().mockResolvedValue(undefined),
    };
    const engine = await engineWith(aiService);
    const persistence = { persist: jest.fn() };
    const executor = new WorkoutApplicationExecutorService(
      engine,
      persistence as unknown as WorkoutPlanV2PersistenceService,
    );
    await expect(
      executor.execute({
        generationInput: {
          userId: 'user-id',
          decision: decision(),
          snapshot: snapshot(),
          recognizedContext: input,
          referenceDate,
        },
        ownership: { userId: 'user-id', profileId: 'profile-id' },
        executionContext: { correlationId: 'correlation-id' },
      }),
    ).rejects.toBeInstanceOf(WorkoutPostGenerationValidationError);
    expect(aiService.runTextJob).toHaveBeenCalledTimes(1);
    expect(aiService.failJob).toHaveBeenCalledTimes(1);
    expect(aiService.failJob).toHaveBeenCalledWith(
      'job-id',
      expect.any(WorkoutPostGenerationValidationError),
      response,
      undefined,
      {
        candidateOutput: response.outputText,
        model: response.model,
        executionAudit: expect.objectContaining({
          providerCalls: 1,
          repairAttempted: false,
        }),
        rejection: {
          stage: 'POST_GENERATION_VALIDATION',
          issues: expect.arrayContaining([
            {
              code: 'ACTIVITY_NAME_INVALID',
              severity: 'ERROR',
              path: 'incident',
            },
          ]),
        },
      },
    );
    expect(persistence.persist).not.toHaveBeenCalled();
    expect(aiService.completeJobInTransaction).not.toHaveBeenCalled();
  });

  it('never reuses a FAILED job even when it carries a parseable diagnostic candidate', async () => {
    const input = recognized('HOME_WORKOUT', ['BODYWEIGHT']);
    const aiService = {
      createStandaloneJob: jest.fn().mockResolvedValue({
        id: 'failed-job',
        promptVersion: {
          version: WORKOUT_PLANNING_V2_PROMPT.version,
          name: WORKOUT_PLANNING_V2_PROMPT.name,
        },
        status: AIJobStatus.FAILED,
        result: {
          candidateOutput: JSON.stringify(candidate(input)),
          model: 'model',
          rejection: { stage: 'POST_GENERATION_VALIDATION', issues: [] },
        },
      }),
      runTextJob: jest.fn(),
      failJob: jest.fn(),
    };
    await expect(
      (await engineWith(aiService)).generateCandidate({
        userId: 'user-id',
        decision: decision(),
        snapshot: snapshot(),
        recognizedContext: input,
        referenceDate,
      }),
    ).rejects.toThrow('já falhou');
    expect(aiService.runTextJob).not.toHaveBeenCalled();
    expect(aiService.failJob).not.toHaveBeenCalled();
  });

  it('fails the Workout AIJob when fresh candidate generation fails', async () => {
    const providerError = new BadGatewayException('provider unavailable');
    const aiService = {
      createStandaloneJob: jest.fn().mockResolvedValue({
        id: 'job-id',
        status: AIJobStatus.PENDING,
        promptVersionId: 'prompt-id',
        promptVersion: {
          version: WORKOUT_PLANNING_V2_PROMPT.version,
          name: WORKOUT_PLANNING_V2_PROMPT.name,
        },
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
      undefined,
      {
        executionAudit: expect.objectContaining({
          finalOutcome: 'FAILED',
          providerCalls: 1,
          repairAttempted: false,
        }),
      },
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

    expect(beginner.requiredBlocks).toEqual([]);
    expect(beginner.technicalMovementsAllowed).toBe(false);
    expect(intermediate.technicalMovementsAllowed).toBe(false);
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

    expect(strategy.requiredBlocks).toEqual([]);
    expect(strategy.intensityPolicy.scale).toBe('QUALITATIVE');
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

      expect(strategy.requiredBlocks).toEqual([]);
      expect(strategy.requiredBlocks).not.toContain('STRENGTH');
      expect(strategy.requiredBlocks).not.toContain('HYPERTROPHY');
      expect(strategy.authorizedEquipment).toEqual(['BODYWEIGHT']);
    },
  );

  it('publishes the strict V9 contract and AI technical authority', () => {
    expect(WORKOUT_PLANNING_V2_PROMPT_V9).toMatchObject({
      name: 'workout_planning_v2_v9',
      version: 9,
      capability: 'WORKOUT_PLANNING_V2',
    });
    expect(WORKOUT_PLANNING_V2_PROMPT_V9.instructions).toContain(
      'Você é o responsável técnico',
    );
    expect(WORKOUT_PLANNING_V2_PROMPT_V9.instructions).toContain(
      'currentRequest.text',
    );
    expect(WORKOUT_PLANNING_V2_PROMPT_V9.instructions).toContain(
      'não um treino previamente decidido',
    );
    const schema = WORKOUT_PLANNING_V2_PROMPT_V9.schema.schema as {
      properties: {
        sessions: {
          items: {
            properties: {
              blocks: {
                items: {
                  properties: { activities: { items: { anyOf: unknown[] } } };
                };
              };
            };
          };
        };
      };
    };
    expect(
      schema.properties.sessions.items.properties.blocks.items.properties
        .activities.items.anyOf,
    ).toHaveLength(4);
  });

  it.each([3, 4, 5, 6])(
    'preserves %i sessions while leaving gym composition to the model',
    (frequency) => {
      const strategy = new WorkoutPlanningStrategyService().build(
        context(
          recognized('GYM_STRENGTH', ['BODYWEIGHT'], {
            frequency,
            objective: 'HYPERTROPHY',
            environment: 'FULL_GYM',
          }),
        ),
      );
      expect(strategy.sessionCount).toBe(frequency);
      expect(strategy.sessionFocuses).toEqual([]);
      expect(strategy.requiredBlocks).toEqual([]);
      expect(strategy.recoveryGuidance).toBe('');
    },
  );

  it('passes gym objective and experience without choosing the split', () => {
    const strategy = new WorkoutPlanningStrategyService();
    const beginnerHypertrophy = strategy.build(
      context(
        recognized('GYM_STRENGTH', ['BARBELL', 'DUMBBELL'], {
          frequency: 5,
          objective: 'HYPERTROPHY',
          experience: 'BEGINNER',
          environment: 'FULL_GYM',
        }),
      ),
    );
    const advancedStrength = strategy.build(
      context(
        recognized('GYM_STRENGTH', ['BARBELL', 'DUMBBELL'], {
          frequency: 5,
          objective: 'STRENGTH',
          experience: 'ADVANCED',
          environment: 'FULL_GYM',
        }),
      ),
    );
    const advancedHypertrophy = strategy.build(
      context(
        recognized('GYM_STRENGTH', ['BARBELL', 'DUMBBELL'], {
          frequency: 5,
          objective: 'HYPERTROPHY',
          experience: 'ADVANCED',
          environment: 'FULL_GYM',
        }),
      ),
    );

    expect(beginnerHypertrophy.experience).toMatchObject({ value: 'BEGINNER' });
    expect(advancedStrength.objective).toMatchObject({ value: 'STRENGTH' });
    expect(advancedHypertrophy.objective).toMatchObject({
      value: 'HYPERTROPHY',
    });
    for (const envelope of [
      beginnerHypertrophy,
      advancedStrength,
      advancedHypertrophy,
    ]) {
      expect(envelope.sessionFocuses).toEqual([]);
      expect(envelope.sessionCount).toBe(5);
    }
  });

  it.each(['GLUTES', 'CHEST'] as const)(
    'preserves %s preference without predetermining the split',
    (focus) => {
      const strategy = new WorkoutPlanningStrategyService().build(
        context(
          recognized('GYM_STRENGTH', ['BARBELL', 'DUMBBELL'], {
            frequency: 5,
            objective: 'HYPERTROPHY',
            experience: 'INTERMEDIATE',
            muscleFocus: [focus],
            environment: 'FULL_GYM',
          }),
        ),
      );
      expect(strategy.muscleFocus).toEqual([focus]);
      expect(strategy.sessionFocuses).toEqual([]);
    },
  );

  it('passes return context without predetermining distribution', () => {
    const base = context(
      recognized('GYM_STRENGTH', ['BARBELL'], {
        frequency: 5,
        objective: 'STRENGTH',
        experience: 'ADVANCED',
      }),
    );
    const returning: WorkoutPlanningContext = Object.freeze({
      ...base,
      training: Object.freeze({
        ...base.training,
        returningAfterBreak: Object.freeze({
          status: 'CONFIRMED',
          value: true,
        }),
      }),
    });
    const service = new WorkoutPlanningStrategyService();

    expect(returning.training.returningAfterBreak).toMatchObject({
      value: true,
    });
    expect(service.build(returning).sessionFocuses).toEqual([]);
    expect(service.build(base).sessionFocuses).toEqual([]);
  });

  it('differentiates CrossFit readiness at the same frequency', () => {
    const service = new WorkoutPlanningStrategyService();
    const beginner = service.build(
      context(
        recognized('CROSSFIT', ['BARBELL'], {
          frequency: 4,
          experience: 'BEGINNER',
          conditioning: 'LOW',
          environment: 'CROSSFIT_BOX',
        }),
      ),
    );
    const advanced = service.build(
      context(
        recognized('CROSSFIT', ['BARBELL'], {
          frequency: 4,
          experience: 'ADVANCED',
          conditioning: 'HIGH',
          environment: 'CROSSFIT_BOX',
        }),
      ),
    );

    expect(beginner.technicalMovementsAllowed).toBe(false);
    expect(advanced.technicalMovementsAllowed).toBe(true);
    expect(beginner.sessionFocuses).toEqual([]);
    expect(advanced.sessionFocuses).toEqual([]);
  });

  it('differentiates beginner and experienced running strategies', () => {
    const service = new WorkoutPlanningStrategyService();
    const beginner = service.build(
      context(
        recognized('RUNNING', ['BODYWEIGHT'], {
          frequency: 4,
          experience: 'BEGINNER',
          conditioning: 'LOW',
          objective: 'CONDITIONING',
          environment: 'STREET',
        }),
      ),
    );
    const experienced = service.build(
      context(
        recognized('RUNNING', ['BODYWEIGHT'], {
          frequency: 4,
          experience: 'ADVANCED',
          conditioning: 'HIGH',
          objective: 'COMPLETE_DISTANCE',
          currentRunningDistanceKm: 10,
          targetDistanceKm: 21,
          environment: 'STREET',
        }),
      ),
    );

    expect(beginner.experience).toMatchObject({ value: 'BEGINNER' });
    expect(experienced.experience).toMatchObject({ value: 'ADVANCED' });
    expect(beginner.sessionFocuses).toEqual([]);
    expect(experienced.sessionFocuses).toEqual([]);
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
