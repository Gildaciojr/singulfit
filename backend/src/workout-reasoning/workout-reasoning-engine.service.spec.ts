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
  type CoachProfileConstraint,
  type CoachProfileDatum,
  type CoachProfileSnapshot,
} from '../context/coach-profile-snapshot.contract';
import {
  CONVERSATION_GOAL,
  CONVERSATION_RECOGNIZED_INTENT,
  type ConversationGoalDecision,
} from '../context/conversation-goal-planner.contract';
import { WorkoutKnowledgeResolverService } from '../workout-knowledge/workout-knowledge-resolver.service';
import {
  WORKOUT_KNOWLEDGE_PACKAGE_ID as P,
  type WorkoutKnowledgeResolution,
} from '../workout-knowledge/workout-knowledge.contract';
import {
  WORKOUT_ARTIFACT_TYPE,
  WORKOUT_MODALITY,
  type WorkoutArtifactType,
  type WorkoutModality,
} from '../workout/v2/workout-planning-artifact.contract';
import { WorkoutReasoningEngineService } from './workout-reasoning-engine.service';
import {
  WORKOUT_REASONING_CONFLICT as C,
  WORKOUT_REASONING_OBJECTIVE as O,
  WORKOUT_REASONING_PROHIBITION as X,
  WORKOUT_REASONING_STRATEGY as S,
  type WorkoutProgressionDecision,
  type WorkoutReasoningProhibition,
  type WorkoutReasoningResult,
  type WorkoutReasoningStrategy,
} from './workout-reasoning.contract';

