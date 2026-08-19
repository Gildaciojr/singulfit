import { ActivityLevel, FitnessGoal } from '@prisma/client';
import {
  CoachAdaptiveProfileCollectorInput,
  ProfileAcquisitionConversationContext,
  PROFILE_ACQUISITION_FIELD,
  PROFILE_ACQUISITION_INTENT,
  PROFILE_ACQUISITION_MODALITY,
  PROFILE_ACQUISITION_STATE,
  ProfileAcquisitionField,
  ProfileAcquisitionIntent,
  ProfileAcquisitionInteraction,
  ProfileAcquisitionModality,
} from './coach-adaptive-profile-collector.contract';
import {
  CoachAdaptiveProfileCollectorService,
  PROFILE_ACQUISITION_COOLDOWN,
} from './coach-adaptive-profile-collector.service';
import {
  COACH_PROFILE_COMPLETION_STATE,
  COACH_PROFILE_DATA_SOURCE,
  COACH_PROFILE_KNOWLEDGE_STATUS,
  CoachProfileDatum,
  CoachProfileSnapshot,
} from './coach-profile-snapshot.contract';
import { ContextModule } from './context.module';

interface ProfileFixture {
  readonly goal?: CoachProfileDatum<FitnessGoal>;
  readonly activity?: CoachProfileDatum<ActivityLevel>;
  readonly weight?: CoachProfileDatum<number>;
  readonly height?: CoachProfileDatum<number>;
  readonly foodRestrictions?: CoachProfileDatum<readonly []>;
  readonly allergies?: CoachProfileDatum<readonly []>;
  readonly medicalConditions?: CoachProfileDatum<readonly []>;
  readonly modality?: CoachProfileDatum<string>;
  readonly experience?: CoachProfileDatum<string>;
  readonly environment?: CoachProfileDatum<string>;
  readonly equipment?: CoachProfileDatum<readonly string[]>;
  readonly limitations?: CoachProfileDatum<readonly []>;
  readonly frequency?: CoachProfileDatum<number>;
  readonly duration?: CoachProfileDatum<number>;
  readonly mealCount?: CoachProfileDatum<number>;
  readonly conditioning?: CoachProfileDatum<string>;
  readonly cardio?: CoachProfileDatum<boolean>;
  readonly foodIntolerances?: CoachProfileDatum<readonly []>;
  readonly declaredFoodPreferences?: CoachProfileDatum<readonly string[]>;
  readonly declaredFoodRejections?: CoachProfileDatum<readonly string[]>;
  readonly eatingOutFrequency?: CoachProfileDatum<string>;
}

