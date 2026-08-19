import type {
  CoachProfileKnowledgeStatus,
  CoachProfileSnapshot,
} from './coach-profile-snapshot.contract';

export const PROFILE_ACQUISITION_INTENT = {
  GENERAL_CONVERSATION: 'GENERAL_CONVERSATION',
  NUTRITION_CONVERSATION: 'NUTRITION_CONVERSATION',
  TRAINING_CONVERSATION: 'TRAINING_CONVERSATION',
  DIET_PLAN_REQUEST: 'DIET_PLAN_REQUEST',
  WORKOUT_PLAN_REQUEST: 'WORKOUT_PLAN_REQUEST',
  COMBINED_PLAN_REQUEST: 'COMBINED_PLAN_REQUEST',
} as const;

export type ProfileAcquisitionIntent =
  (typeof PROFILE_ACQUISITION_INTENT)[keyof typeof PROFILE_ACQUISITION_INTENT];

export const PROFILE_ACQUISITION_MODALITY = {
  GYM: 'GYM',
  HOME: 'HOME',
  RUNNING: 'RUNNING',
  CROSSFIT: 'CROSSFIT',
  CYCLING: 'CYCLING',
  OTHER: 'OTHER',
} as const;

export type ProfileAcquisitionModality =
  (typeof PROFILE_ACQUISITION_MODALITY)[keyof typeof PROFILE_ACQUISITION_MODALITY];

export type ProfileAcquisitionContextEvidence = 'EXPLICIT' | 'INFERRED';
export type ProfileAcquisitionModalityEvidence =
  ProfileAcquisitionContextEvidence;

export interface ProfileAcquisitionContextValue<T> {
  readonly value: T;
  readonly evidence: ProfileAcquisitionContextEvidence;
}

export interface ProfileAcquisitionConversationContext {
  readonly modality?: ProfileAcquisitionContextValue<ProfileAcquisitionModality>;
  readonly experience?: ProfileAcquisitionContextValue<string>;
  readonly environment?: ProfileAcquisitionContextValue<string>;
  readonly equipment?: ProfileAcquisitionContextValue<readonly string[]>;
  readonly weeklyFrequency?: ProfileAcquisitionContextValue<number>;
  readonly sessionDurationMinutes?: ProfileAcquisitionContextValue<number>;
}

export const PROFILE_ACQUISITION_FIELD = {
  DISPLAY_NAME: 'DISPLAY_NAME',
  SEX: 'SEX',
  AGE: 'AGE',
  HEIGHT: 'HEIGHT',
  CURRENT_WEIGHT: 'CURRENT_WEIGHT',
  TARGET_WEIGHT: 'TARGET_WEIGHT',
  PRIMARY_GOAL: 'PRIMARY_GOAL',
  ACTIVITY_LEVEL: 'ACTIVITY_LEVEL',
  FOOD_RESTRICTIONS: 'FOOD_RESTRICTIONS',
  ALLERGIES: 'ALLERGIES',
  MEDICAL_CONDITIONS: 'MEDICAL_CONDITIONS',
  FOOD_PREFERENCES: 'FOOD_PREFERENCES',
  FOOD_INTOLERANCES: 'FOOD_INTOLERANCES',
  DECLARED_FOOD_PREFERENCES: 'DECLARED_FOOD_PREFERENCES',
  DECLARED_FOOD_REJECTIONS: 'DECLARED_FOOD_REJECTIONS',
  MEAL_COUNT: 'MEAL_COUNT',
  DIETARY_PATTERN: 'DIETARY_PATTERN',
  COOKING_AVAILABILITY: 'COOKING_AVAILABILITY',
  MEALS_AWAY_FROM_HOME: 'MEALS_AWAY_FROM_HOME',
  EATING_OUT_FREQUENCY: 'EATING_OUT_FREQUENCY',
  FOOD_BUDGET: 'FOOD_BUDGET',
  SUPPLEMENTATION: 'SUPPLEMENTATION',
  HYDRATION: 'HYDRATION',
  TRAINING_EXPERIENCE: 'TRAINING_EXPERIENCE',
  TRAINING_MODALITY: 'TRAINING_MODALITY',
  TRAINING_FREQUENCY: 'TRAINING_FREQUENCY',
  SESSION_DURATION: 'SESSION_DURATION',
  TRAINING_ENVIRONMENT: 'TRAINING_ENVIRONMENT',
  TRAINING_EQUIPMENT: 'TRAINING_EQUIPMENT',
  PHYSICAL_LIMITATIONS: 'PHYSICAL_LIMITATIONS',
  PERCEIVED_CONDITIONING: 'PERCEIVED_CONDITIONING',
  INTENSITY_PREFERENCE: 'INTENSITY_PREFERENCE',
  CARDIO_AVAILABILITY: 'CARDIO_AVAILABILITY',
  TRAINING_FORMAT_PREFERENCE: 'TRAINING_FORMAT_PREFERENCE',
  RETURNING_AFTER_BREAK: 'RETURNING_AFTER_BREAK',
  WAKE_UP_TIME: 'WAKE_UP_TIME',
  SLEEP_TIME: 'SLEEP_TIME',
  TRAINING_TIME: 'TRAINING_TIME',
  MEAL_TIMES: 'MEAL_TIMES',
  AVAILABLE_TRAINING_DAYS: 'AVAILABLE_TRAINING_DAYS',
  DAILY_TRAINING_WINDOWS: 'DAILY_TRAINING_WINDOWS',
} as const;

