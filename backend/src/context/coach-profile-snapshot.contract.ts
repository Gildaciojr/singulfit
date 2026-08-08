import {
  ActivityLevel,
  BehavioralAdherenceStyle,
  BehavioralCommunicationStyle,
  BehavioralMotivationStyle,
  BehavioralPersonalityPattern,
  CoachAdaptationMode,
  CoachCoachingStyle,
  CoachCommunicationStyle,
  CoachMotivationStyle,
  CoachTone,
  DietPlanStatus,
  FitnessGoal,
  FoodPreferenceKind,
  Gender,
  GoalProgressionState,
  LongitudinalDirection,
  StageOfChange,
  UserGoalType,
  WorkoutStatus,
  NutritionPlanStatus,
  NutritionArtifactType,
} from '@prisma/client';

export const COACH_PROFILE_KNOWLEDGE_STATUS = {
  KNOWN: 'KNOWN',
  UNKNOWN: 'UNKNOWN',
  INFERRED: 'INFERRED',
  REQUIRES_CONFIRMATION: 'REQUIRES_CONFIRMATION',
  NOT_APPLICABLE: 'NOT_APPLICABLE',
} as const;

export type CoachProfileKnowledgeStatus =
  (typeof COACH_PROFILE_KNOWLEDGE_STATUS)[keyof typeof COACH_PROFILE_KNOWLEDGE_STATUS];

export const COACH_PROFILE_DATA_SOURCE = {
  USER: 'USER',
  FITNESS_PROFILE: 'FITNESS_PROFILE',
  NUTRITION_PROFILE: 'NUTRITION_PROFILE',
  USER_PREFERENCES: 'USER_PREFERENCES',
  ACTIVATION_ONBOARDING: 'ACTIVATION_ONBOARDING',
  FITNESS_CHECK_IN: 'FITNESS_CHECK_IN',
  PROGRESS_SNAPSHOT: 'PROGRESS_SNAPSHOT',
  LONGITUDINAL: 'LONGITUDINAL',
  FOOD_PREFERENCE: 'FOOD_PREFERENCE',
  DIET_PLAN: 'DIET_PLAN',
  NUTRITION_PLAN: 'NUTRITION_PLAN',
  WORKOUT_PLAN: 'WORKOUT_PLAN',
  COACH_PROFILE: 'COACH_PROFILE',
  BEHAVIORAL_PROFILE: 'BEHAVIORAL_PROFILE',
  CONVERSATION_MEMORY: 'CONVERSATION_MEMORY',
  PROFILE_ACQUISITION: 'PROFILE_ACQUISITION',
} as const;

export type CoachProfileDataSource =
  (typeof COACH_PROFILE_DATA_SOURCE)[keyof typeof COACH_PROFILE_DATA_SOURCE];

interface CoachProfileAvailableDatum<T> {
  readonly status:
    | typeof COACH_PROFILE_KNOWLEDGE_STATUS.KNOWN
    | typeof COACH_PROFILE_KNOWLEDGE_STATUS.INFERRED
    | typeof COACH_PROFILE_KNOWLEDGE_STATUS.REQUIRES_CONFIRMATION;
  readonly value: T;
  readonly sources: readonly CoachProfileDataSource[];
}

interface CoachProfileUnavailableDatum {
  readonly status:
    | typeof COACH_PROFILE_KNOWLEDGE_STATUS.UNKNOWN
    | typeof COACH_PROFILE_KNOWLEDGE_STATUS.NOT_APPLICABLE;
  readonly sources: readonly CoachProfileDataSource[];
}

export type CoachProfileDatum<T> =
  | CoachProfileAvailableDatum<T>
  | CoachProfileUnavailableDatum;

export interface CoachProfileConstraint {
  readonly type?: string;
  readonly description: string;
  readonly source: CoachProfileDataSource;
}

export interface CoachProfileFoodPreference {
  readonly foodName: string;
  readonly kind: FoodPreferenceKind;
  readonly confidence: number;
  readonly occurrences: number;
}

export interface CoachProfileIdentity {
  readonly userId: CoachProfileDatum<string>;
  readonly displayName: CoachProfileDatum<string>;
  readonly onboardingCompleted: CoachProfileDatum<boolean>;
}

export interface CoachProfilePhysicalProfile {
  readonly sex: CoachProfileDatum<Gender>;
  readonly birthDate: CoachProfileDatum<string>;
  readonly ageYears: CoachProfileDatum<number>;
  readonly heightCm: CoachProfileDatum<number>;
  readonly currentWeightKg: CoachProfileDatum<number>;
  readonly targetWeightKg: CoachProfileDatum<number>;
  readonly activityLevel: CoachProfileDatum<ActivityLevel>;
}