describe('CoachAdaptiveProfileCollectorService', () => {
  const service = new CoachAdaptiveProfileCollectorService();

  function unknown<T>(): CoachProfileDatum<T> {
    return Object.freeze({
      status: COACH_PROFILE_KNOWLEDGE_STATUS.UNKNOWN,
      sources: Object.freeze([]),
    });
  }

  function known<T>(value: T): CoachProfileDatum<T> {
    return Object.freeze({
      status: COACH_PROFILE_KNOWLEDGE_STATUS.KNOWN,
      value,
      sources: Object.freeze([COACH_PROFILE_DATA_SOURCE.USER]),
    });
  }

  function inferred<T>(value: T): CoachProfileDatum<T> {
    return Object.freeze({
      status: COACH_PROFILE_KNOWLEDGE_STATUS.INFERRED,
      value,
      sources: Object.freeze([COACH_PROFILE_DATA_SOURCE.CONVERSATION_MEMORY]),
    });
  }

  function confirmation<T>(value: T): CoachProfileDatum<T> {
    return Object.freeze({
      status: COACH_PROFILE_KNOWLEDGE_STATUS.REQUIRES_CONFIRMATION,
      value,
      sources: Object.freeze([COACH_PROFILE_DATA_SOURCE.NUTRITION_PROFILE]),
    });
  }

  function snapshot(input: ProfileFixture = {}): CoachProfileSnapshot {
    return Object.freeze({
      identity: Object.freeze({
        userId: known('user-id'),
        displayName: unknown<string>(),
        onboardingCompleted: known(true),
      }),
      physical: Object.freeze({
        sex: unknown(),
        birthDate: unknown(),
        ageYears: unknown(),
        heightCm: input.height ?? unknown(),
        currentWeightKg: input.weight ?? unknown(),
        targetWeightKg: unknown(),
        activityLevel: input.activity ?? unknown(),
      }),
      nutrition: Object.freeze({
        primaryGoal: input.goal ?? unknown(),
        desiredOutcome: unknown(),
        desiredMealCount: input.mealCount ?? unknown(),
        dietaryPattern: unknown(),
        foodIntolerances: input.foodIntolerances ?? unknown(),
        declaredFoodPreferences: input.declaredFoodPreferences ?? unknown(),
        declaredFoodRejections: input.declaredFoodRejections ?? unknown(),
        cookingAvailability: unknown(),
        mealsAwayFromHome: unknown(),
        eatingOutFrequency: input.eatingOutFrequency ?? unknown(),
        foodBudget: unknown(),
        supplementation: unknown(),
        hydration: unknown(),
      }),
      training: Object.freeze({
        primaryGoal: input.goal ?? unknown(),
        experienceLevel: input.experience ?? unknown(),
        preferredModality: input.modality ?? unknown(),
        weeklyFrequency: input.frequency ?? unknown(),
        sessionDurationMinutes: input.duration ?? unknown(),
        environment: input.environment ?? unknown(),
        availableEquipment: input.equipment ?? unknown(),
        perceivedConditioning: input.conditioning ?? unknown(),
        intensityPreference: unknown(),
        cardioAvailability: input.cardio ?? unknown(),
        trainingFormatPreference: unknown(),
      }),
      routine: Object.freeze({
        wakeUpTime: unknown(),
        sleepTime: unknown(),
        trainingTime: unknown(),
        mealTimes: unknown(),
      }),
      restrictions: Object.freeze({
        foodRestrictions: input.foodRestrictions ?? unknown(),
        allergies: input.allergies ?? unknown(),
        medicalConditions: input.medicalConditions ?? unknown(),
        physicalLimitations: input.limitations ?? unknown(),
      }),
      preferences: Object.freeze({ foodPreferences: unknown() }),
      longitudinal: Object.freeze({
        adherenceScore: unknown(),
        latestProgressWeightKg: unknown(),
        goalProgression: unknown(),
        nutritionEvolution: unknown(),
        coachAdaptation: unknown(),
      }),
      plans: Object.freeze({
        currentDiet: unknown(),
        currentWorkout: unknown(),
      }),
      conversation: Object.freeze({
        preferredLanguage: unknown(),
        timezone: unknown(),
        coachStyle: unknown(),
        behavioralStyle: unknown(),
        behavioralStage: unknown(),
        classifiedGoal: unknown(),
        memorySummaries: unknown(),
      }),
      completion: Object.freeze({
        overall: COACH_PROFILE_COMPLETION_STATE.INSUFFICIENT,
        sections: Object.freeze([]),
      }),
      conflicts: Object.freeze([]),
      referenceDate: '2026-07-15T12:00:00.000Z',
    });
  }

  function completeProfile(
    overrides: ProfileFixture = {},
  ): CoachProfileSnapshot {
    return snapshot({
      goal: known(FitnessGoal.WEIGHT_LOSS),
      activity: known(ActivityLevel.MODERATE),
      weight: known(70),
      height: known(170),
      foodRestrictions: known(Object.freeze([])),
      allergies: known(Object.freeze([])),
      medicalConditions: known(Object.freeze([])),
      modality: known('Academia'),
      experience: known('INTERMEDIATE'),
      environment: known('GYM'),
      equipment: known(Object.freeze(['MACHINES'])),
      limitations: known(Object.freeze([])),
      frequency: known(4),
      duration: known(60),
      mealCount: known(4),
      conditioning: known('MODERATE'),
      cardio: known(true),
      foodIntolerances: known(Object.freeze([])),
      declaredFoodPreferences: known(Object.freeze([])),
      declaredFoodRejections: known(Object.freeze([])),
      eatingOutFrequency: known('RARELY'),
      ...overrides,
    });
  }

  function decide(
    intent: ProfileAcquisitionIntent,
    currentSnapshot: CoachProfileSnapshot,
    options: {
      readonly modality?: ProfileAcquisitionModality;
      readonly modalityEvidence?: 'EXPLICIT' | 'INFERRED';
      readonly currentLogicalTurn?: number;
      readonly memory?: readonly ProfileAcquisitionInteraction[];
      readonly history?: readonly ProfileAcquisitionInteraction[];
      readonly conversationContext?: ProfileAcquisitionConversationContext;
    } = {},
  ) {
    const input: CoachAdaptiveProfileCollectorInput = Object.freeze({
      snapshot: currentSnapshot,
      intent,
      conversationContext:
        options.conversationContext ??
        Object.freeze({
          modality: options.modality
            ? Object.freeze({
                value: options.modality,
                evidence: options.modalityEvidence ?? 'EXPLICIT',
              })
            : undefined,
        }),
      memory: Object.freeze({
        interactions: Object.freeze([...(options.memory ?? [])]),
      }),
      recentHistory: Object.freeze({
        currentLogicalTurn: options.currentLogicalTurn ?? 10,
        interactions: Object.freeze([...(options.history ?? [])]),
      }),
    });

    return service.decide(input);
  }

  function candidate(
    decision: ReturnType<typeof decide>,
    field: ProfileAcquisitionField,
  ) {
    const result = decision.orderedCandidates.find(
      (item) => item.field === field,
    );
    if (!result) throw new Error(`Candidato ausente: ${field}`);
    return result;
  }

  it('returns no acquisition and complete readiness for a complete profile', () => {
    const result = decide(
      PROFILE_ACQUISITION_INTENT.COMBINED_PLAN_REQUEST,
      completeProfile(),
    );

    expect(result.shouldAsk).toBe(false);
    expect(result.selectedCandidate).toBeNull();
    expect(result.reason).toBe('PROFILE_READY');
    expect(result.readiness).toEqual([
      { plan: 'DIET', ready: true, blockingFields: [] },
      { plan: 'WORKOUT', ready: true, blockingFields: [] },
    ]);
  });

  it('removes every explicitly declared current-turn workout field from readiness without inventing absent facts', () => {
    const result = decide(
      PROFILE_ACQUISITION_INTENT.WORKOUT_PLAN_REQUEST,
      snapshot(),
      {
        conversationContext: Object.freeze({
          modality: Object.freeze({ value: 'GYM', evidence: 'EXPLICIT' }),
          environment: Object.freeze({
            value: 'FULL_GYM',
            evidence: 'EXPLICIT',
          }),
          weeklyFrequency: Object.freeze({
            value: 4,
            evidence: 'EXPLICIT',
          }),
          sessionDurationMinutes: Object.freeze({
            value: 60,
            evidence: 'EXPLICIT',
          }),
        }),
      },
    );
    const workout = result.readiness.find((item) => item.plan === 'WORKOUT');

    expect(workout?.blockingFields).not.toEqual(
      expect.arrayContaining([
        PROFILE_ACQUISITION_FIELD.TRAINING_MODALITY,
        PROFILE_ACQUISITION_FIELD.TRAINING_ENVIRONMENT,
        PROFILE_ACQUISITION_FIELD.TRAINING_FREQUENCY,
        PROFILE_ACQUISITION_FIELD.SESSION_DURATION,
      ]),
    );
    expect(workout?.blockingFields).toEqual(
      expect.arrayContaining([
        PROFILE_ACQUISITION_FIELD.TRAINING_EXPERIENCE,
        PROFILE_ACQUISITION_FIELD.PHYSICAL_LIMITATIONS,
        PROFILE_ACQUISITION_FIELD.TRAINING_EQUIPMENT,
      ]),
    );
  });

  it('selects only the highest-priority missing field for an empty diet profile', () => {
    const result = decide(
      PROFILE_ACQUISITION_INTENT.DIET_PLAN_REQUEST,
      snapshot(),
    );

    expect(result.shouldAsk).toBe(true);
    expect(result.selectedCandidate?.field).toBe(
      PROFILE_ACQUISITION_FIELD.PRIMARY_GOAL,
    );
    expect(result.selectedCandidate?.importance).toBe('CRITICAL');
    expect(
      result.orderedCandidates.filter((item) => item.state === 'READY_TO_ASK')
        .length,
    ).toBeGreaterThan(1);
  });

  it('chooses modality first when a workout request already has its goal', () => {
    const result = decide(
      PROFILE_ACQUISITION_INTENT.WORKOUT_PLAN_REQUEST,
      snapshot({
        goal: known(FitnessGoal.MUSCLE_GAIN),
        activity: known(ActivityLevel.MODERATE),
        limitations: known(Object.freeze([])),
      }),
    );

    expect(result.selectedCandidate?.field).toBe(
      PROFILE_ACQUISITION_FIELD.TRAINING_MODALITY,
    );
    expect(
      candidate(result, PROFILE_ACQUISITION_FIELD.TRAINING_EQUIPMENT),
    ).toMatchObject({
      state: PROFILE_ACQUISITION_STATE.WAITING_DEPENDENCY,
      reason: 'DEPENDENCY_NOT_MET',
    });
  });

  it('does not ask for meal count merely because the user mentions weight loss', () => {
    const result = decide(
      PROFILE_ACQUISITION_INTENT.NUTRITION_CONVERSATION,
      snapshot({
        goal: known(FitnessGoal.WEIGHT_LOSS),
        weight: known(75),
        height: known(170),
      }),
    );

    expect(result.shouldAsk).toBe(false);
    expect(result.reason).toBe('NO_CONTEXTUAL_ACQUISITION');
    expect(candidate(result, PROFILE_ACQUISITION_FIELD.MEAL_COUNT).state).toBe(
      PROFILE_ACQUISITION_STATE.NOT_NEEDED,
    );
  });

  it.each([
    PROFILE_ACQUISITION_MODALITY.GYM,
    PROFILE_ACQUISITION_MODALITY.HOME,
    PROFILE_ACQUISITION_MODALITY.CROSSFIT,
    PROFILE_ACQUISITION_MODALITY.CYCLING,
  ])(
    'requires equipment for %s only after modality is available',
    (modality) => {
      const result = decide(
        PROFILE_ACQUISITION_INTENT.WORKOUT_PLAN_REQUEST,
        completeProfile({ equipment: unknown(), modality: unknown() }),
        { modality },
      );

      expect(result.selectedCandidate?.field).toBe(
        PROFILE_ACQUISITION_FIELD.TRAINING_EQUIPMENT,
      );
      expect(
        candidate(result, PROFILE_ACQUISITION_FIELD.TRAINING_EQUIPMENT),
      ).toMatchObject({
        state: PROFILE_ACQUISITION_STATE.READY_TO_ASK,
        unmetDependencies: [],
      });
    },
  );

  it('does not require equipment for running', () => {
    const result = decide(
      PROFILE_ACQUISITION_INTENT.WORKOUT_PLAN_REQUEST,
      completeProfile({ equipment: unknown(), modality: unknown() }),
      { modality: PROFILE_ACQUISITION_MODALITY.RUNNING },
    );

    expect(
      candidate(result, PROFILE_ACQUISITION_FIELD.TRAINING_EQUIPMENT).state,
    ).toBe(PROFILE_ACQUISITION_STATE.NOT_NEEDED);
    expect(result.readiness.find((item) => item.plan === 'WORKOUT')).toEqual({
      plan: 'WORKOUT',
      ready: true,
      blockingFields: [],
    });
  });

  it('uses logical-turn cooldown to avoid repetition and re-enables deterministically', () => {
    const incomplete = completeProfile({ modality: unknown() });
    const asked: ProfileAcquisitionInteraction = Object.freeze({
      field: PROFILE_ACQUISITION_FIELD.TRAINING_MODALITY,
      outcome: 'ASKED',
      logicalTurn: 8,
    });
    const coolingDown = decide(
      PROFILE_ACQUISITION_INTENT.WORKOUT_PLAN_REQUEST,
      incomplete,
      { currentLogicalTurn: 10, history: [asked] },
    );
    const availableAgain = decide(
      PROFILE_ACQUISITION_INTENT.WORKOUT_PLAN_REQUEST,
      incomplete,
      {
        currentLogicalTurn:
          asked.logicalTurn + PROFILE_ACQUISITION_COOLDOWN.askedTurns,
        history: [asked],
      },
    );

    expect(
      candidate(coolingDown, PROFILE_ACQUISITION_FIELD.TRAINING_MODALITY).state,
    ).toBe(PROFILE_ACQUISITION_STATE.RECENTLY_ASKED);
    expect(coolingDown.shouldAsk).toBe(false);
    expect(coolingDown.reason).toBe('COOLDOWN_ACTIVE');
    expect(availableAgain.selectedCandidate?.field).toBe(
      PROFILE_ACQUISITION_FIELD.TRAINING_MODALITY,
    );
  });

  it('does not repeat a recently declined field and trusts an answered history entry', () => {
    const current = completeProfile({ modality: unknown() });
    const declined = decide(
      PROFILE_ACQUISITION_INTENT.WORKOUT_PLAN_REQUEST,
      current,
      {
        memory: [
          Object.freeze({
            field: PROFILE_ACQUISITION_FIELD.TRAINING_MODALITY,
            outcome: 'DECLINED',
            logicalTurn: 5,
          }),
        ],
      },
    );
    const answered = decide(
      PROFILE_ACQUISITION_INTENT.WORKOUT_PLAN_REQUEST,
      current,
      {
        history: [
          Object.freeze({
            field: PROFILE_ACQUISITION_FIELD.TRAINING_MODALITY,
            outcome: 'ANSWERED',
            logicalTurn: 10,
          }),
        ],
      },
    );

    expect(
      candidate(declined, PROFILE_ACQUISITION_FIELD.TRAINING_MODALITY),
    ).toMatchObject({
      state: PROFILE_ACQUISITION_STATE.BLOCKED,
      reason: 'RECENTLY_DECLINED_COOLDOWN',
    });
    expect(
      candidate(answered, PROFILE_ACQUISITION_FIELD.TRAINING_MODALITY),
    ).toMatchObject({
      state: PROFILE_ACQUISITION_STATE.ALREADY_KNOWN,
      reason: 'ANSWERED_IN_HISTORY',
    });
  });

  it('distinguishes accepted inference from fields that require confirmation', () => {
    const result = decide(
      PROFILE_ACQUISITION_INTENT.DIET_PLAN_REQUEST,
      completeProfile({
        activity: inferred(ActivityLevel.MODERATE),
        allergies: confirmation(Object.freeze([])),
      }),
    );

    expect(
      candidate(result, PROFILE_ACQUISITION_FIELD.ACTIVITY_LEVEL),
    ).toMatchObject({
      state: PROFILE_ACQUISITION_STATE.ALREADY_KNOWN,
      reason: 'INFERRED_VALUE_ACCEPTED',
    });
    expect(result.selectedCandidate?.field).toBe(
      PROFILE_ACQUISITION_FIELD.ALLERGIES,
    );
    expect(result.selectedCandidate).toMatchObject({
      state: PROFILE_ACQUISITION_STATE.WAITING_CONFIRMATION,
      confirmationPolicy: 'EXPLICIT_CONFIRMATION_REQUIRED',
    });
  });

  it('stops blocking diet on confirmed empty allergies but preserves the unconfirmed gate', () => {
    const pending = decide(
      PROFILE_ACQUISITION_INTENT.DIET_PLAN_REQUEST,
      completeProfile({ allergies: confirmation(Object.freeze([])) }),
    );
    const confirmed = decide(
      PROFILE_ACQUISITION_INTENT.DIET_PLAN_REQUEST,
      completeProfile({ allergies: known(Object.freeze([])) }),
    );

    expect(
      pending.readiness.find((item) => item.plan === 'DIET')?.blockingFields,
    ).toContain(PROFILE_ACQUISITION_FIELD.ALLERGIES);
    expect(confirmed.readiness.find((item) => item.plan === 'DIET')).toEqual({
      plan: 'DIET',
      ready: true,
      blockingFields: [],
    });
  });

  it('requires confirmation for an inferred conversational modality', () => {
    const result = decide(
      PROFILE_ACQUISITION_INTENT.WORKOUT_PLAN_REQUEST,
      completeProfile({ modality: unknown() }),
      {
        modality: PROFILE_ACQUISITION_MODALITY.CROSSFIT,
        modalityEvidence: 'INFERRED',
      },
    );

    expect(result.selectedCandidate).toMatchObject({
      field: PROFILE_ACQUISITION_FIELD.TRAINING_MODALITY,
      state: PROFILE_ACQUISITION_STATE.WAITING_CONFIRMATION,
      reason: 'INFERRED_VALUE_REQUIRES_CONFIRMATION',
    });
  });

  it('is deterministic and deeply freezes the complete decision graph', () => {
    const current = snapshot({ goal: known(FitnessGoal.WEIGHT_LOSS) });
    const first = decide(PROFILE_ACQUISITION_INTENT.DIET_PLAN_REQUEST, current);
    const second = decide(
      PROFILE_ACQUISITION_INTENT.DIET_PLAN_REQUEST,
      current,
    );

    expect(second).toEqual(first);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.orderedCandidates)).toBe(true);
    expect(Object.isFrozen(first.orderedCandidates[0])).toBe(true);
    expect(Object.isFrozen(first.orderedCandidates[0].dependencies)).toBe(true);
    expect(Object.isFrozen(first.orderedCandidates[0].unmetDependencies)).toBe(
      true,
    );
    expect(Object.isFrozen(first.readiness)).toBe(true);
    expect(Object.isFrozen(first.readiness[0])).toBe(true);
    expect(Object.isFrozen(first.readiness[0].blockingFields)).toBe(true);
  });

  it('rejects invalid logical history instead of using absolute system time', () => {
    expect(() =>
      decide(PROFILE_ACQUISITION_INTENT.DIET_PLAN_REQUEST, snapshot(), {
        currentLogicalTurn: 2,
        history: [
          Object.freeze({
            field: PROFILE_ACQUISITION_FIELD.PRIMARY_GOAL,
            outcome: 'ASKED',
            logicalTurn: 3,
          }),
        ],
      }),
    ).toThrow('Histórico lógico de aquisição de perfil inválido');
  });

  it('is registered only as inert and reusable ContextModule infrastructure', () => {
    const providers: unknown = Reflect.getMetadata('providers', ContextModule);
    const exports: unknown = Reflect.getMetadata('exports', ContextModule);

    expect(Array.isArray(providers) ? providers : []).toContain(
      CoachAdaptiveProfileCollectorService,
    );
    expect(Array.isArray(exports) ? exports : []).toContain(
      CoachAdaptiveProfileCollectorService,
    );
  });
});
