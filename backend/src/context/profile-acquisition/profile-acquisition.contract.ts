import {
  CoachProfileAcquisitionCycleStatus,
  CoachProfileAcquisitionField,
  CoachProfileConfirmationState,
  CoachProfileValueSource,
  CoachProfileValueStatus,
  CoachProfileValueType,
} from '@prisma/client';

export const PROFILE_ACQUISITION_MODE = {
  OFF: 'OFF',
  SHADOW: 'SHADOW',
  INTERNAL: 'INTERNAL',
} as const;

export type ProfileAcquisitionMode =
  (typeof PROFILE_ACQUISITION_MODE)[keyof typeof PROFILE_ACQUISITION_MODE];

export type TrainingModality =
  | 'GYM_STRENGTH'
  | 'HOME_WORKOUT'
  | 'RUNNING'
  | 'CYCLING'
  | 'CROSSFIT'
  | 'WALKING'
  | 'GENERAL_FITNESS'
  | 'OTHER';

export type TrainingExperience = 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';
export type TrainingEnvironment =
  | 'FULL_GYM'
  | 'LIMITED_GYM'
  | 'CROSSFIT_BOX'
  | 'HOME'
  | 'OUTDOOR'
  | 'TRACK'
  | 'TRAIL'
  | 'ROAD'
  | 'INDOOR'
  | 'OTHER';
export type TrainingEquipment =
  | 'BARBELL'
  | 'DUMBBELL'
  | 'KETTLEBELL'
  | 'MACHINE'
  | 'CABLE'
  | 'BENCH'
  | 'PULL_UP_BAR'
  | 'RESISTANCE_BAND'
  | 'BODYWEIGHT'
  | 'BIKE'
  | 'TREADMILL'
  | 'ROW_ERGOMETER';
export type PerceivedConditioning = 'LOW' | 'MODERATE' | 'HIGH';
export type PreferredIntensity = 'LIGHT' | 'MODERATE' | 'HIGH';
export type TrainingFormatPreference = 'INDIVIDUAL' | 'GROUP' | 'FLEXIBLE';
export type EatingPattern =
  | 'OMNIVORE'
  | 'VEGETARIAN'
  | 'VEGAN'
  | 'PESCATARIAN'
  | 'FLEXITARIAN'
  | 'OTHER';
export type FoodBudgetLevel = 'LOW' | 'MODERATE' | 'FLEXIBLE' | 'NOT_INFORMED';
export type CookingAvailability = 'NONE' | 'LOW' | 'MODERATE' | 'HIGH';
export type EatingOutFrequency =
  | 'RARELY'
  | 'SOMETIMES'
  | 'FREQUENTLY'
  | 'MOST_MEALS';
export type ReportedHydration = 'LOW' | 'ADEQUATE' | 'HIGH' | 'NOT_INFORMED';
export type Weekday =
  | 'MONDAY'
  | 'TUESDAY'
  | 'WEDNESDAY'
  | 'THURSDAY'
  | 'FRIDAY'
  | 'SATURDAY'
  | 'SUNDAY';

export interface CoachProfileFieldValueMap {
  readonly [CoachProfileAcquisitionField.TRAINING_MODALITY]: TrainingModality;
  readonly [CoachProfileAcquisitionField.TRAINING_EXPERIENCE]: TrainingExperience;
  readonly [CoachProfileAcquisitionField.WEEKLY_FREQUENCY]: number;
  readonly [CoachProfileAcquisitionField.SESSION_DURATION_MINUTES]: number;
  readonly [CoachProfileAcquisitionField.TRAINING_ENVIRONMENT]: TrainingEnvironment;
  readonly [CoachProfileAcquisitionField.AVAILABLE_EQUIPMENT]: readonly TrainingEquipment[];
  readonly [CoachProfileAcquisitionField.PERCEIVED_CONDITIONING]: PerceivedConditioning;
  readonly [CoachProfileAcquisitionField.PREFERRED_INTENSITY]: PreferredIntensity;
  readonly [CoachProfileAcquisitionField.CARDIO_AVAILABILITY]: boolean;
  readonly [CoachProfileAcquisitionField.TRAINING_FORMAT_PREFERENCE]: TrainingFormatPreference;
  readonly [CoachProfileAcquisitionField.RETURNING_AFTER_BREAK]: boolean;
  readonly [CoachProfileAcquisitionField.DESIRED_MEAL_COUNT]: number;
  readonly [CoachProfileAcquisitionField.EATING_PATTERN]: EatingPattern;
  readonly [CoachProfileAcquisitionField.FOOD_INTOLERANCES]: readonly string[];
  readonly [CoachProfileAcquisitionField.ALLERGIES]: readonly string[];
  readonly [CoachProfileAcquisitionField.DECLARED_FOOD_PREFERENCES]: readonly string[];
  readonly [CoachProfileAcquisitionField.DECLARED_FOOD_REJECTIONS]: readonly string[];
  readonly [CoachProfileAcquisitionField.FOOD_BUDGET_LEVEL]: FoodBudgetLevel;
  readonly [CoachProfileAcquisitionField.COOKING_AVAILABILITY]: CookingAvailability;
  readonly [CoachProfileAcquisitionField.EATING_OUT_FREQUENCY]: EatingOutFrequency;
  readonly [CoachProfileAcquisitionField.REPORTED_HYDRATION]: ReportedHydration;
  readonly [CoachProfileAcquisitionField.REPORTED_SUPPLEMENTATION]: readonly string[];
  readonly [CoachProfileAcquisitionField.MEAL_TIMES]: readonly string[];
  readonly [CoachProfileAcquisitionField.TRAINING_TIME]: string;
  readonly [CoachProfileAcquisitionField.AVAILABLE_TRAINING_DAYS]: readonly Weekday[];
  readonly [CoachProfileAcquisitionField.DAILY_TRAINING_WINDOWS]: readonly string[];
}

