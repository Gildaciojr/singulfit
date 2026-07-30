import type {
  WorkoutArtifactType,
  WorkoutModality,
} from './workout-planning-artifact.contract';
import type {
  WorkoutEnvironment,
  WorkoutEquipment,
  WorkoutExperienceLevel,
  WorkoutMovementConstraint,
  WorkoutObjective,
  WorkoutPlanningValue,
} from './workout-planning-context.contract';

export type WorkoutBlockType =
  | 'WARM_UP'
  | 'MOBILITY'
  | 'TECHNIQUE'
  | 'STRENGTH'
  | 'HYPERTROPHY'
  | 'SKILL'
  | 'CONDITIONING'
  | 'INTERVAL'
  | 'ENDURANCE'
  | 'CORE'
  | 'COOLDOWN'
  | 'RECOVERY';

export interface WorkoutIntensityPolicy {
  readonly scale: 'RPE' | 'RIR' | 'QUALITATIVE' | 'CONVERSATIONAL_PACE';
  readonly minimum: number | null;
  readonly maximum: number | null;
  readonly qualitativeLevel: 'LIGHT' | 'MODERATE' | 'HIGH';
  readonly exactLoadAllowed: false;
  readonly exactPaceAllowed: false;
  readonly exactPowerAllowed: false;
}

export interface WorkoutProgressionPolicy {
  readonly initialState:
    | 'MAINTAIN'
    | 'PROGRESS'
    | 'REGRESS'
    | 'DELOAD'
    | 'REASSESS'
    | 'PAUSE';
  readonly maximumWeeklyIncreasePercent: number;
  readonly simultaneousVariablesAllowed: 1;
  readonly requiresCompletedSessions: boolean;
  readonly blocksOnSafetyFlag: true;
}

export type WorkoutPersonalizationFactor =
  | 'OBJECTIVE'
  | 'MODALITY'
  | 'EXPERIENCE'
  | 'FREQUENCY'
  | 'DURATION'
  | 'ENVIRONMENT'
  | 'EQUIPMENT'
  | 'LIMITATIONS'
  | 'CONDITIONING'
  | 'INTENSITY_PREFERENCE'
  | 'PROGRESS_EVIDENCE'
  | 'PREVIOUS_PLAN';

export interface WorkoutPlanningStrategy {
  readonly schemaVersion: 2;
  readonly artifactType: WorkoutArtifactType;
  readonly modality: WorkoutModality;
  readonly objective: WorkoutPlanningValue<WorkoutObjective>;
  readonly experience: WorkoutPlanningValue<WorkoutExperienceLevel>;
  readonly sessionCount: number;
  readonly sessionDurationMinutes: WorkoutPlanningValue<number>;
  readonly environment: WorkoutPlanningValue<WorkoutEnvironment>;
  readonly authorizedEquipment: readonly WorkoutEquipment[];
  readonly requiredBlocks: readonly WorkoutBlockType[];
  readonly optionalBlocks: readonly WorkoutBlockType[];
  readonly maximumActivitiesPerSession: number;
  readonly technicalMovementsAllowed: boolean;
  readonly intensityPolicy: WorkoutIntensityPolicy;
  readonly progressionPolicy: WorkoutProgressionPolicy;
  readonly appliedConstraints: readonly WorkoutMovementConstraint[];
  readonly personalizationFactors: readonly WorkoutPersonalizationFactor[];
}
