import {
  PROFILE_ACQUISITION_FIELD,
  type ProfileAcquisitionField,
} from './coach-adaptive-profile-collector.contract';

export const PROFILE_REQUIREMENT_ACQUISITION_OWNER = {
  BASE_PROFILE: 'BASE_PROFILE',
  ADAPTIVE_PROFILE: 'ADAPTIVE_PROFILE',
} as const;

export type ProfileRequirementAcquisitionOwner =
  (typeof PROFILE_REQUIREMENT_ACQUISITION_OWNER)[keyof typeof PROFILE_REQUIREMENT_ACQUISITION_OWNER];

export interface PlanningProfileRequirement<
  TField extends ProfileAcquisitionField = ProfileAcquisitionField,
> {
  readonly field: TField;
  readonly acquisitionOwner: ProfileRequirementAcquisitionOwner;
}

const base = <TField extends ProfileAcquisitionField>(
  field: TField,
): PlanningProfileRequirement<TField> => ({
  field,
  acquisitionOwner: PROFILE_REQUIREMENT_ACQUISITION_OWNER.BASE_PROFILE,
});
const adaptive = <TField extends ProfileAcquisitionField>(
  field: TField,
): PlanningProfileRequirement<TField> => ({
  field,
  acquisitionOwner: PROFILE_REQUIREMENT_ACQUISITION_OWNER.ADAPTIVE_PROFILE,
});

export const NUTRITION_BASIC_PLAN_REQUIREMENTS = Object.freeze([
  base(PROFILE_ACQUISITION_FIELD.PRIMARY_GOAL),
  base(PROFILE_ACQUISITION_FIELD.AGE),
  base(PROFILE_ACQUISITION_FIELD.SEX),
  base(PROFILE_ACQUISITION_FIELD.HEIGHT),
  base(PROFILE_ACQUISITION_FIELD.CURRENT_WEIGHT),
  base(PROFILE_ACQUISITION_FIELD.ACTIVITY_LEVEL),
  base(PROFILE_ACQUISITION_FIELD.FOOD_RESTRICTIONS),
  adaptive(PROFILE_ACQUISITION_FIELD.ALLERGIES),
  adaptive(PROFILE_ACQUISITION_FIELD.MEDICAL_CONDITIONS),
  adaptive(PROFILE_ACQUISITION_FIELD.MEAL_COUNT),
]);

export const RUNNING_COMPLETE_DISTANCE_REQUIRED_FIELDS = Object.freeze([
  PROFILE_ACQUISITION_FIELD.TARGET_DISTANCE,
  PROFILE_ACQUISITION_FIELD.CURRENT_RUNNING_DISTANCE,
] as const);

export const isAdaptiveNutritionBasicRequirement = (
  field: ProfileAcquisitionField,
): boolean =>
  NUTRITION_BASIC_PLAN_REQUIREMENTS.some(
    (requirement) =>
      requirement.field === field &&
      requirement.acquisitionOwner ===
        PROFILE_REQUIREMENT_ACQUISITION_OWNER.ADAPTIVE_PROFILE,
  );