export type CoachProfileFieldValue<
  TField extends CoachProfileAcquisitionField,
> = CoachProfileFieldValueMap[TField];

export type ProfileAcquisitionDomain = 'NUTRITION' | 'TRAINING' | 'ROUTINE';
export type ProfileConfirmationPolicy =
  | 'NONE'
  | 'IMPLICIT_ON_VALID_RESPONSE'
  | 'EXPLICIT'
  | 'EXPLICIT_ON_CONFLICT'
  | 'ALWAYS_EXPLICIT';
export type ProfileInferencePolicy =
  | 'PROHIBITED'
  | 'SAFE_WITH_PROVENANCE'
  | 'REQUIRES_CONFIRMATION';
export type ProfileUpdatePolicy =
  | 'REPLACE_WITH_HISTORY'
  | 'EXPLICIT_ON_CONFLICT'
  | 'APPEND_UNIQUE_WITH_HISTORY';
export type ProfileFieldConsumer =
  | 'COACH_PROFILE_SNAPSHOT'
  | 'NUTRITION_PLANNING_V2'
  | 'WORKOUT_PLANNING_V2'
  | 'ADAPTIVE_PROFILE_COLLECTOR';
export type ProfileFieldSensitivity = 'STANDARD' | 'PERSONAL' | 'SENSITIVE';

export interface ProfileFieldDependency {
  readonly field: CoachProfileAcquisitionField;
  readonly acceptableStatuses: readonly CoachProfileValueStatus[];
}

export interface CoachProfileFieldDefinition<
  TField extends CoachProfileAcquisitionField,
> {
  readonly field: TField;
  readonly domain: ProfileAcquisitionDomain;
  readonly valueType: CoachProfileValueType;
  readonly priority: 'CRITICAL' | 'IMPORTANT' | 'OPTIONAL';
  readonly dependencies: readonly ProfileFieldDependency[];
  readonly confirmationPolicy: ProfileConfirmationPolicy;
  readonly inferencePolicy: ProfileInferencePolicy;
  readonly updatePolicy: ProfileUpdatePolicy;
  readonly allowedOptions: readonly string[];
  readonly sensitivity: ProfileFieldSensitivity;
  readonly cooldownTurns: number;
  readonly consumers: readonly ProfileFieldConsumer[];
  readonly definitionVersion: number;
  readonly minimum?: number;
  readonly maximum?: number;
}

export type CoachProfileFieldDefinitionMap = {
  readonly [TField in CoachProfileAcquisitionField]: CoachProfileFieldDefinition<TField>;
};

export type ProfileQuestionKind =
  | 'SINGLE_CHOICE'
  | 'MULTIPLE_CHOICE'
  | 'INTEGER'
  | 'BOOLEAN'
  | 'TIME'
  | 'TIME_LIST'
  | 'SHORT_TEXT_LIST';
export type ProfileResponseType =
  | 'OPTION'
  | 'OPTION_LIST'
  | 'INTEGER'
  | 'BOOLEAN'
  | 'TIME'
  | 'TIME_LIST'
  | 'TEXT_LIST';
