import type {
  WorkoutArtifactType,
  WorkoutModality,
  WorkoutSafetyFlag,
} from './workout-planning-artifact.contract';
import type {
  WorkoutEquipment,
  WorkoutMovementConstraint,
  WorkoutObjective,
} from './workout-planning-context.contract';
import type {
  WorkoutBlockType,
  WorkoutPlanningStrategy,
} from './workout-planning-strategy.contract';

export const WORKOUT_IDENTITY_PLANES = [
  'HORIZONTAL',
  'VERTICAL',
  'SAGITTAL',
  'FRONTAL',
  'TRANSVERSE',
  'NONE',
] as const;
export const WORKOUT_IDENTITY_REGIONS = [
  'CHEST',
  'SHOULDERS',
  'BACK',
  'ELBOWS',
  'HIPS',
  'KNEES',
  'ANKLES',
  'TRUNK',
  'WHOLE_BODY',
] as const;
export const WORKOUT_IDENTITY_POSITIONS = [
  'STANDING',
  'SEATED',
  'LYING',
  'INCLINED',
  'PRONE',
  'HANGING',
  'KNEELING',
  'QUADRUPED',
  'SIDE_LYING',
] as const;
export const WORKOUT_IDENTITY_ACTIONS = [
  'FLEXION',
  'EXTENSION',
  'ABDUCTION',
  'ADDUCTION',
  'ROTATION',
  'STABILIZATION',
] as const;
/** AI-authored execution semantics, not a backend exercise catalog. */
export interface WorkoutPublicExerciseIdentity {
  readonly plane: (typeof WORKOUT_IDENTITY_PLANES)[number];
  readonly targetRegion: (typeof WORKOUT_IDENTITY_REGIONS)[number];
  readonly bodyPosition: (typeof WORKOUT_IDENTITY_POSITIONS)[number];
  /** Required for OTHER, whose movementPattern does not identify an action. */
  readonly jointAction: (typeof WORKOUT_IDENTITY_ACTIONS)[number] | null;
}

export interface WorkoutActivityBase {
  /** Absent in historical V9; V10 requires it for non-ENDURANCE activities. */
  readonly publicIdentity?: WorkoutPublicExerciseIdentity | null;
  readonly activityKey: string;
  readonly name: string;
  readonly source: 'MODEL_GENERATED';
  readonly movementPattern:
    | 'SQUAT'
    | 'HINGE'
    | 'PUSH'
    | 'PULL'
    | 'CARRY'
    | 'LOCOMOTION'
    | 'ROTATION'
    | 'CORE'
    | 'MOBILITY'
    | 'OTHER';
  readonly equipment: readonly WorkoutEquipment[];
  readonly instruction: string;
  readonly alerts: readonly string[];
  readonly appliedConstraintCodes: readonly WorkoutMovementConstraint['code'][];
}

export interface StrengthActivity extends WorkoutActivityBase {
  readonly kind: 'STRENGTH';
  readonly sets: number;
  readonly repetitions: string;
  readonly restSeconds: number;
  readonly intensity: 'LIGHT' | 'MODERATE' | 'HIGH';
}

export interface TimedActivity extends WorkoutActivityBase {
  readonly kind: 'TIMED';
  readonly durationSeconds: number;
  readonly workSeconds: number | null;
  readonly recoverySeconds: number | null;
  readonly rounds: number;
  readonly intensity: 'LIGHT' | 'MODERATE' | 'HIGH';
}

export interface EnduranceActivity extends WorkoutActivityBase {
  readonly kind: 'ENDURANCE';
  readonly mode: 'RUN' | 'WALK' | 'CYCLE';
  readonly durationMinutes: number;
  readonly distanceKm: number | null;
  readonly intensity: 'LIGHT' | 'MODERATE' | 'HIGH' | 'CONVERSATIONAL';
}

export interface MobilityActivity extends WorkoutActivityBase {
  readonly kind: 'MOBILITY';
  readonly repetitions: string | null;
  readonly holdSeconds: number | null;
  readonly durationSeconds: number | null;
}

export type WorkoutActivityV2 =
  | StrengthActivity
  | TimedActivity
  | EnduranceActivity
  | MobilityActivity;

export const WORKOUT_WORK_FORMATS = [
  'AMRAP',
  'EMOM',
  'FOR_TIME',
  'INTERVAL',
  'ROUNDS',
  'CHIPPER',
  'CONTINUOUS',
  'OTHER',
] as const;
export interface WorkoutBlockWork {
  readonly format: (typeof WORKOUT_WORK_FORMATS)[number];
  readonly durationSeconds: number;
  readonly rounds: number | null;
  readonly intervalSeconds: number | null;
  /** Ordered movement references: EMOM cycles through this order, one per interval. */
  readonly movementActivityKeys: readonly string[];
}
export interface WorkoutBlockV2 {
  readonly work?: WorkoutBlockWork | null;
  readonly blockKey: string;
  readonly type: WorkoutBlockType;
  readonly title: string;
  readonly estimatedDurationMinutes: number;
  readonly activities: readonly WorkoutActivityV2[];
}

export interface WorkoutSessionV2 {
  /** V10 calendar decision; absent in legacy V9 documents. */
  readonly weekday?: import('@prisma/client').WorkoutWeekday;
  readonly sessionKey: string;
  readonly sequence: number;
  readonly label: string;
  readonly estimatedDurationMinutes: number;
  readonly blocks: readonly WorkoutBlockV2[];
}