export type ProfileAcquisitionField =
  (typeof PROFILE_ACQUISITION_FIELD)[keyof typeof PROFILE_ACQUISITION_FIELD];

export const PROFILE_ACQUISITION_IMPORTANCE = {
  CRITICAL: 'CRITICAL',
  IMPORTANT: 'IMPORTANT',
  OPTIONAL: 'OPTIONAL',
  FUTURE: 'FUTURE',
} as const;

export type ProfileAcquisitionImportance =
  (typeof PROFILE_ACQUISITION_IMPORTANCE)[keyof typeof PROFILE_ACQUISITION_IMPORTANCE];

export const PROFILE_ACQUISITION_STATE = {
  NOT_NEEDED: 'NOT_NEEDED',
  READY_TO_ASK: 'READY_TO_ASK',
  WAITING_DEPENDENCY: 'WAITING_DEPENDENCY',
  ALREADY_KNOWN: 'ALREADY_KNOWN',
  RECENTLY_ASKED: 'RECENTLY_ASKED',
  WAITING_CONFIRMATION: 'WAITING_CONFIRMATION',
  BLOCKED: 'BLOCKED',
} as const;

export type ProfileAcquisitionState =
  (typeof PROFILE_ACQUISITION_STATE)[keyof typeof PROFILE_ACQUISITION_STATE];

export type ProfileAcquisitionConfirmationPolicy =
  | 'INFERENCE_ALLOWED'
  | 'EXPLICIT_CONFIRMATION_REQUIRED';

export type ProfileAcquisitionDomain =
  | 'GENERAL'
  | 'NUTRITION'
  | 'TRAINING'
  | 'ROUTINE'
  | 'SAFETY';

export type ProfileAcquisitionPlan = 'DIET' | 'WORKOUT';

export type ProfileAcquisitionDependency =
  | {
      readonly kind: 'FIELD_AVAILABLE';
      readonly field: ProfileAcquisitionField;
    }
  | {
      readonly kind: 'MODALITY_MATCH';
      readonly modalities: readonly ProfileAcquisitionModality[];
    };

export type ProfileAcquisitionInteractionOutcome =
  | 'ASKED'
  | 'ANSWERED'
  | 'DECLINED';

export interface ProfileAcquisitionInteraction {
  readonly field: ProfileAcquisitionField;
  readonly outcome: ProfileAcquisitionInteractionOutcome;
  readonly logicalTurn: number;
}

export interface ProfileAcquisitionMemory {
  readonly interactions: readonly ProfileAcquisitionInteraction[];
}

export interface ProfileAcquisitionRecentHistory {
  readonly currentLogicalTurn: number;
  readonly interactions: readonly ProfileAcquisitionInteraction[];
}

export type ProfileAcquisitionReason =
  | 'KNOWN_VALUE'
  | 'CONTEXT_EXPLICIT_VALUE'
  | 'ANSWERED_IN_HISTORY'
  | 'INFERRED_VALUE_ACCEPTED'
  | 'INFERRED_VALUE_REQUIRES_CONFIRMATION'
  | 'CONFLICT_REQUIRES_CONFIRMATION'
  | 'MISSING_CONTEXTUAL_FIELD'
  | 'CONTEXT_NOT_RELEVANT'
  | 'DEPENDENCY_NOT_MET'
  | 'RECENTLY_ASKED_COOLDOWN'
  | 'RECENTLY_DECLINED_COOLDOWN';

export interface ProfileAcquisitionCandidate {
  readonly field: ProfileAcquisitionField;
  readonly domain: ProfileAcquisitionDomain;
  readonly importance: ProfileAcquisitionImportance;
  readonly state: ProfileAcquisitionState;
  readonly knowledgeStatus: CoachProfileKnowledgeStatus;
  readonly confirmationPolicy: ProfileAcquisitionConfirmationPolicy;
  readonly dependencies: readonly ProfileAcquisitionDependency[];
  readonly unmetDependencies: readonly ProfileAcquisitionDependency[];
  readonly blocksPlans: readonly ProfileAcquisitionPlan[];
  readonly reason: ProfileAcquisitionReason;
}

export interface ProfileAcquisitionPlanReadiness {
  readonly plan: ProfileAcquisitionPlan;
  readonly ready: boolean;
  readonly blockingFields: readonly ProfileAcquisitionField[];
}

export type ProfileAcquisitionDecisionReason =
  | 'FIELD_SELECTED'
  | 'PROFILE_READY'
  | 'NO_CONTEXTUAL_ACQUISITION'
  | 'COOLDOWN_ACTIVE'
  | 'DEPENDENCIES_PENDING';

export interface ProfileAcquisitionDecision {
  readonly intent: ProfileAcquisitionIntent;
  readonly shouldAsk: boolean;
  readonly selectedCandidate: ProfileAcquisitionCandidate | null;
  readonly orderedCandidates: readonly ProfileAcquisitionCandidate[];
  readonly readiness: readonly ProfileAcquisitionPlanReadiness[];
  readonly reason: ProfileAcquisitionDecisionReason;
}

export interface CoachAdaptiveProfileCollectorInput {
  readonly snapshot: CoachProfileSnapshot;
  readonly intent: ProfileAcquisitionIntent;
  readonly conversationContext: ProfileAcquisitionConversationContext;
  readonly memory: ProfileAcquisitionMemory;
  readonly recentHistory: ProfileAcquisitionRecentHistory;
}
