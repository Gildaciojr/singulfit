import { DietPlanStatus, FitnessGoal, WorkoutStatus } from '@prisma/client';
import {
  PROFILE_ACQUISITION_INTENT,
  type ProfileAcquisitionDecision,
} from '../../context/coach-adaptive-profile-collector.contract';
import {
  COACH_PROFILE_COMPLETION_STATE,
  COACH_PROFILE_DATA_SOURCE,
  COACH_PROFILE_KNOWLEDGE_STATUS,
  type CoachProfileDatum,
  type CoachProfileSnapshot,
} from '../../context/coach-profile-snapshot.contract';
import {
  CONVERSATION_GOAL,
  type ConversationGoal,
  type ConversationGoalDecision,
  type ConversationGoalPlanTarget,
  type ConversationRecognizedIntent,
} from '../../context/conversation-goal-planner.contract';
import type { ConversationReference } from '../contracts/conversation-entity.contract';
import type { ConversationGoalPreparationInput } from '../contracts/conversation-goal-preparation.contract';
import type {
  ConversationDomain,
  ConversationOperation,
} from '../contracts/conversation-intent.contract';
import {
  CONVERSATION_UNDERSTANDING_VERSION,
  type ConversationAmbiguity,
  type ConversationSafety,
  type ConversationUnderstandingResult,
} from '../contracts/conversation-understanding.contract';

export const REFERENCE_DATE = '2026-08-01T12:00:00.000Z';

export function unknownDatum<T = never>(): CoachProfileDatum<T> {
  return Object.freeze({
    status: COACH_PROFILE_KNOWLEDGE_STATUS.UNKNOWN,
    sources: Object.freeze([]),
  });
}

export function knownDatum<T>(value: T): CoachProfileDatum<T> {
  return Object.freeze({
    status: COACH_PROFILE_KNOWLEDGE_STATUS.KNOWN,
    value,
    sources: Object.freeze([COACH_PROFILE_DATA_SOURCE.USER]),
  });
}

export function routingSnapshot(
  options: {
    readonly dietAvailable?: boolean;
    readonly workoutAvailable?: boolean;
    readonly progressAvailable?: boolean;
  } = {},
): CoachProfileSnapshot {
  return Object.freeze({
    identity: Object.freeze({
      userId: knownDatum('user-id'),
      displayName: knownDatum('Pessoa'),
      onboardingCompleted: knownDatum(true),
    }),
    physical: Object.freeze({
      sex: unknownDatum(),
      birthDate: unknownDatum(),
      ageYears: unknownDatum(),
      heightCm: unknownDatum(),
      currentWeightKg: unknownDatum(),
      targetWeightKg: unknownDatum(),
      activityLevel: unknownDatum(),
    }),
    nutrition: Object.freeze({
      primaryGoal: unknownDatum(),
      desiredOutcome: unknownDatum(),
      desiredMealCount: unknownDatum(),
      dietaryPattern: unknownDatum(),
      cookingAvailability: unknownDatum(),
      mealsAwayFromHome: unknownDatum(),
      foodBudget: unknownDatum(),
      supplementation: unknownDatum(),
      hydration: unknownDatum(),
    }),
    training: Object.freeze({
      primaryGoal: unknownDatum(),
      experienceLevel: unknownDatum(),
      preferredModality: unknownDatum(),
      weeklyFrequency: unknownDatum(),
      sessionDurationMinutes: unknownDatum(),
      environment: unknownDatum(),
      availableEquipment: unknownDatum(),
      perceivedConditioning: unknownDatum(),
      intensityPreference: unknownDatum(),
      cardioAvailability: unknownDatum(),
      trainingFormatPreference: unknownDatum(),
    }),
    routine: Object.freeze({
      wakeUpTime: unknownDatum(),
      sleepTime: unknownDatum(),
      trainingTime: unknownDatum(),
      mealTimes: unknownDatum(),
    }),
    restrictions: Object.freeze({
      foodRestrictions: knownDatum(Object.freeze([])),
      allergies: knownDatum(Object.freeze([])),
      medicalConditions: knownDatum(Object.freeze([])),
      physicalLimitations: knownDatum(Object.freeze([])),
    }),
    preferences: Object.freeze({ foodPreferences: unknownDatum() }),
    longitudinal: Object.freeze({
      adherenceScore: unknownDatum(),
      latestProgressWeightKg: options.progressAvailable
        ? knownDatum(79)
        : unknownDatum(),
      goalProgression: unknownDatum(),
      nutritionEvolution: unknownDatum(),
      coachAdaptation: unknownDatum(),
    }),
    plans: Object.freeze({
      currentDiet: options.dietAvailable
        ? knownDatum({
            id: 'diet-plan-id',
            title: 'Plano alimentar',
            objective: FitnessGoal.WEIGHT_LOSS,
            status: DietPlanStatus.ACTIVE,
            generatedAt: REFERENCE_DATE,
          })
        : unknownDatum(),
      currentNutritionPlan: options.dietAvailable
        ? knownDatum({
            implementation: 'LEGACY' as const,
            id: 'diet-plan-id',
            title: 'Plano alimentar',
            objective: FitnessGoal.WEIGHT_LOSS,
            status: DietPlanStatus.ACTIVE,
            generatedAt: REFERENCE_DATE,
          })
        : unknownDatum(),
      currentWorkout: options.workoutAvailable
        ? knownDatum({
            id: 'workout-plan-id',
            title: 'Plano de treino',
            objective: FitnessGoal.WEIGHT_LOSS,
            status: WorkoutStatus.ACTIVE,
            generatedAt: REFERENCE_DATE,
          })
        : unknownDatum(),
    }),
    conversation: Object.freeze({
      preferredLanguage: knownDatum('pt-BR'),
      timezone: knownDatum('America/Sao_Paulo'),
      coachStyle: unknownDatum(),
      behavioralStyle: unknownDatum(),
      behavioralStage: unknownDatum(),
      classifiedGoal: unknownDatum(),
      memorySummaries: knownDatum(Object.freeze([])),
    }),
    completion: Object.freeze({
      overall: COACH_PROFILE_COMPLETION_STATE.COMPLETE,
      sections: Object.freeze([]),
    }),
    conflicts: Object.freeze([]),
    referenceDate: REFERENCE_DATE,
  });
}

