import { Injectable } from '@nestjs/common';
import {
  CoachProfileAcquisitionField,
  CoachProfileValueStatus,
  CoachProfileValueType,
} from '@prisma/client';
import {
  CoachProfileFieldDefinition,
  CoachProfileFieldDefinitionMap,
  ProfileAcquisitionDomain,
  ProfileConfirmationPolicy,
  ProfileFieldConsumer,
  ProfileFieldSensitivity,
  ProfileInferencePolicy,
  ProfileUpdatePolicy,
} from './profile-acquisition.contract';

const NO_DEPENDENCIES = Object.freeze([]);
const SNAPSHOT = 'COACH_PROFILE_SNAPSHOT' as const;
const COLLECTOR = 'ADAPTIVE_PROFILE_COLLECTOR' as const;
const NUTRITION = 'NUTRITION_PLANNING_V2' as const;
const WORKOUT = 'WORKOUT_PLANNING_V2' as const;

function definition<TField extends CoachProfileAcquisitionField>(input: {
  readonly field: TField;
  readonly domain: ProfileAcquisitionDomain;
  readonly valueType: CoachProfileValueType;
  readonly priority: CoachProfileFieldDefinition<TField>['priority'];
  readonly confirmationPolicy?: ProfileConfirmationPolicy;
  readonly inferencePolicy?: ProfileInferencePolicy;
  readonly updatePolicy?: ProfileUpdatePolicy;
  readonly allowedOptions?: readonly string[];
  readonly sensitivity?: ProfileFieldSensitivity;
  readonly consumers: readonly ProfileFieldConsumer[];
  readonly dependencies?: CoachProfileFieldDefinition<TField>['dependencies'];
  readonly minimum?: number;
  readonly maximum?: number;
}): CoachProfileFieldDefinition<TField> {
  return Object.freeze({
    ...input,
    confirmationPolicy:
      input.confirmationPolicy ?? 'IMPLICIT_ON_VALID_RESPONSE',
    inferencePolicy: input.inferencePolicy ?? 'PROHIBITED',
    updatePolicy: input.updatePolicy ?? 'REPLACE_WITH_HISTORY',
    dependencies: Object.freeze([...(input.dependencies ?? NO_DEPENDENCIES)]),
    allowedOptions: Object.freeze([...(input.allowedOptions ?? [])]),
    sensitivity: input.sensitivity ?? 'STANDARD',
    cooldownTurns: 8,
    consumers: Object.freeze([...input.consumers]),
    definitionVersion: 1,
  });
}

