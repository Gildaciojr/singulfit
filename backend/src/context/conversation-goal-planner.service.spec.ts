import { DietPlanStatus, FitnessGoal, WorkoutStatus } from '@prisma/client';
import {
  PROFILE_ACQUISITION_FIELD,
  PROFILE_ACQUISITION_INTENT,
  ProfileAcquisitionDecision,
  ProfileAcquisitionField,
  ProfileAcquisitionPlan,
} from './coach-adaptive-profile-collector.contract';
import { CoachAdaptiveProfileCollectorService } from './coach-adaptive-profile-collector.service';
import {
  COACH_PROFILE_COMPLETION_STATE,
  COACH_PROFILE_DATA_SOURCE,
  COACH_PROFILE_KNOWLEDGE_STATUS,
  CoachProfileDatum,
  CoachProfilePlanReference,
  CoachProfileSnapshot,
} from './coach-profile-snapshot.contract';
import {
  CONVERSATION_GOAL,
  CONVERSATION_RECOGNIZED_INTENT,
  ConversationGoal,
  ConversationGoalHistoryEntry,
  ConversationGoalPlanTarget,
  ConversationGoalPlannerInput,
  ConversationRecognizedIntent,
} from './conversation-goal-planner.contract';
import { ConversationGoalPlannerService } from './conversation-goal-planner.service';
import { ContextModule } from './context.module';

