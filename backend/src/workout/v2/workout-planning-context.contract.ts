import type { ActivityLevel, FitnessGoal } from '@prisma/client';
import type { CoachProfileSnapshot } from '../../context/coach-profile-snapshot.contract';
import type {
  WorkoutArtifactType,
  WorkoutModality,
  WorkoutSafetyFlag,
} from './workout-planning-artifact.contract';
import type { WorkoutPlanV2 } from './workout-plan-v2.contract';

export type WorkoutPlanningValue<T> =
  | Readonly<{
      status: 'CONFIRMED' | 'INFERRED' | 'REQUIRES_CONFIRMATION';
      value: T;
    }>
  | Readonly<{ status: 'NOT_SET' }>;

export type WorkoutExperienceLevel = 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';
export type WorkoutEnvironment =
  | 'FULL_GYM'
  | 'LIMITED_GYM'
  | 'CROSSFIT_BOX'
  | 'HOME'
  | 'OUTDOOR'
  | 'STREET'
  | 'TRACK'
  | 'TRAIL'
  | 'ROAD'
  | 'INDOOR'
  | 'INDOOR_BIKE'
  | 'OUTDOOR_BIKE'
  | 'NO_EQUIPMENT';

export type WorkoutEquipment =
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

export type WorkoutObjective =
  | 'WEIGHT_LOSS'
  | 'HYPERTROPHY'
  | 'STRENGTH'
  | 'CONDITIONING'
  | 'GENERAL_HEALTH'
  | 'MOBILITY'
  | 'ACTIVE_RECOVERY'
  | 'COMPLETE_DISTANCE';

export interface WorkoutMovementConstraint {
  readonly code:
    | 'KNEE_LOAD'
    | 'HIP_HINGE'
    | 'OVERHEAD'
    | 'IMPACT'
    | 'SPINAL_LOAD'
    | 'CUSTOM';
  readonly label: string;
  readonly status: 'CONFIRMED' | 'INFERRED' | 'REQUIRES_CONFIRMATION';
}

export interface WorkoutRecognizedContext {
  readonly artifactType?: WorkoutArtifactType;
  readonly modality?: WorkoutPlanningValue<WorkoutModality>;
  readonly objective?: WorkoutPlanningValue<WorkoutObjective>;
  readonly experience?: WorkoutPlanningValue<WorkoutExperienceLevel>;
  readonly weeklyFrequency?: WorkoutPlanningValue<number>;
  readonly sessionDurationMinutes?: WorkoutPlanningValue<number>;
  readonly environment?: WorkoutPlanningValue<WorkoutEnvironment>;
  readonly equipment?: WorkoutPlanningValue<readonly WorkoutEquipment[]>;
  readonly perceivedConditioning?: WorkoutPlanningValue<
    'LOW' | 'MODERATE' | 'HIGH'
  >;
  readonly intensityPreference?: WorkoutPlanningValue<
    'LIGHT' | 'MODERATE' | 'HIGH'
  >;
  readonly movementConstraints?: readonly WorkoutMovementConstraint[];
  readonly safetySignals?: readonly WorkoutSafetyFlag[];
  readonly purpose?:
    | 'CREATION'
    | 'REPLACEMENT'
    | 'ADAPTATION'
    | 'REVIEW'
    | 'REACTIVATION';
}

export interface WorkoutProgressEvidence {
  readonly observedAt: string;
  readonly adherenceScore: number | null;
  readonly perceivedEffort: number | null;
  readonly completedSessions: number | null;
  readonly expectedSessions: number | null;
}

export interface WorkoutPreviousPlanSummary {
  readonly artifactType: WorkoutArtifactType;
  readonly modality: WorkoutModality;
  readonly objective: WorkoutObjective;
  readonly sessionCount: number;
  readonly sessionLabels: readonly string[];
  readonly validationStatus: WorkoutPlanV2['validation']['status'];
}

export interface WorkoutPlanningContext {
  readonly schemaVersion: 2;
  readonly artifactType: WorkoutArtifactType;
  readonly modality: WorkoutPlanningValue<WorkoutModality>;
  readonly referenceDate: string;
  readonly profile: {
    readonly fitnessGoal: WorkoutPlanningValue<FitnessGoal>;
    readonly activityLevel: WorkoutPlanningValue<ActivityLevel>;
    readonly ageYears: WorkoutPlanningValue<number>;
  };
  readonly training: {
    readonly objective: WorkoutPlanningValue<WorkoutObjective>;
    readonly experience: WorkoutPlanningValue<WorkoutExperienceLevel>;
    readonly weeklyFrequency: WorkoutPlanningValue<number>;
    readonly sessionDurationMinutes: WorkoutPlanningValue<number>;
    readonly environment: WorkoutPlanningValue<WorkoutEnvironment>;
    readonly equipment: WorkoutPlanningValue<readonly WorkoutEquipment[]>;
    readonly perceivedConditioning: WorkoutPlanningValue<
      'LOW' | 'MODERATE' | 'HIGH'
    >;
    readonly intensityPreference: WorkoutPlanningValue<
      'LIGHT' | 'MODERATE' | 'HIGH'
    >;
    readonly cardioAvailability: WorkoutPlanningValue<boolean>;
    readonly formatPreference: WorkoutPlanningValue<
      'INDIVIDUAL' | 'GROUP' | 'FLEXIBLE'
    >;
    readonly returningAfterBreak: WorkoutPlanningValue<boolean>;
    readonly availableTrainingDays: WorkoutPlanningValue<readonly string[]>;
    readonly dailyTrainingWindows: WorkoutPlanningValue<readonly string[]>;
  };
  readonly movementConstraints: readonly WorkoutMovementConstraint[];
  readonly safetySignals: readonly WorkoutSafetyFlag[];
  readonly progressEvidence: readonly WorkoutProgressEvidence[];
  readonly currentPlanAvailable: boolean;
  readonly previousPlan: WorkoutPreviousPlanSummary | null;
  readonly lifecyclePurpose: NonNullable<WorkoutRecognizedContext['purpose']>;
}

export interface WorkoutPlanningContextBuilderInput {
  readonly snapshot: CoachProfileSnapshot;
  readonly artifactType: WorkoutArtifactType;
  readonly modality: WorkoutModality;
  readonly recognizedContext: WorkoutRecognizedContext;
  readonly referenceDate: Date;
  readonly progressEvidence?: readonly WorkoutProgressEvidence[];
  readonly previousPlan?: WorkoutPlanV2;
}
