import type { ConversationGoalDecision } from '../../context/conversation-goal-planner.contract';

export const NUTRITION_ARTIFACT_TYPE = {
  POINT_GUIDANCE: 'POINT_GUIDANCE',
  MEAL_SUGGESTION: 'MEAL_SUGGESTION',
  DAILY_STRUCTURE: 'DAILY_STRUCTURE',
  WEEKLY_PLAN: 'WEEKLY_PLAN',
  PLAN_REVIEW: 'PLAN_REVIEW',
  PLAN_ADAPTATION: 'PLAN_ADAPTATION',
  FOOD_SUBSTITUTION: 'FOOD_SUBSTITUTION',
  CURRENT_PLAN_PRESENTATION: 'CURRENT_PLAN_PRESENTATION',
} as const;

export type NutritionArtifactType =
  (typeof NUTRITION_ARTIFACT_TYPE)[keyof typeof NUTRITION_ARTIFACT_TYPE];

export type OperationalNutritionPlanArtifactType =
  | typeof NUTRITION_ARTIFACT_TYPE.DAILY_STRUCTURE
  | typeof NUTRITION_ARTIFACT_TYPE.WEEKLY_PLAN
  | typeof NUTRITION_ARTIFACT_TYPE.PLAN_ADAPTATION
  | typeof NUTRITION_ARTIFACT_TYPE.FOOD_SUBSTITUTION;

export type NutritionArtifactResolutionStatus =
  | 'RESOLVED'
  | 'REQUIRES_CLARIFICATION'
  | 'UNSUPPORTED';

export type NutritionArtifactResolutionReason =
  | 'EXPLICIT_ARTIFACT'
  | 'POINT_GUIDANCE_GOAL'
  | 'CURRENT_PLAN_GOAL'
  | 'PLAN_REVIEW_GOAL'
  | 'ARTIFACT_GRANULARITY_REQUIRED'
  | 'NON_NUTRITION_GOAL'
  | 'UNKNOWN_GOAL';

export interface NutritionArtifactResolution {
  readonly status: NutritionArtifactResolutionStatus;
  readonly artifactType: NutritionArtifactType | null;
  readonly reason: NutritionArtifactResolutionReason;
}

export interface NutritionArtifactResolverInput {
  readonly decision: ConversationGoalDecision;
  readonly explicitArtifactType?: NutritionArtifactType;
}

export type NutritionReadinessField =
  | 'PRIMARY_GOAL'
  | 'AGE'
  | 'SEX'
  | 'HEIGHT'
  | 'CURRENT_WEIGHT'
  | 'ACTIVITY_LEVEL'
  | 'FOOD_RESTRICTIONS'
  | 'ALLERGIES'
  | 'MEDICAL_CONDITIONS'
  | 'MEAL_COUNT'
  | 'MEAL_TIMES'
  | 'EATING_PATTERN'
  | 'FOOD_INTOLERANCES'
  | 'DECLARED_FOOD_PREFERENCES'
  | 'DECLARED_FOOD_REJECTIONS'
  | 'COOKING_AVAILABILITY'
  | 'EATING_OUT_FREQUENCY'
  | 'FOOD_BUDGET'
  | 'HYDRATION'
  | 'CURRENT_DIET'
  | 'CURRENT_PLAN_CONTENT';

export type NutritionReadinessStatus =
  | 'READY'
  | 'READY_WITH_LIMITS'
  | 'REQUIRES_CONFIRMATION'
  | 'BLOCKED';

export interface NutritionPlanningReadiness {
  readonly artifactType: NutritionArtifactType;
  readonly status: NutritionReadinessStatus;
  readonly requiredFields: readonly NutritionReadinessField[];
  readonly availableFields: readonly NutritionReadinessField[];
  readonly missingFields: readonly NutritionReadinessField[];
  readonly confirmationRequiredFields: readonly NutritionReadinessField[];
  readonly safetyFlags: readonly NutritionSafetyFlag[];
}

export type NutritionSafetyFlag =
  | 'MEDICAL_CONTEXT_PRESENT'
  | 'PROFILE_CONFLICT_PRESENT'
  | 'CUSTOM_CONSTRAINT_REQUIRES_CONFIRMATION'
  | 'ENERGY_ESTIMATE_UNAVAILABLE'
  | 'CURRENT_PLAN_CONTENT_UNAVAILABLE';