describe('WorkoutReasoningEngineService', () => {
  interface SnapshotOptions {
    readonly goal?: FitnessGoal;
    readonly desiredOutcome?: string;
    readonly modality?: string;
    readonly experience?: string;
    readonly experienceStatus?: 'KNOWN' | 'REQUIRES_CONFIRMATION';
    readonly experienceConflict?: boolean;
    readonly environment?: string;
    readonly equipment?: readonly string[];
    readonly weeklyFrequency?: number;
    readonly sessionDurationMinutes?: number;
    readonly intensityPreference?: string;
    readonly perceivedConditioning?: string;
    readonly returningAfterBreak?: boolean;
    readonly limitations?: readonly string[];
    readonly limitationStatus?: 'KNOWN' | 'REQUIRES_CONFIRMATION';
    readonly medicalConditions?: readonly string[];
    readonly adherenceScore?: number;
    readonly motivationContext?: boolean;
  }

  const knowledgeResolver = new WorkoutKnowledgeResolverService();
  const engine = new WorkoutReasoningEngineService();

  function known<T>(value: T): CoachProfileDatum<T> {
    return available(value, 'KNOWN');
  }

  function available<T>(
    value: T,
    status: 'KNOWN' | 'REQUIRES_CONFIRMATION',
  ): CoachProfileDatum<T> {
    return Object.freeze({
      status,
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
    const limitationValues = Object.freeze(
      (options.limitations ?? []).map(constraint),
    );
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
        desiredOutcome: optionalKnown(options.desiredOutcome),
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
        experienceLevel:
          options.experience === undefined
            ? unknown<string>()
            : available(
                options.experience,
                options.experienceStatus ?? 'KNOWN',
              ),
        preferredModality: optionalKnown(options.modality),
        weeklyFrequency: optionalKnown(options.weeklyFrequency),
        sessionDurationMinutes: optionalKnown(options.sessionDurationMinutes),
        environment: optionalKnown(options.environment),
        availableEquipment:
          options.equipment === undefined
            ? unknown<readonly string[]>()
            : known(Object.freeze([...options.equipment])),
        perceivedConditioning: optionalKnown(options.perceivedConditioning),
        intensityPreference: optionalKnown(options.intensityPreference),
        cardioAvailability: unknown<boolean>(),
        trainingFormatPreference: unknown<string>(),
        returningAfterBreak: optionalKnown(options.returningAfterBreak),
      }),
      routine: Object.freeze({
        wakeUpTime: known('07:00'),
        sleepTime: known('23:00'),
        trainingTime: known('18:30'),
        mealTimes: known(Object.freeze(['08:00', '13:00', '20:00'])),
        availableTrainingDays: unknown<readonly string[]>(),
        dailyTrainingWindows: unknown<readonly string[]>(),
      }),
      restrictions: Object.freeze({
        foodRestrictions: known(Object.freeze([])),
        allergies: known(Object.freeze([])),
        medicalConditions: known(
          Object.freeze((options.medicalConditions ?? []).map(constraint)),
        ),
        physicalLimitations:
          options.limitationStatus === 'REQUIRES_CONFIRMATION'
            ? available(limitationValues, 'REQUIRES_CONFIRMATION')
            : known(limitationValues),
      }),
      preferences: Object.freeze({ foodPreferences: known(Object.freeze([])) }),
      longitudinal: Object.freeze({
        adherenceScore: optionalKnown(options.adherenceScore),
        latestProgressWeightKg: unknown<number>(),
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
        behavioralStage: options.motivationContext
          ? known(StageOfChange.ACTION)
          : unknown(),
        classifiedGoal: unknown(),
        memorySummaries: unknown<readonly string[]>(),
      }),
      completion: Object.freeze({
        overall: 'PARTIAL',
        sections: Object.freeze([]),
      }),
      conflicts: options.experienceConflict
        ? Object.freeze([
            Object.freeze({
              field: 'TRAINING_EXPERIENCE',
              preferredSource: COACH_PROFILE_DATA_SOURCE.USER,
              conflictingSource: COACH_PROFILE_DATA_SOURCE.FITNESS_PROFILE,
              preferredValue: 'BEGINNER',
              conflictingValue: 'ADVANCED',
            }),
          ])
        : Object.freeze([]),
      referenceDate: '2026-07-16T12:00:00.000Z',
    });
  }

  function goalDecision(): ConversationGoalDecision {
    return Object.freeze({
      recognizedIntent: CONVERSATION_RECOGNIZED_INTENT.WORKOUT_PLAN_REQUEST,
      goal: CONVERSATION_GOAL.GENERATE_WORKOUT_PLAN,
      reason: 'WORKOUT_PROFILE_READY',
      targetPlan: 'WORKOUT',
      profileCompletionState: 'PARTIAL',
      canExecute: true,
      confidence: 'HIGH',
      selectedProfileField: null,
      metPreconditions: Object.freeze([]),
      missingPreconditions: Object.freeze([]),
      pendingDependencies: Object.freeze([]),
    });
  }

  function reason(
    options: SnapshotOptions,
    artifactType: WorkoutArtifactType = WORKOUT_ARTIFACT_TYPE.WEEKLY_PLAN,
    recognizedModality: WorkoutModality | null = WORKOUT_MODALITY.GYM_STRENGTH,
  ): WorkoutReasoningResult {
    const profile = snapshot(options);
    return engine.reason({
      snapshot: profile,
      knowledgeResolution: knowledgeResolver.resolve(profile),
      conversationGoal: goalDecision(),
      artifactType,
      recognizedModality,
    });
  }

  function strategies(
    result: WorkoutReasoningResult,
  ): readonly WorkoutReasoningStrategy[] {
    return result.selectedStrategies.map((item) => item.strategy);
  }

  function prohibitions(
    result: WorkoutReasoningResult,
  ): readonly WorkoutReasoningProhibition[] {
    return result.prohibitedStrategies.map((item) => item.prohibition);
  }

  it('prioriza hipertrofia para iniciante com baixa complexidade', () => {
    const result = reason({
      goal: FitnessGoal.MUSCLE_GAIN,
      modality: 'musculação',
      experience: 'BEGINNER',
      environment: 'FULL_GYM',
      equipment: ['BARBELL', 'DUMBBELL'],
      weeklyFrequency: 3,
      sessionDurationMinutes: 60,
    });
    expect(result.primaryObjective).toBe(O.HYPERTROPHY);
    expect(result.metadata.experience).toBe('BEGINNER');
    expect(result.authorizedComplexity).toBe('SIMPLE');
    expect(result.interventionIntensity).toBe('LOW');
    expect(strategies(result)).toEqual(
      expect.arrayContaining([
        S.HYPERTROPHY,
        S.TECHNIQUE_PRIORITY,
        S.CONSERVATIVE_PROGRESSION,
      ]),
    );
    expect(prohibitions(result)).toContain(X.ADVANCED_MOVEMENTS_FOR_BEGINNER);
  });

  it('diferencia hipertrofia intermediária e objetivo secundário', () => {
    const result = reason({
      goal: FitnessGoal.MUSCLE_GAIN,
      desiredOutcome: 'condicionamento',
      modality: 'musculação',
      experience: 'INTERMEDIATE',
      environment: 'FULL_GYM',
      equipment: ['BARBELL'],
      weeklyFrequency: 4,
      sessionDurationMinutes: 60,
      adherenceScore: 0.9,
    });
    expect(result.primaryObjective).toBe(O.CONDITIONING);
    expect(result.secondaryObjectives).toContain(O.HYPERTROPHY);
    expect(result.interventionIntensity).toBe('MODERATE');
    expect(result.progressionDecision).toBe('PROGRESS');
    expect(result.priorities.hypertrophy).toBe('HIGH');
  });

  it('resolve força iniciante e força intermediária', () => {
    const beginner = reason({
      desiredOutcome: 'força',
      modality: 'musculação',
      experience: 'BEGINNER',
      environment: 'FULL_GYM',
      equipment: ['BARBELL'],
    });
    expect(beginner.primaryObjective).toBe(O.STRENGTH);
    expect(beginner.priorities.strength).toBe('HIGH');
    expect(beginner.resolvedConflicts.map((item) => item.conflict)).toContain(
      C.STRENGTH_BEGINNER,
    );
    expect(prohibitions(beginner)).toEqual(
      expect.arrayContaining([X.INVENTED_1RM, X.AGGRESSIVE_PROGRESSION]),
    );

    const intermediate = reason({
      desiredOutcome: 'força',
      modality: 'musculação',
      experience: 'INTERMEDIATE',
      environment: 'FULL_GYM',
      equipment: ['BARBELL'],
    });
    expect(intermediate.primaryObjective).toBe(O.STRENGTH);
    expect(
      intermediate.resolvedConflicts.map((item) => item.conflict),
    ).not.toContain(C.STRENGTH_BEGINNER);
  });

  it('resolve resistência muscular, manutenção e condicionamento', () => {
    expect(
      reason({
        desiredOutcome: 'resistência muscular',
        modality: 'musculação',
        experience: 'INTERMEDIATE',
      }).primaryObjective,
    ).toBe(O.MUSCULAR_ENDURANCE);
    expect(
      reason(
        {
          goal: FitnessGoal.MAINTENANCE,
          modality: 'fitness geral',
          experience: 'INTERMEDIATE',
        },
        WORKOUT_ARTIFACT_TYPE.SINGLE_SESSION,
        WORKOUT_MODALITY.GENERAL_FITNESS,
      ).primaryObjective,
    ).toBe(O.MAINTENANCE);
    expect(
      reason(
        {
          desiredOutcome: 'condicionamento cardiovascular',
          modality: 'cardio',
          experience: 'INTERMEDIATE',
        },
        WORKOUT_ARTIFACT_TYPE.WEEKLY_PLAN,
        WORKOUT_MODALITY.CARDIO_CONDITIONING,
      ).primaryObjective,
    ).toBe(O.CONDITIONING);
  });

  it('reduz complexidade para experiência desconhecida e reavalia conflito', () => {
    const unknownExperience = reason({ modality: 'musculação' });
    expect(unknownExperience.metadata.experience).toBe('UNKNOWN');
    expect(unknownExperience.authorizedComplexity).toBe('SIMPLE');
    expect(unknownExperience.progressionDecision).toBe('REASSESS');

    const conflict = reason({
      modality: 'musculação',
      experience: 'BEGINNER',
      experienceConflict: true,
    });
    expect(conflict.metadata.experience).toBe('CONFLICT');
    expect(conflict.authorizedComplexity).toBe('RESTRICTED');
    expect(conflict.resolvedConflicts.map((item) => item.conflict)).toContain(
      C.EXPERIENCE_PROFILE_CONFLICT,
    );
  });

  it.each([
    [
      'academia completa',
      {
        modality: 'musculação',
        experience: 'INTERMEDIATE',
        environment: 'FULL_GYM',
        equipment: ['BARBELL', 'DUMBBELL'],
      },
      WORKOUT_MODALITY.GYM_STRENGTH,
      S.BASIC_MOVEMENTS,
    ],
    [
      'academia limitada',
      {
        modality: 'musculação',
        experience: 'INTERMEDIATE',
        environment: 'LIMITED_GYM',
        equipment: ['DUMBBELL'],
      },
      WORKOUT_MODALITY.GYM_STRENGTH,
      S.EQUIPMENT_COMPATIBILITY,
    ],
    [
      'casa sem equipamento',
      {
        modality: 'treino em casa',
        experience: 'BEGINNER',
        environment: 'HOME',
        equipment: [],
      },
      WORKOUT_MODALITY.HOME_WORKOUT,
      S.BODYWEIGHT,
    ],
    [
      'casa com equipamento',
      {
        modality: 'treino em casa',
        experience: 'INTERMEDIATE',
        environment: 'HOME',
        equipment: ['RESISTANCE_BAND'],
      },
      WORKOUT_MODALITY.HOME_WORKOUT,
      S.SPACE_COMPATIBILITY,
    ],
    [
      'calistenia',
      {
        modality: 'calistenia',
        experience: 'INTERMEDIATE',
        environment: 'STREET',
        equipment: ['PULL_UP_BAR'],
      },
      WORKOUT_MODALITY.CALISTHENICS,
      S.MOVEMENT_REGRESSIONS,
    ],
    [
      'funcional',
      {
        modality: 'funcional',
        experience: 'INTERMEDIATE',
        environment: 'FULL_GYM',
        equipment: ['DUMBBELL'],
      },
      WORKOUT_MODALITY.FUNCTIONAL,
      S.TECHNIQUE_BEFORE_INTENSITY,
    ],
    [
      'caminhada',
      { modality: 'caminhada', experience: 'BEGINNER', environment: 'OUTDOOR' },
      WORKOUT_MODALITY.WALKING,
      S.LIGHT_ENDURANCE,
    ],
    [
      'mobilidade',
      {
        modality: 'mobilidade',
        experience: 'BEGINNER',
        environment: 'HOME',
        equipment: [],
      },
      WORKOUT_MODALITY.MOBILITY,
      S.REQUIRED_MOBILITY,
    ],
    [
      'recuperação ativa',
      {
        modality: 'recuperação ativa',
        experience: 'INTERMEDIATE',
        environment: 'HOME',
        equipment: [],
      },
      WORKOUT_MODALITY.ACTIVE_RECOVERY,
      S.ACTIVE_RECOVERY,
    ],
    [
      'ao ar livre',
      {
        modality: 'ao ar livre',
        experience: 'INTERMEDIATE',
        environment: 'OUTDOOR',
      },
      WORKOUT_MODALITY.OUTDOOR_WORKOUT,
      S.SUSTAINABLE_FREQUENCY,
    ],
    [
      'fitness geral',
      { modality: 'fitness geral', experience: 'INTERMEDIATE' },
      WORKOUT_MODALITY.GENERAL_FITNESS,
      S.TRAINING_EDUCATION,
    ],
  ] satisfies readonly (readonly [
    string,
    SnapshotOptions,
    WorkoutModality,
    WorkoutReasoningStrategy,
  ])[])(
    'trata modalidade %s',
    (_label, options, modality, expectedStrategy) => {
      const result = reason(
        options,
        WORKOUT_ARTIFACT_TYPE.SINGLE_SESSION,
        modality,
      );
      expect(result.modality.resolved).toBe(modality);
      expect(result.modality.status).toBe('CONFIRMED');
      expect(strategies(result)).toContain(expectedStrategy);
    },
  );

  it('trata CrossFit iniciante e experiente sem equiparar experiência a intensidade', () => {
    const beginner = reason(
      {
        modality: 'CrossFit',
        experience: 'BEGINNER',
        environment: 'CROSSFIT_BOX',
        equipment: ['BARBELL'],
      },
      WORKOUT_ARTIFACT_TYPE.WEEKLY_PLAN,
      WORKOUT_MODALITY.CROSSFIT,
    );
    expect(beginner.resolvedConflicts.map((item) => item.conflict)).toContain(
      C.CROSSFIT_BEGINNER,
    );
    expect(strategies(beginner)).toEqual(
      expect.arrayContaining([S.REQUIRED_SCALING, S.SIMPLE_MOVEMENTS]),
    );
    expect(prohibitions(beginner)).toContain(
      X.ADVANCED_CROSSFIT_WITHOUT_EXPERIENCE,
    );

    const advanced = reason(
      {
        modality: 'CrossFit',
        experience: 'ADVANCED',
        environment: 'CROSSFIT_BOX',
        equipment: ['BARBELL'],
        adherenceScore: 0.9,
      },
      WORKOUT_ARTIFACT_TYPE.WEEKLY_PLAN,
      WORKOUT_MODALITY.CROSSFIT,
    );
    expect(
      advanced.resolvedConflicts.map((item) => item.conflict),
    ).not.toContain(C.CROSSFIT_BEGINNER);
    expect(advanced.interventionIntensity).toBe('MODERATE_HIGH');
  });

  it('autoriza intensidade alta somente com experiência, preferência e aderência confirmadas', () => {
    const result = reason({
      modality: 'musculação',
      experience: 'ADVANCED',
      intensityPreference: 'HIGH',
      adherenceScore: 0.9,
      environment: 'FULL_GYM',
      equipment: ['BARBELL'],
    });
    expect(result.interventionIntensity).toBe('HIGH');
  });

  it('produz todas as faixas relevantes de complexidade sem gerar estrutura concreta', () => {
    expect(
      reason(
        { modality: 'fitness geral', experience: 'INTERMEDIATE' },
        WORKOUT_ARTIFACT_TYPE.POINT_GUIDANCE,
        WORKOUT_MODALITY.GENERAL_FITNESS,
      ).authorizedComplexity,
    ).toBe('MINIMAL');
    expect(
      reason(
        { modality: 'fitness geral', experience: 'INTERMEDIATE' },
        WORKOUT_ARTIFACT_TYPE.PLAN_REVIEW,
        WORKOUT_MODALITY.GENERAL_FITNESS,
      ).authorizedComplexity,
    ).toBe('STANDARD');
    expect(
      reason(
        { modality: 'fitness geral', experience: 'INTERMEDIATE' },
        WORKOUT_ARTIFACT_TYPE.WEEKLY_PLAN,
        WORKOUT_MODALITY.GENERAL_FITNESS,
      ).authorizedComplexity,
    ).toBe('DETAILED');
    expect(
      reason(
        {
          modality: 'CrossFit',
          experience: 'ADVANCED',
          environment: 'CROSSFIT_BOX',
        },
        WORKOUT_ARTIFACT_TYPE.WEEKLY_PLAN,
        WORKOUT_MODALITY.CROSSFIT,
      ).authorizedComplexity,
    ).toBe('ADVANCED');
  });

  it('trata corrida iniciante, intermediária, retorno e pouco tempo', () => {
    const beginner = reason(
      { modality: 'corrida', experience: 'BEGINNER', environment: 'OUTDOOR' },
      WORKOUT_ARTIFACT_TYPE.WEEKLY_PLAN,
      WORKOUT_MODALITY.RUNNING,
    );
    expect(strategies(beginner)).toContain(S.GRADUAL_RUNNING_ADAPTATION);
    expect(prohibitions(beginner)).toContain(X.ADVANCED_RUNNING_WITHOUT_BASE);
    expect(beginner.priorities.endurance).toBe('HIGH');

    const intermediate = reason(
      {
        desiredOutcome: 'endurance',
        modality: 'corrida',
        experience: 'INTERMEDIATE',
        environment: 'OUTDOOR',
        adherenceScore: 0.9,
      },
      WORKOUT_ARTIFACT_TYPE.WEEKLY_PLAN,
      WORKOUT_MODALITY.RUNNING,
    );
    expect(intermediate.progressionDecision).toBe('PROGRESS');

    const returning = reason(
      {
        modality: 'corrida',
        experience: 'INTERMEDIATE',
        environment: 'OUTDOOR',
        returningAfterBreak: true,
      },
      WORKOUT_ARTIFACT_TYPE.WEEKLY_PLAN,
      WORKOUT_MODALITY.RUNNING,
    );
    expect(returning.progressionDecision).toBe('REGRESS');
    expect(returning.resolvedConflicts.map((item) => item.conflict)).toContain(
      C.RUNNING_RETURN_AFTER_BREAK,
    );
    expect(prohibitions(returning)).toEqual(
      expect.arrayContaining([
        X.INTENSE_INTERVALS_AFTER_BREAK,
        X.ABRUPT_DISTANCE_INCREASE,
      ]),
    );

    const limited = reason(
      {
        modality: 'corrida',
        experience: 'INTERMEDIATE',
        environment: 'OUTDOOR',
        sessionDurationMinutes: 25,
      },
      WORKOUT_ARTIFACT_TYPE.WEEKLY_PLAN,
      WORKOUT_MODALITY.RUNNING,
    );
    expect(limited.resolvedConflicts.map((item) => item.conflict)).toContain(
      C.RUNNING_LIMITED_TIME,
    );
  });

  it('trata ciclismo sem métricas por esforço percebido', () => {
    const result = reason(
      {
        modality: 'ciclismo',
        experience: 'INTERMEDIATE',
        environment: 'OUTDOOR_BIKE',
        equipment: ['BIKE'],
      },
      WORKOUT_ARTIFACT_TYPE.WEEKLY_PLAN,
      WORKOUT_MODALITY.CYCLING,
    );
    expect(result.resolvedConflicts.map((item) => item.conflict)).toContain(
      C.CYCLING_WITHOUT_METRICS,
    );
    expect(strategies(result)).toContain(S.PERCEIVED_INTENSITY);
    expect(prohibitions(result)).toEqual(
      expect.arrayContaining([
        X.INVENTED_FTP,
        X.INVENTED_POWER,
        X.PRECISE_ZONES_WITHOUT_DATA,
      ]),
    );
  });

  it('não inventa modalidade ausente e sinaliza modalidade conflitante', () => {
    const unknownModality = reason(
      { experience: 'INTERMEDIATE' },
      WORKOUT_ARTIFACT_TYPE.WEEKLY_PLAN,
      null,
    );
    expect(unknownModality.modality.resolved).toBeNull();
    expect(unknownModality.modality.status).toBe('UNKNOWN');
    expect(unknownModality.progressionDecision).toBe('REASSESS');

    const conflict = reason(
      { modality: 'corrida', experience: 'INTERMEDIATE' },
      WORKOUT_ARTIFACT_TYPE.WEEKLY_PLAN,
      WORKOUT_MODALITY.CYCLING,
    );
    expect(conflict.modality.resolved).toBe(WORKOUT_MODALITY.CYCLING);
    expect(conflict.modality.status).toBe('CONFLICT');
    expect(conflict.resolvedConflicts.map((item) => item.conflict)).toContain(
      C.MODALITY_PROFILE_MISMATCH,
    );
  });

  it('resolve hipertrofia com pouco tempo e casa sem equipamento', () => {
    const hypertrophy = reason({
      goal: FitnessGoal.MUSCLE_GAIN,
      modality: 'musculação',
      experience: 'INTERMEDIATE',
      sessionDurationMinutes: 25,
      environment: 'LIMITED_GYM',
      equipment: ['DUMBBELL'],
    });
    expect(
      hypertrophy.resolvedConflicts.map((item) => item.conflict),
    ).toContain(C.HYPERTROPHY_LIMITED_TIME);
    expect(strategies(hypertrophy)).toEqual(
      expect.arrayContaining([
        S.BASIC_MOVEMENTS,
        S.CONTROLLED_VOLUME,
        S.SUSTAINABLE_FREQUENCY,
      ]),
    );
    expect(prohibitions(hypertrophy)).toEqual(
      expect.arrayContaining([X.EXCESSIVE_ACCESSORIES, X.LONG_STRUCTURE]),
    );

    const home = reason(
      {
        modality: 'treino em casa',
        experience: 'BEGINNER',
        environment: 'HOME',
        equipment: [],
      },
      WORKOUT_ARTIFACT_TYPE.WEEKLY_PLAN,
      WORKOUT_MODALITY.HOME_WORKOUT,
    );
    expect(home.resolvedConflicts.map((item) => item.conflict)).toContain(
      C.HOME_WITHOUT_EQUIPMENT,
    );
    expect(prohibitions(home)).toContain(X.UNAVAILABLE_EQUIPMENT);
  });

  it('prioriza sustentabilidade diante de baixa aderência e plano complexo', () => {
    const result = reason({
      modality: 'musculação',
      experience: 'INTERMEDIATE',
      adherenceScore: 0.4,
      weeklyFrequency: 5,
      sessionDurationMinutes: 60,
    });
    expect(result.resolvedConflicts.map((item) => item.conflict)).toContain(
      C.LOW_ADHERENCE_COMPLEX_PLAN,
    );
    expect(result.priorities.adherence).toBe('CRITICAL');
    expect(result.priorities.practicality).toBe('CRITICAL');
    expect(strategies(result)).toEqual(
      expect.arrayContaining([
        S.LOW_FRICTION,
        S.SHORT_SESSIONS,
        S.REALISTIC_FREQUENCY,
      ]),
    );
  });

  it('faz segurança prevalecer sobre objetivo esportivo', () => {
    const result = reason({
      goal: FitnessGoal.MUSCLE_GAIN,
      modality: 'musculação',
      experience: 'INTERMEDIATE',
      limitations: ['limitação de joelho confirmada'],
    });
    expect(result.primaryObjective).toBe(O.SAFETY);
    expect(result.resolvedConflicts.map((item) => item.conflict)).toContain(
      C.SPORT_OBJECTIVE_PHYSICAL_LIMITATION,
    );
    expect(result.priorities.safety).toBe('CRITICAL');
    expect(result.progressionDecision).toBe('REGRESS');
  });

  it.each([
    [
      'MAINTAIN',
      { modality: 'fitness geral', experience: 'INTERMEDIATE' },
      WORKOUT_ARTIFACT_TYPE.POINT_GUIDANCE,
      WORKOUT_MODALITY.GENERAL_FITNESS,
    ],
    [
      'PROGRESS',
      {
        goal: FitnessGoal.MUSCLE_GAIN,
        modality: 'musculação',
        experience: 'INTERMEDIATE',
        adherenceScore: 0.9,
      },
      WORKOUT_ARTIFACT_TYPE.WEEKLY_PLAN,
      WORKOUT_MODALITY.GYM_STRENGTH,
    ],
    [
      'REGRESS',
      {
        modality: 'musculação',
        experience: 'INTERMEDIATE',
        returningAfterBreak: true,
      },
      WORKOUT_ARTIFACT_TYPE.WEEKLY_PLAN,
      WORKOUT_MODALITY.GYM_STRENGTH,
    ],
    [
      'DELOAD',
      {
        modality: 'musculação',
        experience: 'INTERMEDIATE',
        perceivedConditioning: 'fadiga importante',
      },
      WORKOUT_ARTIFACT_TYPE.WEEKLY_PLAN,
      WORKOUT_MODALITY.GYM_STRENGTH,
    ],
    [
      'REASSESS',
      { modality: 'musculação' },
      WORKOUT_ARTIFACT_TYPE.WEEKLY_PLAN,
      WORKOUT_MODALITY.GYM_STRENGTH,
    ],
    [
      'PAUSE',
      {
        modality: 'musculação',
        experience: 'INTERMEDIATE',
        medicalConditions: ['febre atual'],
      },
      WORKOUT_ARTIFACT_TYPE.WEEKLY_PLAN,
      WORKOUT_MODALITY.GYM_STRENGTH,
    ],
  ] satisfies readonly (readonly [
    WorkoutProgressionDecision,
    SnapshotOptions,
    WorkoutArtifactType,
    WorkoutModality,
  ])[])(
    'produz política de progressão %s sem executá-la',
    (expected, options, artifact, modality) => {
      const result = reason(options, artifact, modality);
      expect(result.progressionDecision).toBe(expected);
      expect(collectKeys(result)).not.toEqual(
        expect.arrayContaining([
          'plan',
          'sessions',
          'exercises',
          'progressionRules',
        ]),
      );
    },
  );

  it.each([
    [
      'febre',
      { medicalConditions: ['febre atual'] },
      'PAUSE',
      'BLOCKED',
      X.INTENSE_TRAINING_WITH_FEVER,
    ],
    [
      'dor aguda',
      { limitations: ['dor aguda no joelho'] },
      'REASSESS',
      'LOW',
      X.PAIN_AGGRAVATING_TRAINING,
    ],
    [
      'mal-estar',
      { perceivedConditioning: 'mal-estar importante' },
      'PAUSE',
      'BLOCKED',
      X.AGGRESSIVE_PROGRESSION,
    ],
    [
      'incapacidade',
      { limitations: ['incapaz de treinar'] },
      'PAUSE',
      'BLOCKED',
      X.AGGRESSIVE_PROGRESSION,
    ],
    [
      'lesão recente',
      { limitations: ['lesão recente'] },
      'REASSESS',
      'LOW',
      X.AGGRESSIVE_PROGRESSION,
    ],
    [
      'limitação não confirmada',
      {
        limitations: ['desconforto no ombro'],
        limitationStatus: 'REQUIRES_CONFIRMATION',
      },
      'REASSESS',
      'LOW',
      X.AGGRESSIVE_PROGRESSION,
    ],
    [
      'reabilitação solicitada',
      { limitations: ['quero reabilitação do joelho'] },
      'PAUSE',
      'BLOCKED',
      X.IMPROVISED_REHABILITATION,
    ],
    [
      'pedido extremo',
      { desiredOutcome: 'treinar no máximo todo dia sem descanso' },
      'PAUSE',
      'BLOCKED',
      X.AGGRESSIVE_PROGRESSION,
    ],
    [
      'recuperação insuficiente',
      { perceivedConditioning: 'recuperação insuficiente' },
      'DELOAD',
      'RECOVERY',
      X.AGGRESSIVE_PROGRESSION,
    ],
  ] satisfies readonly (readonly [
    string,
    SnapshotOptions,
    WorkoutProgressionDecision,
    WorkoutReasoningResult['interventionIntensity'],
    WorkoutReasoningProhibition,
  ])[])(
    'aplica segurança para %s',
    (_label, options, progression, intensity, expectedProhibition) => {
      const result = reason({
        modality: 'musculação',
        experience: 'INTERMEDIATE',
        ...options,
      });
      expect(result.progressionDecision).toBe(progression);
      expect(result.interventionIntensity).toBe(intensity);
      expect(prohibitions(result)).toContain(expectedProhibition);
      expect(result.priorities.safety).toBe('CRITICAL');
    },
  );

  it('trata volume e intensidade excessivos por conhecimento canônico', () => {
    const result = reason({
      modality: 'musculação',
      experience: 'BEGINNER',
      weeklyFrequency: 6,
      intensityPreference: 'HIGH',
    });
    expect(result.knowledgeDecisions.map((item) => item.packageId)).toEqual(
      expect.arrayContaining([P.VOLUME_CAUTION, P.INTENSITY_CAUTION]),
    );
    expect(result.interventionIntensity).toBe('LOW');
    expect(prohibitions(result)).toContain(X.HIGH_INTENSITY_WITHOUT_EXPERIENCE);
    expect(result.priorities.recovery).toBe('MEDIUM');
  });

  it('registra prioridades agregadas para técnica, educação, recuperação, equipamento e ambiente', () => {
    const result = reason(
      {
        modality: 'CrossFit',
        experience: 'BEGINNER',
        environment: 'HOME',
        equipment: [],
        adherenceScore: 0.4,
        perceivedConditioning: 'recuperação insuficiente',
      },
      WORKOUT_ARTIFACT_TYPE.WEEKLY_PLAN,
      WORKOUT_MODALITY.CROSSFIT,
    );
    expect(result.priorities).toMatchObject({
      safety: 'CRITICAL',
      technique: 'CRITICAL',
      adherence: 'CRITICAL',
      education: 'HIGH',
      recovery: 'CRITICAL',
      practicality: 'CRITICAL',
      equipment: 'CRITICAL',
      environment: 'CRITICAL',
    });
    expect(result.priorities.conditioning).toBe('HIGH');
    expect(result.resolvedConflicts.map((item) => item.conflict)).toContain(
      C.MODALITY_ENVIRONMENT_INCOMPATIBLE,
    );
    expect(result.progressionDecision).toBe('REASSESS');
  });

  it('registra motivação e educação sem transformar esses fatores em texto', () => {
    const result = reason(
      {
        modality: 'fitness geral',
        experience: 'BEGINNER',
        motivationContext: true,
      },
      WORKOUT_ARTIFACT_TYPE.SINGLE_SESSION,
      WORKOUT_MODALITY.GENERAL_FITNESS,
    );
    expect(result.knowledgeDecisions.map((item) => item.packageId)).toContain(
      P.MOTIVATION,
    );
    expect(result.priorities.motivation).toBe('HIGH');
    expect(result.priorities.education).toBe('HIGH');
    expect(strategies(result)).toContain(S.SUSTAINABLE_MOTIVATION);
  });

  it('aceita somente resolução canônica, sem duplicatas e com dependências presentes', () => {
    const profile = snapshot({
      goal: FitnessGoal.MUSCLE_GAIN,
      modality: 'musculação',
      experience: 'INTERMEDIATE',
    });
    const resolution = knowledgeResolver.resolve(profile);
    const invalidVersion = { ...resolution };
    Object.defineProperty(invalidVersion, 'catalogVersion', {
      value: 'invalid',
    });
    expect(() =>
      engine.reason({
        snapshot: profile,
        knowledgeResolution: invalidVersion,
        conversationGoal: goalDecision(),
        artifactType: WORKOUT_ARTIFACT_TYPE.WEEKLY_PLAN,
        recognizedModality: WORKOUT_MODALITY.GYM_STRENGTH,
      }),
    ).toThrow('Versão de conhecimento');

    const first = resolution.packages[0];
    const firstMatch = resolution.matchedFacts[0];
    const duplicated: WorkoutKnowledgeResolution = Object.freeze({
      ...resolution,
      packages: Object.freeze([first, first]),
      packageIds: Object.freeze([first.id, first.id]),
      matchedFacts: Object.freeze([firstMatch, firstMatch]),
    });
    expect(() =>
      engine.reason({
        snapshot: profile,
        knowledgeResolution: duplicated,
        conversationGoal: goalDecision(),
        artifactType: WORKOUT_ARTIFACT_TYPE.WEEKLY_PLAN,
        recognizedModality: WORKOUT_MODALITY.GYM_STRENGTH,
      }),
    ).toThrow('duplicado');

    const hypertrophy = resolution.packages.find(
      (item) => item.id === P.HYPERTROPHY,
    );
    expect(hypertrophy).toBeDefined();
    const withoutDependency: WorkoutKnowledgeResolution = Object.freeze({
      ...resolution,
      packages: Object.freeze(
        resolution.packages.filter((item) => item.id !== P.RESISTANCE_TRAINING),
      ),
      packageIds: Object.freeze(
        resolution.packageIds.filter((id) => id !== P.RESISTANCE_TRAINING),
      ),
      matchedFacts: Object.freeze(
        resolution.matchedFacts.filter(
          (item) => item.packageId !== P.RESISTANCE_TRAINING,
        ),
      ),
    });
    expect(() =>
      engine.reason({
        snapshot: profile,
        knowledgeResolution: withoutDependency,
        conversationGoal: goalDecision(),
        artifactType: WORKOUT_ARTIFACT_TYPE.WEEKLY_PLAN,
        recognizedModality: WORKOUT_MODALITY.GYM_STRENGTH,
      }),
    ).toThrow('Dependência ausente');
  });

  it('é determinístico, serializável e profundamente imutável sem alterar entradas', () => {
    const profile = snapshot({
      goal: FitnessGoal.MUSCLE_GAIN,
      modality: 'musculação',
      experience: 'INTERMEDIATE',
      environment: 'FULL_GYM',
      equipment: ['BARBELL'],
      adherenceScore: 0.9,
    });
    const knowledge = knowledgeResolver.resolve(profile);
    const input = Object.freeze({
      snapshot: profile,
      knowledgeResolution: knowledge,
      conversationGoal: goalDecision(),
      artifactType: WORKOUT_ARTIFACT_TYPE.WEEKLY_PLAN,
      recognizedModality: WORKOUT_MODALITY.GYM_STRENGTH,
    });
    const first = engine.reason(input);
    const second = engine.reason(input);
    expect(first).toEqual(second);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(JSON.parse(JSON.stringify(first))).toEqual(first);
    expectDeepFrozen(first);
    expectDeepFrozen(profile);
    expectDeepFrozen(knowledge);
    expect(Reflect.set(first.priorities, 'safety', 'LOW')).toBe(false);
    expect(input.snapshot).toBe(profile);
    expect(input.knowledgeResolution).toBe(knowledge);
  });

  it('não gera treino, sessão, exercício, texto de usuário ou infraestrutura externa', () => {
    const result = reason(
      {
        modality: 'corrida',
        experience: 'INTERMEDIATE',
        environment: 'OUTDOOR',
      },
      WORKOUT_ARTIFACT_TYPE.WEEKLY_PLAN,
      WORKOUT_MODALITY.RUNNING,
    );
    expect(collectKeys(result)).not.toEqual(
      expect.arrayContaining([
        'workoutPlan',
        'sessions',
        'exercises',
        'sets',
        'repetitions',
        'message',
        'text',
      ]),
    );
    const source = readFileSync(
      join(__dirname, 'workout-reasoning-engine.service.ts'),
      'utf8',
    );
    expect(source).not.toMatch(
      /AIService|PromptService|PrismaService|EventBus|Outbox|OpenAI|Date\.now|Math\.random/,
    );
    const moduleSource = readFileSync(
      join(__dirname, '..', 'workout', 'workout.module.ts'),
      'utf8',
    );
    expect(moduleSource).not.toContain('WorkoutReasoningEngineService');
  });
});

function expectDeepFrozen(value: unknown): void {
  if (typeof value !== 'object' || value === null) return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const nested of Object.values(value)) expectDeepFrozen(nested);
}

function collectKeys(value: unknown): readonly string[] {
  if (typeof value !== 'object' || value === null) return Object.freeze([]);
  return Object.freeze([
    ...Object.keys(value),
    ...Object.values(value).flatMap((nested) => collectKeys(nested)),
  ]);
}
