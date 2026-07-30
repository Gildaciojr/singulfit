import type { CoachProfileSnapshot } from '../context/coach-profile-snapshot.contract';

export const LONGITUDINAL_COACHING_SCHEMA_VERSION = 1 as const;
export const LONGITUDINAL_COACHING_POLICY_VERSION = '2026.07.1' as const;

export const LONGITUDINAL_COACHING_STATE = {
  IMPROVING: 'IMPROVING',
  STABLE: 'STABLE',
  PLATEAU: 'PLATEAU',
  REGRESSING: 'REGRESSING',
  UNKNOWN: 'UNKNOWN',
} as const;

export type LongitudinalCoachingState =
  (typeof LONGITUDINAL_COACHING_STATE)[keyof typeof LONGITUDINAL_COACHING_STATE];

export const LONGITUDINAL_COACHING_DECISION = {
  KEEP_PLAN: 'KEEP_PLAN',
  ADAPT_PLAN: 'ADAPT_PLAN',
  REVIEW: 'REVIEW',
  DELOAD: 'DELOAD',
  INCREASE: 'INCREASE',
  REDUCE: 'REDUCE',
  WAIT: 'WAIT',
  ASK_INFORMATION: 'ASK_INFORMATION',
} as const;

export type LongitudinalCoachingAction =
  (typeof LONGITUDINAL_COACHING_DECISION)[keyof typeof LONGITUDINAL_COACHING_DECISION];

export const LONGITUDINAL_TREND = {
  IMPROVING: 'IMPROVING',
  STABLE: 'STABLE',
  DECLINING: 'DECLINING',
  UNKNOWN: 'UNKNOWN',
} as const;

export type LongitudinalTrend =
  (typeof LONGITUDINAL_TREND)[keyof typeof LONGITUDINAL_TREND];

export const LONGITUDINAL_WEIGHT_TREND = {
  INCREASING: 'INCREASING',
  STABLE: 'STABLE',
  DECREASING: 'DECREASING',
  UNKNOWN: 'UNKNOWN',
} as const;

export type LongitudinalWeightTrend =
  (typeof LONGITUDINAL_WEIGHT_TREND)[keyof typeof LONGITUDINAL_WEIGHT_TREND];

export const LONGITUDINAL_STABILITY = {
  STABLE: 'STABLE',
  VARIABLE: 'VARIABLE',
  UNSTABLE: 'UNSTABLE',
  UNKNOWN: 'UNKNOWN',
} as const;

export type LongitudinalStability =
  (typeof LONGITUDINAL_STABILITY)[keyof typeof LONGITUDINAL_STABILITY];

export const LONGITUDINAL_LEVEL = {
  HIGH: 'HIGH',
  MODERATE: 'MODERATE',
  LOW: 'LOW',
  UNKNOWN: 'UNKNOWN',
} as const;

export type LongitudinalLevel =
  (typeof LONGITUDINAL_LEVEL)[keyof typeof LONGITUDINAL_LEVEL];

export const LONGITUDINAL_PRIORITY = {
  CRITICAL: 'CRITICAL',
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW',
  NONE: 'NONE',
} as const;

export type LongitudinalPriority =
  (typeof LONGITUDINAL_PRIORITY)[keyof typeof LONGITUDINAL_PRIORITY];

export const LONGITUDINAL_INTERVENTION_INTENSITY = {
  MINIMAL: 'MINIMAL',
  LOW: 'LOW',
  MODERATE: 'MODERATE',
  HIGH: 'HIGH',
  RESTRICTED: 'RESTRICTED',
} as const;

export type LongitudinalInterventionIntensity =
  (typeof LONGITUDINAL_INTERVENTION_INTENSITY)[keyof typeof LONGITUDINAL_INTERVENTION_INTENSITY];

export type LongitudinalEvidenceStrength =
  | 'INSUFFICIENT'
  | 'LIMITED'
  | 'SUFFICIENT'
  | 'STRONG';

export type LongitudinalSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type LongitudinalPlanDomain = 'NUTRITION' | 'WORKOUT';

export type LongitudinalPlanObjective =
  | 'WEIGHT_LOSS'
  | 'HYPERTROPHY'
  | 'MAINTENANCE'
  | 'HEALTH'
  | 'OTHER';