export type ProfileQuestionReason =
  | 'MISSING_REQUIRED_FIELD'
  | 'MISSING_CONTEXTUAL_FIELD'
  | 'CONFIRMATION_REQUIRED'
  | 'CONFLICT_RESOLUTION'
  | 'PROFILE_UPDATE';

export interface ProfileQuestionOption {
  readonly value: string;
  readonly label: string;
}

export interface ProfileQuestionSpecification {
  readonly field: CoachProfileAcquisitionField;
  readonly questionKind: ProfileQuestionKind;
  readonly responseType: ProfileResponseType;
  readonly allowedOptions: readonly ProfileQuestionOption[];
  readonly allowsFreeText: boolean;
  readonly confirmationPolicy: ProfileConfirmationPolicy;
  readonly reasonCode: ProfileQuestionReason;
  readonly version: number;
  readonly templateCode: string;
}

export interface RealizedProfileQuestion {
  readonly field: CoachProfileAcquisitionField;
  readonly templateCode: string;
  readonly templateVersion: number;
  readonly text: string;
}

export type ProfileAnswerDisposition =
  | 'RECOGNIZED'
  | 'DECLINED'
  | 'DEFERRED'
  | 'UNKNOWN'
  | 'UNRELATED'
  | 'INVALID';

export type RecognizedProfileValue =
  | string
  | number
  | boolean
  | readonly string[];

export interface RecognizedProfileAnswer {
  readonly field: CoachProfileAcquisitionField;
  readonly disposition: ProfileAnswerDisposition;
  readonly valueType: CoachProfileValueType;
  readonly value?: RecognizedProfileValue;
  readonly confidence: 'DETERMINISTIC';
  readonly reasonCode: string;
  readonly confirmationRequired: boolean;
}

export type ProfileConfirmationDisposition =
  | 'CONFIRMED'
  | 'REJECTED'
  | 'DEFERRED'
  | 'UNRELATED'
  | 'INVALID';

export interface RecognizedProfileConfirmation {
  readonly disposition: ProfileConfirmationDisposition;
  readonly confidence: 'DETERMINISTIC';
  readonly reasonCode: string;
}

interface CoachProfileMutationBase<
  TField extends CoachProfileAcquisitionField,
> {
  readonly userId: string;
  readonly field: TField;
  readonly source: CoachProfileValueSource;
  readonly confirmation: CoachProfileConfirmationState;
  readonly referenceDate: string;
  readonly operationKey: string;
  readonly previousValueFingerprint?: string;
  readonly reason: ProfileMutationReason;
  readonly definitionVersion: number;
}

export type CoachProfileMutationCommand<
  TField extends CoachProfileAcquisitionField = CoachProfileAcquisitionField,
> =
  | (CoachProfileMutationBase<TField> & {
      readonly action: 'SET';
      readonly value: CoachProfileFieldValue<TField>;
      readonly status:
        | typeof CoachProfileValueStatus.ANSWERED_UNCONFIRMED
        | typeof CoachProfileValueStatus.CONFIRMED
        | typeof CoachProfileValueStatus.INFERRED;
    })
  | (CoachProfileMutationBase<TField> & {
      readonly action: 'NO_VALUE';
      readonly status:
        | typeof CoachProfileValueStatus.DECLINED
        | typeof CoachProfileValueStatus.DEFERRED
        | typeof CoachProfileValueStatus.INVALIDATED
        | typeof CoachProfileValueStatus.NOT_APPLICABLE;
    });

export type ProfileMutationReason =
  | 'INITIAL_ANSWER'
  | 'PROFILE_UPDATE'
  | 'CORRECTION'
  | 'CONFIRMED_ABSENCE'
  | 'REMOVAL'
  | 'INVALIDATION'
  | 'NOT_APPLICABLE'
  | 'CONFIRMATION';

export type ProfileMutationResultStatus =
  | 'CREATED'
  | 'UPDATED'
  | 'UNCHANGED'
  | 'REQUIRES_CONFIRMATION'
  | 'CONFLICT'
  | 'REJECTED'
  | 'DUPLICATE';

export interface ProfileMutationResult {
  readonly status: ProfileMutationResultStatus;
  readonly field: CoachProfileAcquisitionField;
  readonly valueId: string | null;
  readonly activeValueFingerprint: string | null;
  readonly reasonCode: string;
}

export interface ProfilePendingConfirmationCommand {
  readonly userId: string;
  readonly field: CoachProfileAcquisitionField;
  readonly action: 'CONFIRM' | 'REJECT';
  readonly referenceDate: string;
  readonly sourceOperationKey: string;
}