export interface WorkoutExerciseSubstitution {
  readonly substitutionKey: string;
  readonly sourceActivityKey: string;
  readonly alternativeActivityKey: string;
  readonly reason:
    | 'EQUIPMENT'
    | 'LIMITATION'
    | 'ENVIRONMENT'
    | 'REGRESSION'
    | 'PREFERENCE';
  readonly functionPreserved: boolean;
  readonly confirmationRequired: boolean;
}

export interface WorkoutProgressionRule {
  readonly ruleKey: string;
  readonly state:
    | 'MAINTAIN'
    | 'PROGRESS'
    | 'REGRESS'
    | 'DELOAD'
    | 'REASSESS'
    | 'PAUSE';
  readonly conditionCode: string;
  readonly actionCode: string;
  readonly maximumChangePercent: number;
}

export interface WorkoutPlanValidationIssue {
  readonly code:
    | 'ARTIFACT_MISMATCH'
    | 'MODALITY_MISMATCH'
    | 'MODALITY_ACTIVITY_CONFLICT'
    | 'OBJECTIVE_MISMATCH'
    | 'SESSION_COUNT_MISMATCH'
    | 'WEEKDAY_REQUIRED'
    | 'WEEKDAY_UNAVAILABLE'
    | 'DUPLICATE_WEEKDAY'
    | 'SESSION_DURATION_EXCEEDED'
    | 'ACTIVITY_NAME_INVALID'
    | 'ENDURANCE_MODE_CONFLICT'
    | 'TIMED_DURATION_IMPOSSIBLE'
    | 'TIMED_DURATION_UNCERTAIN'
    | 'SESSION_CONTENT_TOO_SHORT'
    | 'SESSION_CONTENT_TOO_LONG'
    | 'SESSION_DURATION_UNCERTAIN'
    | 'BLOCK_DURATION_INCOHERENT'
    | 'WEEKLY_RECOVERY_OVERLAP'
    | 'CONSECUTIVE_STRENGTH_DAYS'
    | 'EMPTY_BLOCK'
    | 'REQUIRED_BLOCK_MISSING'
    | 'DUPLICATE_KEY'
    | 'INVALID_PARAMETER'
    | 'EQUIPMENT_UNAVAILABLE'
    | 'UNAUTHORIZED_EQUIPMENT_REFERENCE'
    | 'UNAUTHORIZED_EXACT_LOAD'
    | 'UNAUTHORIZED_EXACT_PACE'
    | 'UNAUTHORIZED_EXACT_POWER'
    | 'UNAUTHORIZED_EXACT_HEART_RATE'
    | 'PUBLIC_IDENTITY_REQUIRED'
    | 'PUBLIC_IDENTITY_INCOMPLETE'
    | 'PUBLIC_REPETITIONS_REQUIRED'
    | 'WORK_STRUCTURE_INVALID'
    | 'ENVIRONMENT_INCOMPATIBLE'
    | 'LIMITATION_CONFLICT'
    | 'VOLUME_EXCESSIVE'
    | 'INTENSITY_EXCESSIVE'
    | 'TECHNICAL_MOVEMENT_UNSAFE'
    | 'AGGRESSIVE_PROGRESSION'
    | 'SUBSTITUTION_REFERENCE_INVALID'
    | 'SUBSTITUTION_FUNCTION_MISMATCH';
  readonly severity: 'ERROR' | 'WARNING';
  readonly path: string;
}

export interface WorkoutPlanValidationResult {
  readonly status: 'VALID' | 'VALID_WITH_WARNINGS' | 'INVALID';
  readonly issues: readonly WorkoutPlanValidationIssue[];
}

export interface WorkoutPlanV2 {
  readonly schemaVersion: 2;
  readonly artifactType: WorkoutArtifactType;
  readonly modality: WorkoutModality;
  readonly objective: WorkoutObjective;
  readonly secondaryObjectives?: readonly WorkoutObjective[];
  readonly lifecycleReason:
    | 'CREATION'
    | 'REPLACEMENT'
    | 'ADAPTATION'
    | 'REVIEW'
    | 'REACTIVATION';
  readonly replacesPlanReference: string | null;
  readonly title: string;
  readonly referenceDate: string;
  readonly strategy: WorkoutPlanningStrategy;
  readonly sessions: readonly WorkoutSessionV2[];
  readonly progression: readonly WorkoutProgressionRule[];
  readonly substitutions: readonly WorkoutExerciseSubstitution[];
  readonly adaptationRules: readonly string[];
  readonly appliedConstraints: readonly WorkoutMovementConstraint[];
  readonly personalizationFactors: WorkoutPlanningStrategy['personalizationFactors'];
  readonly safetyFlags: readonly WorkoutSafetyFlag[];
  readonly generationMetadata: {
    readonly engineVersion: 2;
    readonly promptVersionId: string;
    readonly aiJobId: string;
    readonly operationKey: string;
    readonly model: string;
    readonly generatedAt: string;
    readonly reused: boolean;
  };
  readonly validation: WorkoutPlanValidationResult;
}

export interface GeneratedWorkoutPlanV2Candidate {
  readonly artifactType: WorkoutArtifactType;
  readonly modality: WorkoutModality;
  readonly objective: WorkoutObjective;
  readonly secondaryObjectives?: readonly WorkoutObjective[];
  readonly title: string;
  readonly sessions: readonly WorkoutSessionV2[];
  readonly progression: readonly WorkoutProgressionRule[];
  readonly substitutions: readonly WorkoutExerciseSubstitution[];
  readonly adaptationRules: readonly string[];
  readonly safetyFlags: readonly WorkoutSafetyFlag[];
}
