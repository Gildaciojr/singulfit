import type { ConversationGoalDecision } from '../../context/conversation-goal-planner.contract';

export const WORKOUT_ARTIFACT_TYPE = {
  POINT_GUIDANCE: 'POINT_GUIDANCE',
  SINGLE_SESSION: 'SINGLE_SESSION',
  WEEKLY_PLAN: 'WEEKLY_PLAN',
  PLAN_REVIEW: 'PLAN_REVIEW',
  PLAN_ADAPTATION: 'PLAN_ADAPTATION',
  EXERCISE_SUBSTITUTION: 'EXERCISE_SUBSTITUTION',
  CURRENT_PLAN_PRESENTATION: 'CURRENT_PLAN_PRESENTATION',
  ACTIVE_RECOVERY_SESSION: 'ACTIVE_RECOVERY_SESSION',
  MOBILITY_SESSION: 'MOBILITY_SESSION',
} as const;

export type WorkoutArtifactType =
  (typeof WORKOUT_ARTIFACT_TYPE)[keyof typeof WORKOUT_ARTIFACT_TYPE];

export const WORKOUT_MODALITY = {
  GYM_STRENGTH: 'GYM_STRENGTH',
  HOME_WORKOUT: 'HOME_WORKOUT',
  OUTDOOR_WORKOUT: 'OUTDOOR_WORKOUT',
  CALISTHENICS: 'CALISTHENICS',
  FUNCTIONAL: 'FUNCTIONAL',
  CROSSFIT: 'CROSSFIT',
  RUNNING: 'RUNNING',
  WALKING: 'WALKING',
  CYCLING: 'CYCLING',
  MOBILITY: 'MOBILITY',
  CARDIO_CONDITIONING: 'CARDIO_CONDITIONING',
  ACTIVE_RECOVERY: 'ACTIVE_RECOVERY',
  GENERAL_FITNESS: 'GENERAL_FITNESS',
} as const;

export type WorkoutModality =
  (typeof WORKOUT_MODALITY)[keyof typeof WORKOUT_MODALITY];

export type WorkoutArtifactResolution = Readonly<{
  status: 'RESOLVED' | 'REQUIRES_CLARIFICATION' | 'UNSUPPORTED';
  artifactType: WorkoutArtifactType | null;
  modality: WorkoutModality | null;
  reason:
    | 'EXPLICIT_REQUEST'
    | 'POINT_GUIDANCE_GOAL'
    | 'PLAN_REVIEW_GOAL'
    | 'CURRENT_PLAN_GOAL'
    | 'ARTIFACT_REQUIRED'
    | 'MODALITY_REQUIRED'
    | 'NON_WORKOUT_GOAL'
    | 'UNKNOWN_GOAL';
}>;

export interface WorkoutArtifactResolverInput {
  readonly decision: ConversationGoalDecision;
  readonly explicitArtifactType?: WorkoutArtifactType;
  readonly explicitModality?: WorkoutModality;
}

export type WorkoutReadinessField =
  | 'OBJECTIVE'
  | 'MODALITY'
  | 'EXPERIENCE'
  | 'WEEKLY_FREQUENCY'
  | 'SESSION_DURATION'
  | 'ENVIRONMENT'
  | 'EQUIPMENT'
  | 'PHYSICAL_LIMITATIONS'
  | 'PERCEIVED_CONDITIONING'
  | 'TARGET_DISTANCE'
  | 'CURRENT_RUNNING_DISTANCE'
  | 'CURRENT_PLAN';

export type WorkoutExecutionLevel =
  | 'FULL_PLAN'
  | 'LIMITED_GUIDANCE'
  | 'CLARIFICATION_ONLY'
  | 'NO_EXECUTION';

export interface WorkoutPlanningReadiness {
  readonly artifactType: WorkoutArtifactType;
  readonly modality: WorkoutModality;
  readonly status:
    | 'READY'
    | 'READY_WITH_LIMITS'
    | 'REQUIRES_CONFIRMATION'
    | 'BLOCKED';
  readonly executionLevel: WorkoutExecutionLevel;
  readonly requiredFields: readonly WorkoutReadinessField[];
  readonly availableFields: readonly WorkoutReadinessField[];
  readonly missingFields: readonly WorkoutReadinessField[];
  readonly confirmationRequiredFields: readonly WorkoutReadinessField[];
  readonly safetyFlags: readonly WorkoutSafetyFlag[];
}

export type WorkoutSafetyFlag =
  | 'ACUTE_PAIN'
  | 'FEVER'
  | 'SIGNIFICANT_MALAISE'
  | 'RECENT_INJURY'
  | 'REPORTED_INCAPACITY'
  | 'INSUFFICIENT_RECOVERY'
  | 'CLINICAL_CONTEXT'
  | 'PROFILE_CONFLICT'
  | 'UNCONFIRMED_LIMITATION'
  | 'EXTREME_REQUEST'
  | 'REHABILITATION_REQUEST'
  | 'RETURN_AFTER_LONG_PAUSE'
  | 'TECHNICAL_MODALITY_WITHOUT_READINESS';