export interface CoachProfileNutritionProfile {
  readonly primaryGoal: CoachProfileDatum<FitnessGoal>;
  readonly desiredOutcome: CoachProfileDatum<string>;
  readonly desiredMealCount: CoachProfileDatum<number>;
  readonly dietaryPattern: CoachProfileDatum<string>;
  readonly foodIntolerances?: CoachProfileDatum<
    readonly CoachProfileConstraint[]
  >;
  readonly declaredFoodPreferences?: CoachProfileDatum<readonly string[]>;
  readonly declaredFoodRejections?: CoachProfileDatum<readonly string[]>;
  readonly cookingAvailability: CoachProfileDatum<string>;
  readonly mealsAwayFromHome: CoachProfileDatum<boolean>;
  readonly eatingOutFrequency?: CoachProfileDatum<string>;
  readonly foodBudget: CoachProfileDatum<string>;
  readonly supplementation: CoachProfileDatum<readonly string[]>;
  readonly hydration: CoachProfileDatum<string>;
}

export interface CoachProfileTrainingProfile {
  readonly primaryGoal: CoachProfileDatum<FitnessGoal>;
  readonly experienceLevel: CoachProfileDatum<string>;
  readonly preferredModality: CoachProfileDatum<string>;
  readonly weeklyFrequency: CoachProfileDatum<number>;
  readonly sessionDurationMinutes: CoachProfileDatum<number>;
  readonly environment: CoachProfileDatum<string>;
  readonly availableEquipment: CoachProfileDatum<readonly string[]>;
  readonly perceivedConditioning: CoachProfileDatum<string>;
  readonly intensityPreference: CoachProfileDatum<string>;
  readonly cardioAvailability: CoachProfileDatum<boolean>;
  readonly trainingFormatPreference: CoachProfileDatum<string>;
  readonly returningAfterBreak?: CoachProfileDatum<boolean>;
}

export interface CoachProfileRoutineProfile {
  readonly wakeUpTime: CoachProfileDatum<string>;
  readonly sleepTime: CoachProfileDatum<string>;
  readonly trainingTime: CoachProfileDatum<string>;
  readonly mealTimes: CoachProfileDatum<readonly string[]>;
  readonly availableTrainingDays?: CoachProfileDatum<readonly string[]>;
  readonly dailyTrainingWindows?: CoachProfileDatum<readonly string[]>;
}

export interface CoachProfileRestrictionsProfile {
  readonly foodRestrictions: CoachProfileDatum<
    readonly CoachProfileConstraint[]
  >;
  readonly allergies: CoachProfileDatum<readonly CoachProfileConstraint[]>;
  readonly medicalConditions: CoachProfileDatum<
    readonly CoachProfileConstraint[]
  >;
  readonly physicalLimitations: CoachProfileDatum<
    readonly CoachProfileConstraint[]
  >;
}

export interface CoachProfilePreferencesProfile {
  readonly foodPreferences: CoachProfileDatum<
    readonly CoachProfileFoodPreference[]
  >;
}

export interface CoachProfileGoalProgression {
  readonly goal: UserGoalType;
  readonly state: GoalProgressionState;
  readonly score: number;
}

export interface CoachProfileNutritionEvolution {
  readonly direction: LongitudinalDirection;
  readonly mealsAnalyzed: number;
  readonly qualityScore: number;
}

export interface CoachProfileAdaptation {
  readonly mode: CoachAdaptationMode;
  readonly reason: string;
}

export interface CoachProfileLongitudinalProfile {
  readonly adherenceScore: CoachProfileDatum<number>;
  readonly latestProgressWeightKg: CoachProfileDatum<number>;
  readonly goalProgression: CoachProfileDatum<CoachProfileGoalProgression>;
  readonly nutritionEvolution: CoachProfileDatum<CoachProfileNutritionEvolution>;
  readonly coachAdaptation: CoachProfileDatum<CoachProfileAdaptation>;
}

export interface CoachProfilePlanReference<
  TStatus extends DietPlanStatus | WorkoutStatus,
> {
  readonly id: string;
  readonly title: string;
  readonly objective: FitnessGoal;
  readonly status: TStatus;
  readonly generatedAt: string;
}

export type CoachProfileCanonicalNutritionPlanReference =
  | (CoachProfilePlanReference<DietPlanStatus> & {
      readonly implementation: 'LEGACY';
    })
  | {
      readonly implementation: 'V2';
      readonly id: string;
      readonly title: string;
      readonly objective: string;
      readonly status: NutritionPlanStatus;
      readonly artifactType: NutritionArtifactType;
      readonly generatedAt: string;
    };

export interface CoachProfilePlanProfile {
  readonly currentDiet: CoachProfileDatum<
    CoachProfilePlanReference<DietPlanStatus>
  >;
  readonly currentWorkout: CoachProfileDatum<
    CoachProfilePlanReference<WorkoutStatus>
  >;
  readonly currentNutritionPlan: CoachProfileDatum<CoachProfileCanonicalNutritionPlanReference>;
}