export function readyAdaptiveDecision(): ProfileAcquisitionDecision {
  return Object.freeze({
    intent: PROFILE_ACQUISITION_INTENT.GENERAL_CONVERSATION,
    shouldAsk: false,
    selectedCandidate: null,
    orderedCandidates: Object.freeze([]),
    readiness: Object.freeze([
      Object.freeze({
        plan: 'DIET',
        ready: true,
        blockingFields: Object.freeze([]),
      }),
      Object.freeze({
        plan: 'WORKOUT',
        ready: true,
        blockingFields: Object.freeze([]),
      }),
    ]),
    reason: 'PROFILE_READY',
  });
}

export function understanding(
  intent: ConversationRecognizedIntent,
  operation: ConversationOperation,
  domain: ConversationDomain,
  options: {
    readonly references?: readonly ConversationReference[];
    readonly ambiguity?: ConversationAmbiguity;
    readonly safety?: ConversationSafety;
  } = {},
): ConversationUnderstandingResult {
  return Object.freeze({
    status: 'UNDERSTOOD',
    failure: null,
    intent,
    operation,
    domain,
    confidence: 'HIGH',
    secondaryIntents: Object.freeze([]),
    entities: Object.freeze([]),
    references: Object.freeze([...(options.references ?? [])]),
    ambiguity:
      options.ambiguity ??
      Object.freeze({
        present: false,
        codes: Object.freeze([]),
        clarificationRequired: false,
      }),
    safety:
      options.safety ??
      Object.freeze({
        signals: Object.freeze([]),
        requiresSafeResponse: false,
        requiresProfessionalGuidance: false,
        medicalAdviceProhibited: true,
      }),
    metadata: Object.freeze({
      contractVersion: CONVERSATION_UNDERSTANDING_VERSION,
      source: 'DETERMINISTIC',
      operationKey: `understanding:${intent}`,
      evaluatedAt: REFERENCE_DATE,
      contextUsed: Object.freeze(['CURRENT_MESSAGE' as const]),
      rationaleCodes: Object.freeze(['EXPLICIT_CURRENT_TURN' as const]),
    }),
  });
}

export function goalDecision(
  goal: ConversationGoal,
  intent: ConversationRecognizedIntent,
  options: {
    readonly targetPlan?: ConversationGoalPlanTarget | null;
    readonly canExecute?: boolean;
    readonly selectedProfileField?: ConversationGoalDecision['selectedProfileField'];
    readonly currentPlanAvailable?: 'DIET' | 'WORKOUT';
  } = {},
): ConversationGoalDecision {
  const currentPlan = options.currentPlanAvailable;
  return Object.freeze({
    recognizedIntent: intent,
    goal,
    reason:
      goal === CONVERSATION_GOAL.UNKNOWN
        ? 'INTENT_NOT_RECOGNIZED'
        : 'DIRECT_MESSAGE_RESPONSE',
    targetPlan: options.targetPlan ?? null,
    profileCompletionState: 'COMPLETE',
    canExecute: options.canExecute ?? true,
    confidence: goal === CONVERSATION_GOAL.UNKNOWN ? 'LOW' : 'HIGH',
    selectedProfileField: options.selectedProfileField ?? null,
    metPreconditions: Object.freeze(
      currentPlan
        ? [
            Object.freeze({
              kind: 'CURRENT_PLAN_AVAILABLE' as const,
              plan: currentPlan,
            }),
          ]
        : [],
    ),
    missingPreconditions: Object.freeze([]),
    pendingDependencies: Object.freeze([]),
  });
}

export function planReference(
  domain: 'NUTRITION' | 'WORKOUT' | 'BOTH',
): ConversationReference {
  return Object.freeze({
    kind: 'PLAN',
    domain,
    target: 'CURRENT',
    ordinal: null,
    resolution: 'RESOLVED',
    source: 'CURRENT_TURN',
  });
}

export function goalPreparationInput(
  result: ConversationUnderstandingResult,
  overrides: Partial<ConversationGoalPreparationInput> = {},
): ConversationGoalPreparationInput {
  return Object.freeze({
    understanding: result,
    snapshot: routingSnapshot(),
    adaptiveDecision: readyAdaptiveDecision(),
    progressContextAvailable: false,
    confirmationPending: false,
    recentHistory: Object.freeze({
      currentLogicalTurn: 1,
      entries: Object.freeze([]),
    }),
    continuity: Object.freeze({
      currentLogicalTurn: 1,
      activeProfileField: null,
      pendingConfirmation: false,
      targetPlan: null,
    }),
    referenceDate: REFERENCE_DATE,
    ...overrides,
  });
}
