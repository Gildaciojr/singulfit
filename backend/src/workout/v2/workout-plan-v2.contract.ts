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

export interface WorkoutActivityBase {
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

export interface WorkoutBlockV2 {
  readonly blockKey: string;
  readonly type: WorkoutBlockType;
  readonly title: string;
  readonly estimatedDurationMinutes: number;
  readonly activities: readonly WorkoutActivityV2[];
}

export interface WorkoutSessionV2 {
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
    | 'SESSION_COUNT_MISMATCH'
    | 'SESSION_DURATION_EXCEEDED'
    | 'EMPTY_BLOCK'
    | 'REQUIRED_BLOCK_MISSING'
    | 'DUPLICATE_KEY'
    | 'INVALID_PARAMETER'
    | 'EQUIPMENT_UNAVAILABLE'
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
  readonly title: string;
  readonly sessions: readonly WorkoutSessionV2[];
  readonly progression: readonly WorkoutProgressionRule[];
  readonly substitutions: readonly WorkoutExerciseSubstitution[];
  readonly adaptationRules: readonly string[];
  readonly safetyFlags: readonly WorkoutSafetyFlag[];
}