export interface CoachProfileCoachStyle {
  readonly communicationStyle: CoachCommunicationStyle;
  readonly coachingStyle: CoachCoachingStyle;
  readonly tone: CoachTone;
  readonly motivationStyle: CoachMotivationStyle;
}

export interface CoachProfileBehavioralStyle {
  readonly communicationStyle: BehavioralCommunicationStyle;
  readonly motivationStyle: BehavioralMotivationStyle;
  readonly adherenceStyle: BehavioralAdherenceStyle;
  readonly personalityPattern: BehavioralPersonalityPattern;
  readonly preferredEngagementHour: number | null;
}

export interface CoachProfileClassifiedGoal {
  readonly goal: UserGoalType;
  readonly confidence: number;
}

export interface CoachProfileConversationProfile {
  readonly preferredLanguage: CoachProfileDatum<string>;
  readonly timezone: CoachProfileDatum<string>;
  readonly coachStyle: CoachProfileDatum<CoachProfileCoachStyle>;
  readonly behavioralStyle: CoachProfileDatum<CoachProfileBehavioralStyle>;
  readonly behavioralStage: CoachProfileDatum<StageOfChange>;
  readonly classifiedGoal: CoachProfileDatum<CoachProfileClassifiedGoal>;
  readonly memorySummaries: CoachProfileDatum<readonly string[]>;
}

export const COACH_PROFILE_COMPLETION_SECTION = {
  GENERAL: 'GENERAL',
  NUTRITION: 'NUTRITION',
  TRAINING: 'TRAINING',
  ROUTINE: 'ROUTINE',
  SAFETY: 'SAFETY',
} as const;

export type CoachProfileCompletionSection =
  (typeof COACH_PROFILE_COMPLETION_SECTION)[keyof typeof COACH_PROFILE_COMPLETION_SECTION];

export const COACH_PROFILE_COMPLETION_STATE = {
  COMPLETE: 'COMPLETE',
  PARTIAL: 'PARTIAL',
  INSUFFICIENT: 'INSUFFICIENT',
} as const;

export type CoachProfileCompletionState =
  (typeof COACH_PROFILE_COMPLETION_STATE)[keyof typeof COACH_PROFILE_COMPLETION_STATE];

export type CoachProfileField =
  | 'DISPLAY_NAME'
  | 'SEX'
  | 'BIRTH_DATE'
  | 'AGE'
  | 'HEIGHT'
  | 'CURRENT_WEIGHT'
  | 'TARGET_WEIGHT'
  | 'PRIMARY_GOAL'
  | 'ACTIVITY_LEVEL'
  | 'FOOD_RESTRICTIONS'
  | 'ALLERGIES'
  | 'FOOD_PREFERENCES'
  | 'MEAL_TIMES'
  | 'MEAL_COUNT'
  | 'TRAINING_EXPERIENCE'
  | 'TRAINING_MODALITY'
  | 'TRAINING_FREQUENCY'
  | 'SESSION_DURATION'
  | 'TRAINING_ENVIRONMENT'
  | 'TRAINING_EQUIPMENT'
  | 'PHYSICAL_LIMITATIONS'
  | 'WAKE_UP_TIME'
  | 'SLEEP_TIME'
  | 'TRAINING_TIME'
  | 'MEDICAL_CONDITIONS';

export interface CoachProfileSectionCompletion {
  readonly section: CoachProfileCompletionSection;
  readonly state: CoachProfileCompletionState;
  readonly ready: boolean;
  readonly requiredFields: readonly CoachProfileField[];
  readonly availableFields: readonly CoachProfileField[];
  readonly missingFields: readonly CoachProfileField[];
  readonly confirmationRequiredFields: readonly CoachProfileField[];
}

export interface CoachProfileCompletionStatus {
  readonly overall: CoachProfileCompletionState;
  readonly sections: readonly CoachProfileSectionCompletion[];
}

export interface CoachProfileConflict {
  readonly field: CoachProfileField;
  readonly preferredSource: CoachProfileDataSource;
  readonly conflictingSource: CoachProfileDataSource;
  readonly preferredValue: string;
  readonly conflictingValue: string;
}

export interface CoachProfileSnapshot {
  readonly identity: CoachProfileIdentity;
  readonly physical: CoachProfilePhysicalProfile;
  readonly nutrition: CoachProfileNutritionProfile;
  readonly training: CoachProfileTrainingProfile;
  readonly routine: CoachProfileRoutineProfile;
  readonly restrictions: CoachProfileRestrictionsProfile;
  readonly preferences: CoachProfilePreferencesProfile;
  readonly longitudinal: CoachProfileLongitudinalProfile;
  readonly plans: CoachProfilePlanProfile;
  readonly conversation: CoachProfileConversationProfile;
  readonly completion: CoachProfileCompletionStatus;
  readonly conflicts: readonly CoachProfileConflict[];
  readonly referenceDate: string;
}