export interface ProfileAcquisitionCycleCommand {
  readonly userId: string;
  readonly specification: ProfileQuestionSpecification;
  readonly logicalTurn: number;
  readonly origin: string;
  readonly operationKey: string;
  readonly referenceDate: string;
  readonly expiresAt: string;
  readonly sourceMessageId?: string;
}

export interface ProfileAcquisitionCycleResult {
  readonly status:
    | 'CREATED'
    | 'DUPLICATE'
    | 'QUESTION_ALREADY_ACTIVE'
    | 'EXPIRED_PREVIOUS'
    | 'REJECTED';
  readonly cycleId: string | null;
  readonly cycleStatus: CoachProfileAcquisitionCycleStatus | null;
  readonly reasonCode: string;
}

export interface ProfileAcquisitionCycleCompletionCommand {
  readonly userId: string;
  readonly cycleId: string;
  readonly outcome:
    | 'ANSWERED'
    | 'DECLINED'
    | 'DEFERRED'
    | 'CONFIRMED'
    | 'CANCELLED';
  readonly resultCode: string;
  readonly referenceDate: string;
  readonly cooldownUntil?: string;
}

export interface ProfileAcquisitionCycleCompletionResult {
  readonly status:
    | 'COMPLETED'
    | 'CONFIRMATION_PENDING'
    | 'EXPIRED'
    | 'NOT_FOUND'
    | 'ALREADY_CLOSED'
    | 'REJECTED';
  readonly cycleId: string;
  readonly cycleStatus: CoachProfileAcquisitionCycleStatus | null;
}

export interface ProfileAcquisitionCycleAskedCommand {
  readonly userId: string;
  readonly cycleId: string;
  readonly askedAt: string;
}

export interface ProfileAcquisitionCycleAskedResult {
  readonly status:
    | 'MARKED'
    | 'ALREADY_MARKED'
    | 'EXPIRED'
    | 'NOT_FOUND'
    | 'REJECTED';
  readonly cycleId: string;
  readonly cycleStatus: CoachProfileAcquisitionCycleStatus | null;
}

export interface ProfileAcquisitionResponseClaimCommand {
  readonly userId: string;
  readonly cycleId: string;
  readonly messageId: string;
  readonly receivedAt: string;
}

export interface ProfileAcquisitionResponseClaimResult {
  readonly status:
    | 'CLAIMED'
    | 'DUPLICATE'
    | 'BUSY'
    | 'EXPIRED'
    | 'NOT_ASKED'
    | 'NOT_FOUND'
    | 'REJECTED';
  readonly cycleId: string;
  readonly claimCode: string | null;
}

export interface ProfileAcquisitionResponseClaimReleaseCommand {
  readonly userId: string;
  readonly cycleId: string;
  readonly claimCode: string;
}

export const PROFILE_ACQUISITION_FAILURE_CODE = {
  FIELD_NOT_REGISTERED: 'FIELD_NOT_REGISTERED',
  QUESTION_ALREADY_ACTIVE: 'QUESTION_ALREADY_ACTIVE',
  ANSWER_NOT_EXPECTED: 'ANSWER_NOT_EXPECTED',
  ANSWER_RECOGNITION_FAILED: 'ANSWER_RECOGNITION_FAILED',
  VALUE_INVALID: 'VALUE_INVALID',
  CONFIRMATION_REQUIRED: 'CONFIRMATION_REQUIRED',
  VALUE_CONFLICT: 'VALUE_CONFLICT',
  PERSISTENCE_FAILED: 'PERSISTENCE_FAILED',
  DUPLICATE_OPERATION: 'DUPLICATE_OPERATION',
  SNAPSHOT_PROJECTION_FAILED: 'SNAPSHOT_PROJECTION_FAILED',
  UNSUPPORTED_FIELD_VALUE: 'UNSUPPORTED_FIELD_VALUE',
  UNSAFE_PROFILE_MUTATION: 'UNSAFE_PROFILE_MUTATION',
} as const;

export type ProfileAcquisitionFailureCode =
  (typeof PROFILE_ACQUISITION_FAILURE_CODE)[keyof typeof PROFILE_ACQUISITION_FAILURE_CODE];

export {
  CoachProfileAcquisitionCycleStatus,
  CoachProfileAcquisitionField,
  CoachProfileConfirmationState,
  CoachProfileValueSource,
  CoachProfileValueStatus,
  CoachProfileValueType,
};