export type LongitudinalEnergyLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export type LongitudinalTrainingModality =
  | 'STRENGTH_TRAINING'
  | 'RUNNING'
  | 'WALKING'
  | 'CYCLING'
  | 'CROSSFIT'
  | 'FUNCTIONAL'
  | 'CALISTHENICS'
  | 'MOBILITY'
  | 'ACTIVE_RECOVERY'
  | 'GENERAL_FITNESS'
  | 'UNKNOWN';

export type LongitudinalRationaleCode =
  | 'SUFFICIENT_HISTORY'
  | 'INSUFFICIENT_HISTORY'
  | 'NEW_ACTIVE_PLAN'
  | 'CONSISTENT_IMPROVEMENT'
  | 'STABLE_EVOLUTION'
  | 'PROLONGED_PLATEAU'
  | 'REGRESSION_DETECTED'
  | 'LONG_INTERRUPTION'
  | 'HIGH_ADHERENCE'
  | 'LOW_ADHERENCE'
  | 'ADHERENCE_DECLINING'
  | 'ADHERENCE_IMPROVING'
  | 'LOW_MOTIVATION'
  | 'POOR_RECOVERY'
  | 'NUTRITION_IMPROVING'
  | 'NUTRITION_DECLINING'
  | 'HYDRATION_DECLINING'
  | 'TRAINING_IMPROVING'
  | 'TRAINING_DECLINING'
  | 'WEIGHT_GOAL_ALIGNED'
  | 'WEIGHT_GOAL_DIVERGING'
  | 'MUSCLE_PROGRESS'
  | 'MAINTENANCE_ALIGNED'
  | 'RELAPSE_DETECTED'
  | 'REPEATED_ADAPTATION'
  | 'CLINICAL_CONTEXT'
  | 'ACUTE_PAIN'
  | 'FEVER'
  | 'REHABILITATION_CONTEXT'
  | 'PHYSICAL_INCAPACITY'
  | 'SAFETY_PRECEDENCE'
  | 'NO_AUTOMATIC_ADAPTATION'
  | 'TRAINING_MODALITY_CONTEXT'
  | 'DETERMINISTIC_POLICY';

export type LongitudinalRiskCode =
  | 'INSUFFICIENT_DATA'
  | 'LOW_ADHERENCE'
  | 'ADHERENCE_DECLINE'
  | 'PROLONGED_INTERRUPTION'
  | 'PLATEAU'
  | 'REGRESSION'
  | 'RELAPSE'
  | 'POOR_RECOVERY'
  | 'CLINICAL_BOUNDARY'
  | 'ACUTE_PAIN'
  | 'FEVER'
  | 'REHABILITATION'
  | 'PHYSICAL_INCAPACITY';

export interface LongitudinalHistoryObservation {
  readonly observedAt: string;
  readonly adherenceScore?: number;
  readonly consistencyScore?: number;
  readonly hydrationScore?: number;
  readonly nutritionScore?: number;
  readonly trainingFrequency?: number;
  readonly trainingCompletionScore?: number;
  readonly goalProgressScore?: number;
  readonly nutritionDirection?: Exclude<LongitudinalTrend, 'UNKNOWN'>;
  readonly goalProgressDirection?: Exclude<LongitudinalTrend, 'UNKNOWN'>;
  readonly relapseSeverity?: Exclude<LongitudinalSeverity, 'CRITICAL'>;
}

export interface LongitudinalProgressObservation {
  readonly observedAt: string;
  readonly weightKg: number;
  readonly bodyFatPercent?: number;
  readonly muscleMassKg?: number;
  readonly bmi?: number;
}

export interface LongitudinalFitnessCheckInObservation {
  readonly observedAt: string;
  readonly energyLevel: LongitudinalEnergyLevel;
  readonly adherenceScore: number;
}

export interface LongitudinalActivePlanReference {
  readonly domain: LongitudinalPlanDomain;
  readonly objective: LongitudinalPlanObjective;
  readonly generatedAt: string;
  readonly modality?: LongitudinalTrainingModality;
}

export interface PreviousLongitudinalDecisionReference {
  readonly decidedAt: string;
  readonly state: LongitudinalCoachingState;
  readonly decision: LongitudinalCoachingAction;
}