const FIELD_DEFINITIONS: CoachProfileFieldDefinitionMap = Object.freeze({
  [CoachProfileAcquisitionField.TRAINING_MODALITY]: definition({
    field: CoachProfileAcquisitionField.TRAINING_MODALITY,
    domain: 'TRAINING',
    valueType: CoachProfileValueType.TEXT,
    priority: 'CRITICAL',
    allowedOptions: [
      'GYM_STRENGTH',
      'HOME_WORKOUT',
      'RUNNING',
      'CYCLING',
      'CROSSFIT',
      'WALKING',
      'GENERAL_FITNESS',
      'OTHER',
    ],
    consumers: [SNAPSHOT, COLLECTOR, WORKOUT],
  }),
  [CoachProfileAcquisitionField.TRAINING_EXPERIENCE]: definition({
    field: CoachProfileAcquisitionField.TRAINING_EXPERIENCE,
    domain: 'TRAINING',
    valueType: CoachProfileValueType.TEXT,
    priority: 'CRITICAL',
    allowedOptions: ['BEGINNER', 'INTERMEDIATE', 'ADVANCED'],
    consumers: [SNAPSHOT, COLLECTOR, WORKOUT],
  }),
  [CoachProfileAcquisitionField.WEEKLY_FREQUENCY]: definition({
    field: CoachProfileAcquisitionField.WEEKLY_FREQUENCY,
    domain: 'TRAINING',
    valueType: CoachProfileValueType.INTEGER,
    priority: 'CRITICAL',
    minimum: 1,
    maximum: 7,
    consumers: [SNAPSHOT, COLLECTOR, WORKOUT],
  }),
  [CoachProfileAcquisitionField.SESSION_DURATION_MINUTES]: definition({
    field: CoachProfileAcquisitionField.SESSION_DURATION_MINUTES,
    domain: 'TRAINING',
    valueType: CoachProfileValueType.INTEGER,
    priority: 'CRITICAL',
    minimum: 10,
    maximum: 180,
    consumers: [SNAPSHOT, COLLECTOR, WORKOUT],
  }),
  [CoachProfileAcquisitionField.TRAINING_ENVIRONMENT]: definition({
    field: CoachProfileAcquisitionField.TRAINING_ENVIRONMENT,
    domain: 'TRAINING',
    valueType: CoachProfileValueType.TEXT,
    priority: 'CRITICAL',
    allowedOptions: [
      'FULL_GYM',
      'LIMITED_GYM',
      'CROSSFIT_BOX',
      'HOME',
      'OUTDOOR',
      'TRACK',
      'TRAIL',
      'ROAD',
      'INDOOR',
      'OTHER',
    ],
    consumers: [SNAPSHOT, COLLECTOR, WORKOUT],
    dependencies: [
      {
        field: CoachProfileAcquisitionField.TRAINING_MODALITY,
        acceptableStatuses: [
          CoachProfileValueStatus.CONFIRMED,
          CoachProfileValueStatus.INFERRED,
        ],
      },
    ],
  }),
  [CoachProfileAcquisitionField.AVAILABLE_EQUIPMENT]: definition({
    field: CoachProfileAcquisitionField.AVAILABLE_EQUIPMENT,
    domain: 'TRAINING',
    valueType: CoachProfileValueType.TEXT_LIST,
    priority: 'CRITICAL',
    allowedOptions: [
      'BARBELL',
      'DUMBBELL',
      'KETTLEBELL',
      'MACHINE',
      'CABLE',
      'BENCH',
      'PULL_UP_BAR',
      'RESISTANCE_BAND',
      'BODYWEIGHT',
      'BIKE',
      'TREADMILL',
      'ROW_ERGOMETER',
    ],
    consumers: [SNAPSHOT, COLLECTOR, WORKOUT],
    dependencies: [
      {
        field: CoachProfileAcquisitionField.TRAINING_MODALITY,
        acceptableStatuses: [
          CoachProfileValueStatus.CONFIRMED,
          CoachProfileValueStatus.INFERRED,
        ],
      },
    ],
  }),
  [CoachProfileAcquisitionField.PERCEIVED_CONDITIONING]: definition({
    field: CoachProfileAcquisitionField.PERCEIVED_CONDITIONING,
    domain: 'TRAINING',
    valueType: CoachProfileValueType.TEXT,
    priority: 'IMPORTANT',
    allowedOptions: ['LOW', 'MODERATE', 'HIGH'],
    consumers: [SNAPSHOT, COLLECTOR, WORKOUT],
  }),
  [CoachProfileAcquisitionField.PREFERRED_INTENSITY]: definition({
    field: CoachProfileAcquisitionField.PREFERRED_INTENSITY,
    domain: 'TRAINING',
    valueType: CoachProfileValueType.TEXT,
    priority: 'OPTIONAL',
    allowedOptions: ['LIGHT', 'MODERATE', 'HIGH'],
    consumers: [SNAPSHOT, COLLECTOR, WORKOUT],
  }),
  [CoachProfileAcquisitionField.CARDIO_AVAILABILITY]: definition({
    field: CoachProfileAcquisitionField.CARDIO_AVAILABILITY,
    domain: 'TRAINING',
    valueType: CoachProfileValueType.BOOLEAN,
    priority: 'IMPORTANT',
    consumers: [SNAPSHOT, COLLECTOR, WORKOUT],
  }),
  [CoachProfileAcquisitionField.TRAINING_FORMAT_PREFERENCE]: definition({
    field: CoachProfileAcquisitionField.TRAINING_FORMAT_PREFERENCE,
    domain: 'TRAINING',
    valueType: CoachProfileValueType.TEXT,
    priority: 'OPTIONAL',
    allowedOptions: ['INDIVIDUAL', 'GROUP', 'FLEXIBLE'],
    consumers: [SNAPSHOT, COLLECTOR, WORKOUT],
  }),
  [CoachProfileAcquisitionField.RETURNING_AFTER_BREAK]: definition({
    field: CoachProfileAcquisitionField.RETURNING_AFTER_BREAK,
    domain: 'TRAINING',
    valueType: CoachProfileValueType.BOOLEAN,
    priority: 'IMPORTANT',
    confirmationPolicy: 'EXPLICIT_ON_CONFLICT',
    inferencePolicy: 'PROHIBITED',
    sensitivity: 'PERSONAL',
    consumers: [SNAPSHOT, WORKOUT],
  }),
  [CoachProfileAcquisitionField.DESIRED_MEAL_COUNT]: definition({
    field: CoachProfileAcquisitionField.DESIRED_MEAL_COUNT,
    domain: 'NUTRITION',
    valueType: CoachProfileValueType.INTEGER,
    priority: 'CRITICAL',
    minimum: 1,
    maximum: 8,
    inferencePolicy: 'SAFE_WITH_PROVENANCE',
    consumers: [SNAPSHOT, COLLECTOR, NUTRITION],
  }),
  [CoachProfileAcquisitionField.EATING_PATTERN]: definition({
    field: CoachProfileAcquisitionField.EATING_PATTERN,
    domain: 'NUTRITION',
    valueType: CoachProfileValueType.TEXT,
    priority: 'IMPORTANT',
    allowedOptions: [
      'OMNIVORE',
      'VEGETARIAN',
      'VEGAN',
      'PESCATARIAN',
      'FLEXITARIAN',
      'OTHER',
    ],
    consumers: [SNAPSHOT, COLLECTOR, NUTRITION],
  }),
  [CoachProfileAcquisitionField.FOOD_INTOLERANCES]: definition({
    field: CoachProfileAcquisitionField.FOOD_INTOLERANCES,
    domain: 'NUTRITION',
    valueType: CoachProfileValueType.TEXT_LIST,
    priority: 'CRITICAL',
    confirmationPolicy: 'ALWAYS_EXPLICIT',
    inferencePolicy: 'PROHIBITED',
    updatePolicy: 'EXPLICIT_ON_CONFLICT',
    sensitivity: 'SENSITIVE',
    consumers: [SNAPSHOT, NUTRITION],
  }),
  [CoachProfileAcquisitionField.ALLERGIES]: definition({
    field: CoachProfileAcquisitionField.ALLERGIES,
    domain: 'NUTRITION',
    valueType: CoachProfileValueType.TEXT_LIST,
    priority: 'CRITICAL',
    confirmationPolicy: 'ALWAYS_EXPLICIT',
    inferencePolicy: 'PROHIBITED',
    updatePolicy: 'EXPLICIT_ON_CONFLICT',
    sensitivity: 'SENSITIVE',
    consumers: [SNAPSHOT, COLLECTOR, NUTRITION],
  }),
  [CoachProfileAcquisitionField.DECLARED_FOOD_PREFERENCES]: definition({
    field: CoachProfileAcquisitionField.DECLARED_FOOD_PREFERENCES,
    domain: 'NUTRITION',
    valueType: CoachProfileValueType.TEXT_LIST,
    priority: 'IMPORTANT',
    updatePolicy: 'APPEND_UNIQUE_WITH_HISTORY',
    consumers: [SNAPSHOT, NUTRITION],
  }),
  [CoachProfileAcquisitionField.DECLARED_FOOD_REJECTIONS]: definition({
    field: CoachProfileAcquisitionField.DECLARED_FOOD_REJECTIONS,
    domain: 'NUTRITION',
    valueType: CoachProfileValueType.TEXT_LIST,
    priority: 'IMPORTANT',
    updatePolicy: 'APPEND_UNIQUE_WITH_HISTORY',
    consumers: [SNAPSHOT, NUTRITION],
  }),
  [CoachProfileAcquisitionField.FOOD_BUDGET_LEVEL]: definition({
    field: CoachProfileAcquisitionField.FOOD_BUDGET_LEVEL,
    domain: 'NUTRITION',
    valueType: CoachProfileValueType.TEXT,
    priority: 'IMPORTANT',
    allowedOptions: ['LOW', 'MODERATE', 'FLEXIBLE', 'NOT_INFORMED'],
    consumers: [SNAPSHOT, COLLECTOR, NUTRITION],
  }),
  [CoachProfileAcquisitionField.COOKING_AVAILABILITY]: definition({
    field: CoachProfileAcquisitionField.COOKING_AVAILABILITY,
    domain: 'NUTRITION',
    valueType: CoachProfileValueType.TEXT,
    priority: 'IMPORTANT',
    allowedOptions: ['NONE', 'LOW', 'MODERATE', 'HIGH'],
    consumers: [SNAPSHOT, COLLECTOR, NUTRITION],
  }),
  [CoachProfileAcquisitionField.EATING_OUT_FREQUENCY]: definition({
    field: CoachProfileAcquisitionField.EATING_OUT_FREQUENCY,
    domain: 'NUTRITION',
    valueType: CoachProfileValueType.TEXT,
    priority: 'IMPORTANT',
    allowedOptions: ['RARELY', 'SOMETIMES', 'FREQUENTLY', 'MOST_MEALS'],
    consumers: [SNAPSHOT, COLLECTOR, NUTRITION],
  }),
  [CoachProfileAcquisitionField.REPORTED_HYDRATION]: definition({
    field: CoachProfileAcquisitionField.REPORTED_HYDRATION,
    domain: 'NUTRITION',
    valueType: CoachProfileValueType.TEXT,
    priority: 'OPTIONAL',
    allowedOptions: ['LOW', 'ADEQUATE', 'HIGH', 'NOT_INFORMED'],
    consumers: [SNAPSHOT, COLLECTOR, NUTRITION],
  }),
  [CoachProfileAcquisitionField.REPORTED_SUPPLEMENTATION]: definition({
    field: CoachProfileAcquisitionField.REPORTED_SUPPLEMENTATION,
    domain: 'NUTRITION',
    valueType: CoachProfileValueType.TEXT_LIST,
    priority: 'OPTIONAL',
    confirmationPolicy: 'EXPLICIT_ON_CONFLICT',
    sensitivity: 'PERSONAL',
    consumers: [SNAPSHOT, COLLECTOR, NUTRITION],
  }),
  [CoachProfileAcquisitionField.MEAL_TIMES]: definition({
    field: CoachProfileAcquisitionField.MEAL_TIMES,
    domain: 'ROUTINE',
    valueType: CoachProfileValueType.TEXT_LIST,
    priority: 'IMPORTANT',
    inferencePolicy: 'SAFE_WITH_PROVENANCE',
    consumers: [SNAPSHOT, COLLECTOR, NUTRITION],
  }),
  [CoachProfileAcquisitionField.TRAINING_TIME]: definition({
    field: CoachProfileAcquisitionField.TRAINING_TIME,
    domain: 'ROUTINE',
    valueType: CoachProfileValueType.TEXT,
    priority: 'IMPORTANT',
    inferencePolicy: 'SAFE_WITH_PROVENANCE',
    consumers: [SNAPSHOT, COLLECTOR, WORKOUT],
  }),
  [CoachProfileAcquisitionField.AVAILABLE_TRAINING_DAYS]: definition({
    field: CoachProfileAcquisitionField.AVAILABLE_TRAINING_DAYS,
    domain: 'ROUTINE',
    valueType: CoachProfileValueType.TEXT_LIST,
    priority: 'IMPORTANT',
    allowedOptions: [
      'MONDAY',
      'TUESDAY',
      'WEDNESDAY',
      'THURSDAY',
      'FRIDAY',
      'SATURDAY',
      'SUNDAY',
    ],
    consumers: [SNAPSHOT, WORKOUT],
  }),
  [CoachProfileAcquisitionField.DAILY_TRAINING_WINDOWS]: definition({
    field: CoachProfileAcquisitionField.DAILY_TRAINING_WINDOWS,
    domain: 'ROUTINE',
    valueType: CoachProfileValueType.TEXT_LIST,
    priority: 'OPTIONAL',
    consumers: [SNAPSHOT, WORKOUT],
    dependencies: [
      {
        field: CoachProfileAcquisitionField.AVAILABLE_TRAINING_DAYS,
        acceptableStatuses: [CoachProfileValueStatus.CONFIRMED],
      },
    ],
  }),
});

@Injectable()
export class CoachProfileFieldRegistryService {
  get<TField extends CoachProfileAcquisitionField>(
    field: TField,
  ): CoachProfileFieldDefinition<TField> {
    return FIELD_DEFINITIONS[field];
  }

  all(): readonly CoachProfileFieldDefinition<CoachProfileAcquisitionField>[] {
    return Object.freeze(
      Object.values(FIELD_DEFINITIONS).sort((left, right) =>
        left.field.localeCompare(right.field),
      ),
    );
  }

  isAvailableStatus(status: CoachProfileValueStatus): boolean {
    return (
      status === CoachProfileValueStatus.CONFIRMED ||
      status === CoachProfileValueStatus.INFERRED ||
      status === CoachProfileValueStatus.NOT_APPLICABLE
    );
  }
}