describe('ConversationGoalPlannerService', () => {
  const service = new ConversationGoalPlannerService();

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

  function snapshot(
    input: {
      readonly diet?: boolean;
      readonly workout?: boolean;
      readonly completion?: 'COMPLETE' | 'PARTIAL' | 'INSUFFICIENT';
    } = {},
  ): CoachProfileSnapshot {
    const dietPlan: CoachProfilePlanReference<DietPlanStatus> = Object.freeze({
      id: 'diet-id',
      title: 'Plano alimentar',
      objective: FitnessGoal.WEIGHT_LOSS,
      status: DietPlanStatus.ACTIVE,
      generatedAt: '2026-07-15T10:00:00.000Z',
    });
    const workoutPlan: CoachProfilePlanReference<WorkoutStatus> = Object.freeze(
      {
        id: 'workout-id',
        title: 'Plano de treino',
        objective: FitnessGoal.WEIGHT_LOSS,
        status: WorkoutStatus.ACTIVE,
        generatedAt: '2026-07-15T10:00:00.000Z',
      },
    );

    return Object.freeze({
      identity: Object.freeze({
        userId: known('user-id'),
        displayName: known('Ana'),
        onboardingCompleted: known(true),
      }),
      physical: Object.freeze({
        sex: unknown(),
        birthDate: unknown(),
        ageYears: unknown(),
        heightCm: unknown(),
        currentWeightKg: unknown(),
        targetWeightKg: unknown(),
        activityLevel: unknown(),
      }),
      nutrition: Object.freeze({
        primaryGoal: unknown(),
        desiredOutcome: unknown(),
        desiredMealCount: unknown(),
        dietaryPattern: unknown(),
        cookingAvailability: unknown(),
        mealsAwayFromHome: unknown(),
        foodBudget: unknown(),
        supplementation: unknown(),
        hydration: unknown(),
      }),
      training: Object.freeze({
        primaryGoal: unknown(),
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
      }),
      routine: Object.freeze({
        wakeUpTime: unknown(),
        sleepTime: unknown(),
        trainingTime: unknown(),
        mealTimes: unknown(),
      }),
      restrictions: Object.freeze({
        foodRestrictions: unknown(),
        allergies: unknown(),
        medicalConditions: unknown(),
        physicalLimitations: unknown(),
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
        currentDiet: input.diet ? known(dietPlan) : unknown(),
        currentWorkout: input.workout ? known(workoutPlan) : unknown(),
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
        overall: input.completion ?? COACH_PROFILE_COMPLETION_STATE.PARTIAL,
        sections: Object.freeze([]),
      }),
      conflicts: Object.freeze([]),
      referenceDate: '2026-07-15T12:00:00.000Z',
    });
  }

  function adaptive(
    input: {
      readonly dietReady?: boolean;
      readonly workoutReady?: boolean;
      readonly selectedField?: ProfileAcquisitionField;
      readonly selectedPlans?: readonly ProfileAcquisitionPlan[];
    } = {},
  ): ProfileAcquisitionDecision {
    const selected = input.selectedField
      ? Object.freeze({
          field: input.selectedField,
          domain: 'GENERAL' as const,
          importance: 'CRITICAL' as const,
          state: 'READY_TO_ASK' as const,
          knowledgeStatus: COACH_PROFILE_KNOWLEDGE_STATUS.UNKNOWN,
          confirmationPolicy: 'EXPLICIT_CONFIRMATION_REQUIRED' as const,
          dependencies: Object.freeze([]),
          unmetDependencies: Object.freeze([]),
          blocksPlans: Object.freeze([...(input.selectedPlans ?? ['DIET'])]),
          reason: 'MISSING_CONTEXTUAL_FIELD' as const,
        })
      : null;

    return Object.freeze({
      intent: PROFILE_ACQUISITION_INTENT.GENERAL_CONVERSATION,
      shouldAsk: selected !== null,
      selectedCandidate: selected,
      orderedCandidates: Object.freeze(selected ? [selected] : []),
      readiness: Object.freeze([
        Object.freeze({
          plan: 'DIET' as const,
          ready: input.dietReady ?? true,
          blockingFields: Object.freeze(
            input.dietReady === false
              ? [PROFILE_ACQUISITION_FIELD.PRIMARY_GOAL]
              : [],
          ),
        }),
        Object.freeze({
          plan: 'WORKOUT' as const,
          ready: input.workoutReady ?? true,
          blockingFields: Object.freeze(
            input.workoutReady === false
              ? [PROFILE_ACQUISITION_FIELD.TRAINING_MODALITY]
              : [],
          ),
        }),
      ]),
      reason: selected ? 'FIELD_SELECTED' : 'PROFILE_READY',
    });
  }

  function plan(
    intent: ConversationRecognizedIntent,
    options: {
      readonly profile?: CoachProfileSnapshot;
      readonly adaptive?: ProfileAcquisitionDecision;
      readonly target?: ConversationGoalPlanTarget;
      readonly progress?: boolean;
      readonly confirmation?: boolean;
      readonly history?: readonly ConversationGoalHistoryEntry[];
      readonly logicalTurn?: number;
    } = {},
  ) {
    const profile = options.profile ?? snapshot();
    const input: ConversationGoalPlannerInput = Object.freeze({
      snapshot: profile,
      adaptiveDecision: options.adaptive ?? adaptive(),
      recognizedIntent: intent,
      completion: profile.completion,
      conversationContext: Object.freeze({
        planTarget: options.target,
        progressContextAvailable: options.progress ?? false,
        confirmationRequired: options.confirmation ?? false,
      }),
      recentHistory: Object.freeze({
        currentLogicalTurn: options.logicalTurn ?? 10,
        entries: Object.freeze([...(options.history ?? [])]),
      }),
    });

    return service.plan(input);
  }

  it('maps a common message to an ordinary response', () => {
    expect(plan(CONVERSATION_RECOGNIZED_INTENT.COMMON_MESSAGE)).toMatchObject({
      goal: CONVERSATION_GOAL.ANSWER_MESSAGE,
      reason: 'DIRECT_MESSAGE_RESPONSE',
      canExecute: true,
      confidence: 'HIGH',
    });
  });

  it('maps a nutrition question to guidance without generating a plan', () => {
    expect(
      plan(CONVERSATION_RECOGNIZED_INTENT.NUTRITION_QUESTION),
    ).toMatchObject({
      goal: CONVERSATION_GOAL.GENERAL_GUIDANCE,
      reason: 'NUTRITION_GUIDANCE_REQUESTED',
      targetPlan: null,
    });
  });

  it('routes an incomplete workout profile to one adaptive profile field', () => {
    const result = plan(CONVERSATION_RECOGNIZED_INTENT.WORKOUT_PLAN_REQUEST, {
      adaptive: adaptive({
        workoutReady: false,
        selectedField: PROFILE_ACQUISITION_FIELD.TRAINING_MODALITY,
        selectedPlans: ['WORKOUT'],
      }),
    });

    expect(result).toMatchObject({
      goal: CONVERSATION_GOAL.ASK_PROFILE_INFORMATION,
      targetPlan: 'WORKOUT',
      selectedProfileField: PROFILE_ACQUISITION_FIELD.TRAINING_MODALITY,
      canExecute: true,
    });
    expect(result.missingPreconditions).toContainEqual({
      kind: 'PROFILE_FIELD_AVAILABLE',
      field: PROFILE_ACQUISITION_FIELD.TRAINING_MODALITY,
    });
  });

  it('keeps profile acquisition non-executable when cooldown leaves no field selected', () => {
    const result = plan(CONVERSATION_RECOGNIZED_INTENT.DIET_PLAN_REQUEST, {
      adaptive: adaptive({ dietReady: false }),
    });

    expect(result).toMatchObject({
      goal: CONVERSATION_GOAL.ASK_PROFILE_INFORMATION,
      selectedProfileField: null,
      canExecute: false,
      confidence: 'MEDIUM',
    });
  });

  it.each([
    [
      CONVERSATION_RECOGNIZED_INTENT.DIET_PLAN_REQUEST,
      CONVERSATION_GOAL.GENERATE_DIET_PLAN,
      'DIET',
    ],
    [
      CONVERSATION_RECOGNIZED_INTENT.WORKOUT_PLAN_REQUEST,
      CONVERSATION_GOAL.GENERATE_WORKOUT_PLAN,
      'WORKOUT',
    ],
  ] as const)('allows a complete plan request: %s', (intent, goal, target) => {
    expect(plan(intent)).toMatchObject({
      goal,
      targetPlan: target,
      canExecute: true,
      confidence: 'HIGH',
    });
  });

  it('requires both profile domains before choosing combined plan generation', () => {
    const incomplete = plan(
      CONVERSATION_RECOGNIZED_INTENT.COMBINED_PLAN_REQUEST,
      {
        adaptive: adaptive({
          workoutReady: false,
          selectedField: PROFILE_ACQUISITION_FIELD.TRAINING_MODALITY,
          selectedPlans: ['WORKOUT'],
        }),
      },
    );
    const complete = plan(CONVERSATION_RECOGNIZED_INTENT.COMBINED_PLAN_REQUEST);

    expect(incomplete.goal).toBe(CONVERSATION_GOAL.ASK_PROFILE_INFORMATION);
    expect(complete).toMatchObject({
      goal: CONVERSATION_GOAL.GENERATE_COMBINED_PLANS,
      targetPlan: 'BOTH',
      canExecute: true,
    });
  });

  it('updates an existing plan and converts an update without a plan into generation', () => {
    const update = plan(
      CONVERSATION_RECOGNIZED_INTENT.DIET_PLAN_UPDATE_REQUEST,
      { profile: snapshot({ diet: true }) },
    );
    const generate = plan(
      CONVERSATION_RECOGNIZED_INTENT.WORKOUT_PLAN_UPDATE_REQUEST,
    );

    expect(update).toMatchObject({
      goal: CONVERSATION_GOAL.UPDATE_DIET_PLAN,
      reason: 'CURRENT_DIET_READY_FOR_UPDATE',
    });
    expect(generate).toMatchObject({
      goal: CONVERSATION_GOAL.GENERATE_WORKOUT_PLAN,
      reason: 'WORKOUT_PLAN_MISSING_GENERATION_REQUIRED',
    });
  });

  it('records whether progress review has enough context to execute', () => {
    expect(
      plan(CONVERSATION_RECOGNIZED_INTENT.PROGRESS_REVIEW_REQUEST, {
        progress: true,
      }),
    ).toMatchObject({
      goal: CONVERSATION_GOAL.REVIEW_PROGRESS,
      canExecute: true,
      reason: 'PROGRESS_REVIEW_REQUESTED',
    });
    expect(
      plan(CONVERSATION_RECOGNIZED_INTENT.PROGRESS_REVIEW_REQUEST),
    ).toMatchObject({
      goal: CONVERSATION_GOAL.REVIEW_PROGRESS,
      canExecute: false,
      reason: 'PROGRESS_CONTEXT_MISSING',
    });
  });

  it('requests confirmation only when the conversation context requires it', () => {
    expect(
      plan(CONVERSATION_RECOGNIZED_INTENT.CONFIRMATION_REQUIRED, {
        confirmation: true,
      }),
    ).toMatchObject({
      goal: CONVERSATION_GOAL.REQUEST_CONFIRMATION,
      canExecute: true,
      reason: 'CONFIRMATION_REQUIRED',
    });
    expect(
      plan(CONVERSATION_RECOGNIZED_INTENT.CONFIRMATION_REQUIRED),
    ).toMatchObject({
      goal: CONVERSATION_GOAL.ANSWER_MESSAGE,
      reason: 'CONFIRMATION_NOT_PENDING',
    });
  });

  it('shows an existing current plan and otherwise reports plan status', () => {
    expect(
      plan(CONVERSATION_RECOGNIZED_INTENT.CURRENT_PLAN_REQUEST, {
        profile: snapshot({ workout: true }),
      }),
    ).toMatchObject({
      goal: CONVERSATION_GOAL.SHOW_CURRENT_PLAN,
      targetPlan: 'WORKOUT',
      reason: 'CURRENT_PLAN_AVAILABLE',
    });
    expect(
      plan(CONVERSATION_RECOGNIZED_INTENT.CURRENT_PLAN_REQUEST, {
        target: 'DIET',
      }),
    ).toMatchObject({
      goal: CONVERSATION_GOAL.SHOW_PLAN_STATUS,
      targetPlan: 'DIET',
      reason: 'CURRENT_PLAN_MISSING',
    });
  });

  it('requests a plan target when both current plans make the request ambiguous', () => {
    expect(
      plan(CONVERSATION_RECOGNIZED_INTENT.CURRENT_PLAN_REQUEST, {
        profile: snapshot({ diet: true, workout: true }),
      }),
    ).toMatchObject({
      goal: CONVERSATION_GOAL.REQUEST_CONFIRMATION,
      reason: 'PLAN_TARGET_REQUIRED',
      canExecute: true,
    });
  });

  it('does not choose duplicate generation while an equivalent goal is pending', () => {
    const history: ConversationGoalHistoryEntry = Object.freeze({
      goal: CONVERSATION_GOAL.GENERATE_DIET_PLAN,
      status: 'EXECUTING',
      logicalTurn: 9,
    });
    const result = plan(CONVERSATION_RECOGNIZED_INTENT.DIET_PLAN_REQUEST, {
      history: [history],
    });

    expect(result).toMatchObject({
      goal: CONVERSATION_GOAL.SHOW_PLAN_STATUS,
      reason: 'EQUIVALENT_GOAL_ALREADY_PENDING',
      canExecute: true,
    });
  });

  it('returns a non-executable low-confidence goal for unknown intent', () => {
    expect(plan(CONVERSATION_RECOGNIZED_INTENT.UNKNOWN)).toMatchObject({
      goal: CONVERSATION_GOAL.UNKNOWN,
      reason: 'INTENT_NOT_RECOGNIZED',
      canExecute: false,
      confidence: 'LOW',
    });
  });

  it('is deterministic, deeply frozen and JSON serializable', () => {
    const profile = snapshot({ completion: 'COMPLETE' });
    const first = plan(CONVERSATION_RECOGNIZED_INTENT.DIET_PLAN_REQUEST, {
      profile,
    });
    const second = plan(CONVERSATION_RECOGNIZED_INTENT.DIET_PLAN_REQUEST, {
      profile,
    });

    expect(second).toEqual(first);
    expect(JSON.parse(JSON.stringify(first))).toEqual(first);
    expect(first.profileCompletionState).toBe('COMPLETE');
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.metPreconditions)).toBe(true);
    expect(Object.isFrozen(first.metPreconditions[0])).toBe(true);
    expect(Object.isFrozen(first.missingPreconditions)).toBe(true);
    expect(Object.isFrozen(first.pendingDependencies)).toBe(true);
  });

  it('rejects invalid logical history without consulting system time', () => {
    expect(() =>
      plan(CONVERSATION_RECOGNIZED_INTENT.COMMON_MESSAGE, {
        logicalTurn: 2,
        history: [
          Object.freeze({
            goal: CONVERSATION_GOAL.ANSWER_MESSAGE,
            status: 'COMPLETED',
            logicalTurn: 3,
          }),
        ],
      }),
    ).toThrow('Histórico lógico do Conversation Goal inválido');
  });

  it('is exported with the collector as inert ContextModule infrastructure', () => {
    const providers: unknown = Reflect.getMetadata('providers', ContextModule);
    const exports: unknown = Reflect.getMetadata('exports', ContextModule);

    expect(Array.isArray(providers) ? providers : []).toEqual(
      expect.arrayContaining([
        CoachAdaptiveProfileCollectorService,
        ConversationGoalPlannerService,
      ]),
    );
    expect(Array.isArray(exports) ? exports : []).toContain(
      ConversationGoalPlannerService,
    );
  });
});