export interface LongitudinalSafetySignals {
  readonly clinicalContext: boolean;
  readonly acutePain: boolean;
  readonly fever: boolean;
  readonly rehabilitation: boolean;
  readonly poorRecovery: boolean;
  readonly physicalIncapacity: boolean;
}

export interface LongitudinalTrendProfile {
  readonly weight: LongitudinalWeightTrend;
  readonly frequency: LongitudinalTrend;
  readonly adherence: LongitudinalTrend;
  readonly hydration: LongitudinalTrend;
  readonly nutrition: LongitudinalTrend;
  readonly training: LongitudinalTrend;
  readonly evolution: LongitudinalTrend;
}

export interface LongitudinalProgressAssessment {
  readonly trend: LongitudinalTrend;
  readonly evidenceStrength: LongitudinalEvidenceStrength;
  readonly observationSpanDays: number;
  readonly observationCount: number;
}

export interface LongitudinalRegressionAssessment {
  readonly detected: boolean;
  readonly severity: LongitudinalSeverity | null;
}

export interface LongitudinalRelapseAssessment {
  readonly detected: boolean;
  readonly severity: Exclude<LongitudinalSeverity, 'CRITICAL'> | null;
}

export interface LongitudinalAdherenceAssessment {
  readonly level: LongitudinalLevel;
  readonly score: number | null;
  readonly trend: LongitudinalTrend;
}

export interface LongitudinalMotivationAssessment {
  readonly level: LongitudinalLevel;
  readonly trend: LongitudinalTrend;
}

export interface LongitudinalAdaptationNeeds {
  readonly adaptation: boolean;
  readonly reassessment: boolean;
  readonly deload: boolean;
  readonly maintenance: boolean;
  readonly information: boolean;
}

export interface LongitudinalDomainPriorities {
  readonly nutrition: LongitudinalPriority;
  readonly training: LongitudinalPriority;
  readonly behavioral: LongitudinalPriority;
  readonly safety: LongitudinalPriority;
}

export interface LongitudinalRisk {
  readonly code: LongitudinalRiskCode;
  readonly severity: LongitudinalSeverity;
  readonly domain: 'GENERAL' | 'NUTRITION' | 'TRAINING' | 'BEHAVIOR' | 'SAFETY';
}

export interface LongitudinalCoachingMetadata {
  readonly schemaVersion: typeof LONGITUDINAL_COACHING_SCHEMA_VERSION;
  readonly policyVersion: typeof LONGITUDINAL_COACHING_POLICY_VERSION;
  readonly referenceDate: string;
  readonly historyObservations: number;
  readonly progressObservations: number;
  readonly checkInObservations: number;
  readonly activePlans: number;
  readonly previousDecisions: number;
  readonly deterministic: true;
}

export interface LongitudinalCoachingDecision {
  readonly currentState: LongitudinalCoachingState;
  readonly trends: LongitudinalTrendProfile;
  readonly stability: LongitudinalStability;
  readonly progress: LongitudinalProgressAssessment;
  readonly regression: LongitudinalRegressionAssessment;
  readonly relapse: LongitudinalRelapseAssessment;
  readonly adherence: LongitudinalAdherenceAssessment;
  readonly motivation: LongitudinalMotivationAssessment;
  readonly needs: LongitudinalAdaptationNeeds;
  readonly decision: LongitudinalCoachingAction;
  readonly priorities: LongitudinalDomainPriorities;
  readonly risks: readonly LongitudinalRisk[];
  readonly interventionIntensity: LongitudinalInterventionIntensity;
  readonly rationaleCodes: readonly LongitudinalRationaleCode[];
  readonly metadata: LongitudinalCoachingMetadata;
}

export interface LongitudinalCoachingInput {
  readonly snapshot: CoachProfileSnapshot;
  readonly history: readonly LongitudinalHistoryObservation[];
  readonly progressSnapshots: readonly LongitudinalProgressObservation[];
  readonly fitnessCheckIns: readonly LongitudinalFitnessCheckInObservation[];
  readonly activePlans: readonly LongitudinalActivePlanReference[];
  readonly previousDecisions: readonly PreviousLongitudinalDecisionReference[];
  readonly safetySignals: LongitudinalSafetySignals;
}
