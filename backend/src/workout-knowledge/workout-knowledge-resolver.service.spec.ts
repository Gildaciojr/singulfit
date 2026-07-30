import { ActivityLevel, FitnessGoal, Gender } from '@prisma/client';
import {
  COACH_PROFILE_DATA_SOURCE,
  type CoachProfileConstraint,
  type CoachProfileDatum,
  type CoachProfileSnapshot,
} from '../context/coach-profile-snapshot.contract';
import { WORKOUT_KNOWLEDGE_PACKAGES } from './workout-knowledge.catalog';
import {
  WORKOUT_KNOWLEDGE_CATALOG_VERSION,
  WORKOUT_KNOWLEDGE_PACKAGE_ID as P,
  WORKOUT_KNOWLEDGE_SCHEMA_VERSION,
  type WorkoutKnowledgePackageId,
} from './workout-knowledge.contract';
import { WorkoutKnowledgeResolverService } from './workout-knowledge-resolver.service';

describe('WorkoutKnowledgeResolverService', () => {
  interface SnapshotOptions {
    readonly goal?: FitnessGoal;
    readonly desiredOutcome?: string;
    readonly modality?: string;
    readonly experience?: string;
    readonly environment?: string;
    readonly equipment?: readonly string[];
    readonly weeklyFrequency?: number;
    readonly sessionDurationMinutes?: number;
    readonly intensityPreference?: string;
    readonly perceivedConditioning?: string;
    readonly returningAfterBreak?: boolean;
    readonly limitations?: readonly string[];
    readonly medicalConditions?: readonly string[];
    readonly adherenceScore?: number;
  }

  const resolver = new WorkoutKnowledgeResolverService();

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

  function constraint(description: string): CoachProfileConstraint {
    return Object.freeze({
      type: 'DECLARED',
      description,
      source: COACH_PROFILE_DATA_SOURCE.USER,
    });
  }

  function optionalKnown<T>(value: T | undefined): CoachProfileDatum<T> {
    return value === undefined ? unknown<T>() : known(value);
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
        experienceLevel: optionalKnown(options.experience),
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
        physicalLimitations: known(
          Object.freeze((options.limitations ?? []).map(constraint)),
        ),
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
        behavioralStage: unknown(),
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

  function expectPackages(
    options: SnapshotOptions,
    expected: readonly WorkoutKnowledgePackageId[],
  ): void {
    const result = resolver.resolve(snapshot(options));
    for (const packageId of expected)
      expect(result.packageIds).toContain(packageId);
  }

  it('resolve musculação, hipertrofia, força, resistência e manutenção', () => {
    expectPackages({ modality: 'musculação', goal: FitnessGoal.MUSCLE_GAIN }, [
      P.RESISTANCE_TRAINING,
      P.HYPERTROPHY,
    ]);
    expectPackages({ modality: 'musculação', desiredOutcome: 'ganhar força' }, [
      P.RESISTANCE_TRAINING,
      P.STRENGTH,
    ]);
    expectPackages(
      { modality: 'musculação', desiredOutcome: 'resistência muscular' },
      [P.RESISTANCE_TRAINING, P.MUSCULAR_ENDURANCE],
    );
    expectPackages({ goal: FitnessGoal.MAINTENANCE }, [P.MAINTENANCE]);
  });

  it.each([
    ['corrida', [P.RUNNING_ADAPTATION, P.RUNNING_ENDURANCE]],
    ['caminhada', [P.WALKING]],
    ['ciclismo', [P.CYCLING]],
    ['CrossFit', [P.CROSSFIT]],
    ['funcional', [P.FUNCTIONAL]],
    ['calistenia', [P.CALISTHENICS]],
    ['treino em casa', [P.HOME_TRAINING]],
    ['cardio', [P.CARDIO_CONDITIONING]],
    ['mobilidade', [P.MOBILITY]],
    ['recuperação ativa', [P.ACTIVE_RECOVERY]],
  ] satisfies readonly (readonly [
    string,
    readonly WorkoutKnowledgePackageId[],
  ])[])('resolve a modalidade %s', (modality, expected) =>
    expectPackages({ modality }, expected),
  );

  it('resolve treino em casa, cardio e pouco tempo', () => {
    expectPackages(
      {
        environment: 'casa',
        desiredOutcome: 'melhorar condicionamento cardiovascular',
        sessionDurationMinutes: 25,
      },
      [P.HOME_TRAINING, P.CARDIO_CONDITIONING, P.LIMITED_TIME],
    );
  });

  it.each([
    ['iniciante', P.BEGINNER],
    ['intermediário', P.INTERMEDIATE],
    ['avançado', P.ADVANCED],
  ] satisfies readonly (readonly [string, WorkoutKnowledgePackageId])[])(
    'resolve experiência %s sem selecionar níveis conflitantes',
    (experience, expected) => {
      const result = resolver.resolve(snapshot({ experience }));
      expect(result.packageIds).toContain(expected);
      expect(
        [P.BEGINNER, P.INTERMEDIATE, P.ADVANCED].filter((id) =>
          result.packageIds.includes(id),
        ),
      ).toHaveLength(1);
    },
  );

  it('distingue equipamento disponível de ausência confirmada', () => {
    expectPackages({ equipment: ['halteres'] }, [
      P.EQUIPMENT_AVAILABLE,
      P.EQUIPMENT_COMPATIBILITY,
    ]);
    const withoutEquipment = resolver.resolve(snapshot({ equipment: [] }));
    expect(withoutEquipment.packageIds).toContain(P.NO_EQUIPMENT);
    expect(withoutEquipment.packageIds).not.toContain(P.EQUIPMENT_AVAILABLE);
  });

  it('resolve limitações, febre, dor e fadiga como restrições de segurança', () => {
    const fever = resolver.resolve(
      snapshot({ medicalConditions: ['febre atual'] }),
    );
    expect(fever.packageIds).toEqual(
      expect.arrayContaining([P.FEVER_SAFETY, P.CLINICAL_SAFETY_BOUNDARY]),
    );
    expect(fever.safetyRestricted).toBe(true);

    const pain = resolver.resolve(
      snapshot({ limitations: ['dor aguda no joelho'] }),
    );
    expect(pain.packageIds).toEqual(
      expect.arrayContaining([P.PHYSICAL_LIMITATIONS, P.ACUTE_PAIN_SAFETY]),
    );
    expect(pain.safetyRestricted).toBe(true);

    const fatigue = resolver.resolve(
      snapshot({ perceivedConditioning: 'fadiga importante' }),
    );
    expect(fatigue.packageIds).toEqual(
      expect.arrayContaining([
        P.SIGNIFICANT_FATIGUE_SAFETY,
        P.DELOAD,
        P.RECOVERY,
      ]),
    );
  });

  it('resolve retorno, progressão, frequência, aderência e intensidade excessiva', () => {
    expectPackages(
      {
        returningAfterBreak: true,
        weeklyFrequency: 6,
        adherenceScore: 0.65,
        experience: 'iniciante',
        intensityPreference: 'alta',
      },
      [
        P.RETURN_AFTER_BREAK,
        P.PROGRESSION,
        P.PROGRESSION_CAUTION,
        P.VOLUME_CAUTION,
        P.ADHERENCE,
        P.INTENSITY_CAUTION,
      ],
    );
  });

  it('mantém catálogo versionado, completo e referencialmente íntegro', () => {
    const ids = new Set(WORKOUT_KNOWLEDGE_PACKAGES.map((item) => item.id));
    expect(ids.size).toBe(WORKOUT_KNOWLEDGE_PACKAGES.length);
    expect(WORKOUT_KNOWLEDGE_PACKAGES.length).toBeGreaterThanOrEqual(46);
    for (const knowledgePackage of WORKOUT_KNOWLEDGE_PACKAGES) {
      expect(knowledgePackage.schemaVersion).toBe(
        WORKOUT_KNOWLEDGE_SCHEMA_VERSION,
      );
      expect(knowledgePackage.catalogVersion).toBe(
        WORKOUT_KNOWLEDGE_CATALOG_VERSION,
      );
      expect(knowledgePackage.objective).not.toHaveLength(0);
      expect(knowledgePackage.positiveFactors.length).toBeGreaterThan(0);
      expect(knowledgePackage.negativeFactors.length).toBeGreaterThan(0);
      expect(knowledgePackage.educationalMessages.length).toBeGreaterThan(0);
      expect(knowledgePackage.limits.length).toBeGreaterThan(0);
      expect(knowledgePackage.evidenceReferences.length).toBeGreaterThan(0);
      for (const referenceId of [
        ...knowledgePackage.dependencyPackageIds,
        ...knowledgePackage.conflictingPackageIds,
      ]) {
        expect(ids.has(referenceId)).toBe(true);
      }
    }
  });

  it('é determinístico, profundamente imutável e não gera treino', () => {
    const input = snapshot({
      modality: 'corrida',
      experience: 'iniciante',
      weeklyFrequency: 3,
    });
    const first = resolver.resolve(input);
    const second = resolver.resolve(input);

    expect(first).toEqual(second);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expectDeepFrozen(first);
    expectDeepFrozen(WORKOUT_KNOWLEDGE_PACKAGES);
    expect(collectKeys(first)).not.toEqual(
      expect.arrayContaining([
        'workoutPlan',
        'sessions',
        'exercises',
        'sets',
        'repetitions',
      ]),
    );
    expect(input.training.preferredModality).toEqual(known('corrida'));
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
