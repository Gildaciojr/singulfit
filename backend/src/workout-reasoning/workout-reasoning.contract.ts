import type { CoachProfileSnapshot } from '../context/coach-profile-snapshot.contract';
import type { ConversationGoalDecision } from '../context/conversation-goal-planner.contract';
import type {
  WorkoutKnowledgePackage,
  WorkoutKnowledgePackageId,
  WorkoutKnowledgeResolution,
} from '../workout-knowledge/workout-knowledge.contract';
import type {
  WorkoutArtifactType,
  WorkoutModality,
} from '../workout/v2/workout-planning-artifact.contract';

export const WORKOUT_REASONING_SCHEMA_VERSION = 1 as const;
export const WORKOUT_REASONING_STRATEGY_VERSION = '2026.07.1' as const;

export const WORKOUT_REASONING_PRIORITY = {
  CRITICAL: 'CRITICAL',
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW',
  IGNORED: 'IGNORED',
} as const;

export type WorkoutReasoningPriority =
  (typeof WORKOUT_REASONING_PRIORITY)[keyof typeof WORKOUT_REASONING_PRIORITY];

export const WORKOUT_REASONING_OBJECTIVE = {
  SAFETY: 'SAFETY',
  HYPERTROPHY: 'HYPERTROPHY',
  STRENGTH: 'STRENGTH',
  MUSCULAR_ENDURANCE: 'MUSCULAR_ENDURANCE',
  MAINTENANCE: 'MAINTENANCE',
  CONDITIONING: 'CONDITIONING',
  ENDURANCE: 'ENDURANCE',
  MOBILITY: 'MOBILITY',
  ACTIVE_RECOVERY: 'ACTIVE_RECOVERY',
  ADHERENCE: 'ADHERENCE',
  EDUCATION: 'EDUCATION',
} as const;

export type WorkoutReasoningObjective =
  (typeof WORKOUT_REASONING_OBJECTIVE)[keyof typeof WORKOUT_REASONING_OBJECTIVE];

export const WORKOUT_REASONING_STRATEGY = {
  TECHNIQUE_PRIORITY: 'TECHNIQUE_PRIORITY',
  CONSERVATIVE_PROGRESSION: 'CONSERVATIVE_PROGRESSION',
  SINGLE_VARIABLE_PROGRESSION: 'SINGLE_VARIABLE_PROGRESSION',
  MAINTENANCE: 'MAINTENANCE',
  REGRESSION: 'REGRESSION',
  DELOAD: 'DELOAD',
  REASSESSMENT: 'REASSESSMENT',
  SIMPLE_SESSION: 'SIMPLE_SESSION',
  SUSTAINABLE_FREQUENCY: 'SUSTAINABLE_FREQUENCY',
  REDUCED_DURATION: 'REDUCED_DURATION',
  CONTROLLED_VOLUME: 'CONTROLLED_VOLUME',
  PERCEIVED_INTENSITY: 'PERCEIVED_INTENSITY',
  ACTIVE_RECOVERY: 'ACTIVE_RECOVERY',
  REQUIRED_WARM_UP: 'REQUIRED_WARM_UP',
  REQUIRED_MOBILITY: 'REQUIRED_MOBILITY',
  REQUIRED_COOLDOWN: 'REQUIRED_COOLDOWN',
  HYPERTROPHY: 'HYPERTROPHY',
  STRENGTH: 'STRENGTH',
  MUSCULAR_ENDURANCE: 'MUSCULAR_ENDURANCE',
  SIMPLE_SPLIT: 'SIMPLE_SPLIT',
  BASIC_MOVEMENTS: 'BASIC_MOVEMENTS',
  LIMITED_ACCESSORIES: 'LIMITED_ACCESSORIES',
  EXECUTION_BASED_PROGRESSION: 'EXECUTION_BASED_PROGRESSION',
  RESTRICTED_EQUIPMENT: 'RESTRICTED_EQUIPMENT',
  GRADUAL_RUNNING_ADAPTATION: 'GRADUAL_RUNNING_ADAPTATION',
  RUN_WALK: 'RUN_WALK',
  LIGHT_ENDURANCE: 'LIGHT_ENDURANCE',
  AUTHORIZED_INTERVALS: 'AUTHORIZED_INTERVALS',
  DURATION_PROGRESSION: 'DURATION_PROGRESSION',
  CONVERSATIONAL_INTENSITY: 'CONVERSATIONAL_INTENSITY',
  BETWEEN_SESSION_RECOVERY: 'BETWEEN_SESSION_RECOVERY',
  CYCLING_ENDURANCE: 'CYCLING_ENDURANCE',
  TERRAIN_AWARENESS: 'TERRAIN_AWARENESS',
  REQUIRED_SCALING: 'REQUIRED_SCALING',
  TECHNIQUE_BEFORE_INTENSITY: 'TECHNIQUE_BEFORE_INTENSITY',
  SIMPLE_MOVEMENTS: 'SIMPLE_MOVEMENTS',
  COMPATIBLE_CONDITIONING: 'COMPATIBLE_CONDITIONING',
  BODYWEIGHT: 'BODYWEIGHT',
  MOVEMENT_REGRESSIONS: 'MOVEMENT_REGRESSIONS',
  SIMPLE_PROGRESSIONS: 'SIMPLE_PROGRESSIONS',
  SPACE_COMPATIBILITY: 'SPACE_COMPATIBILITY',
  LOW_FRICTION: 'LOW_FRICTION',
  SHORT_SESSIONS: 'SHORT_SESSIONS',
  REALISTIC_FREQUENCY: 'REALISTIC_FREQUENCY',
  REDUCED_COMPLEXITY: 'REDUCED_COMPLEXITY',
  TRAINING_EDUCATION: 'TRAINING_EDUCATION',
  SUSTAINABLE_MOTIVATION: 'SUSTAINABLE_MOTIVATION',
  ENVIRONMENT_COMPATIBILITY: 'ENVIRONMENT_COMPATIBILITY',
  EQUIPMENT_COMPATIBILITY: 'EQUIPMENT_COMPATIBILITY',
} as const;

export type WorkoutReasoningStrategy =
  (typeof WORKOUT_REASONING_STRATEGY)[keyof typeof WORKOUT_REASONING_STRATEGY];

export const WORKOUT_REASONING_PROHIBITION = {
  AGGRESSIVE_PROGRESSION: 'AGGRESSIVE_PROGRESSION',
  MULTIPLE_VARIABLE_INCREASE: 'MULTIPLE_VARIABLE_INCREASE',
  INTENSE_TRAINING_WITH_FEVER: 'INTENSE_TRAINING_WITH_FEVER',
  PAIN_AGGRAVATING_TRAINING: 'PAIN_AGGRAVATING_TRAINING',
  IMPROVISED_REHABILITATION: 'IMPROVISED_REHABILITATION',
  ADVANCED_MOVEMENTS_FOR_BEGINNER: 'ADVANCED_MOVEMENTS_FOR_BEGINNER',
  VOLUME_INCOMPATIBLE_WITH_TIME: 'VOLUME_INCOMPATIBLE_WITH_TIME',
  HIGH_INTENSITY_WITHOUT_EXPERIENCE: 'HIGH_INTENSITY_WITHOUT_EXPERIENCE',
  UNAVAILABLE_EQUIPMENT: 'UNAVAILABLE_EQUIPMENT',
  ADVANCED_RUNNING_WITHOUT_BASE: 'ADVANCED_RUNNING_WITHOUT_BASE',
  ADVANCED_CROSSFIT_WITHOUT_EXPERIENCE: 'ADVANCED_CROSSFIT_WITHOUT_EXPERIENCE',
  EXACT_LOAD_WITHOUT_REFERENCE: 'EXACT_LOAD_WITHOUT_REFERENCE',
  INVENTED_PACE: 'INVENTED_PACE',
  INVENTED_FTP: 'INVENTED_FTP',
  INVENTED_POWER: 'INVENTED_POWER',
  INVENTED_1RM: 'INVENTED_1RM',
  PRECISE_ZONES_WITHOUT_DATA: 'PRECISE_ZONES_WITHOUT_DATA',
  TECHNICAL_TRAINING_IN_INCOMPATIBLE_ENVIRONMENT:
    'TECHNICAL_TRAINING_IN_INCOMPATIBLE_ENVIRONMENT',
  INTENSE_INTERVALS_AFTER_BREAK: 'INTENSE_INTERVALS_AFTER_BREAK',
  ABRUPT_DISTANCE_INCREASE: 'ABRUPT_DISTANCE_INCREASE',
  EXCESSIVE_ACCESSORIES: 'EXCESSIVE_ACCESSORIES',
  LONG_STRUCTURE: 'LONG_STRUCTURE',
  COMPETITION_AS_REFERENCE: 'COMPETITION_AS_REFERENCE',
} as const;

export type WorkoutReasoningProhibition =
  (typeof WORKOUT_REASONING_PROHIBITION)[keyof typeof WORKOUT_REASONING_PROHIBITION];

export const WORKOUT_REASONING_CONFLICT = {
  HYPERTROPHY_LIMITED_TIME: 'HYPERTROPHY_LIMITED_TIME',
  STRENGTH_BEGINNER: 'STRENGTH_BEGINNER',
  RUNNING_RETURN_AFTER_BREAK: 'RUNNING_RETURN_AFTER_BREAK',
  RUNNING_LIMITED_TIME: 'RUNNING_LIMITED_TIME',
  CYCLING_WITHOUT_METRICS: 'CYCLING_WITHOUT_METRICS',
  CROSSFIT_BEGINNER: 'CROSSFIT_BEGINNER',
  HOME_WITHOUT_EQUIPMENT: 'HOME_WITHOUT_EQUIPMENT',
  LOW_ADHERENCE_COMPLEX_PLAN: 'LOW_ADHERENCE_COMPLEX_PLAN',
  SPORT_OBJECTIVE_PHYSICAL_LIMITATION: 'SPORT_OBJECTIVE_PHYSICAL_LIMITATION',
  PROGRESSION_FATIGUE: 'PROGRESSION_FATIGUE',
  INTENSITY_INSUFFICIENT_RECOVERY: 'INTENSITY_INSUFFICIENT_RECOVERY',
  MODALITY_PROFILE_MISMATCH: 'MODALITY_PROFILE_MISMATCH',
  MODALITY_ENVIRONMENT_INCOMPATIBLE: 'MODALITY_ENVIRONMENT_INCOMPATIBLE',
  EXPERIENCE_PROFILE_CONFLICT: 'EXPERIENCE_PROFILE_CONFLICT',
} as const;

export type WorkoutReasoningConflict =
  (typeof WORKOUT_REASONING_CONFLICT)[keyof typeof WORKOUT_REASONING_CONFLICT];

export type WorkoutReasoningRationaleCode =
  | 'KNOWLEDGE_PRIORITY'
  | 'KNOWLEDGE_DEPENDENCY'
  | 'SAFETY_MANDATORY'
  | 'OBJECTIVE_ALIGNMENT'
  | 'MODALITY_ALIGNMENT'
  | 'ARTIFACT_ALIGNMENT'
  | 'EXPERIENCE_BEGINNER'
  | 'EXPERIENCE_INTERMEDIATE'
  | 'EXPERIENCE_ADVANCED'
  | 'EXPERIENCE_UNKNOWN'
  | 'EXPERIENCE_CONFLICT'
  | 'LIMITED_TIME'
  | 'LOW_ADHERENCE'
  | 'HIGH_ADHERENCE'
  | 'RETURN_AFTER_BREAK'
  | 'INSUFFICIENT_RECOVERY'
  | 'SIGNIFICANT_FATIGUE'
  | 'FEVER_SIGNAL'
  | 'ACUTE_PAIN_SIGNAL'
  | 'SIGNIFICANT_MALAISE_SIGNAL'
  | 'REPORTED_INCAPACITY_SIGNAL'
  | 'RECENT_INJURY_SIGNAL'
  | 'REHABILITATION_REQUEST_SIGNAL'
  | 'EXTREME_REQUEST_SIGNAL'
  | 'PHYSICAL_LIMITATION'
  | 'UNCONFIRMED_LIMITATION'
  | 'PROFILE_CONFLICT'
  | 'MODALITY_UNKNOWN'
  | 'MODALITY_CONFLICT'
  | 'NO_EQUIPMENT'
  | 'EQUIPMENT_AVAILABLE'
  | 'ENVIRONMENT_INCOMPATIBLE'
  | 'CONFLICT_RESOLUTION'
  | 'COMPLEXITY_REDUCTION'
  | 'PROGRESSION_ALLOWED'
  | 'PROGRESSION_BLOCKED'
  | 'CLINICAL_BOUNDARY'
  | 'PACKAGE_CONFLICT'
  | 'PACKAGE_REDUCED';

export type WorkoutKnowledgeDisposition =
  | 'REQUIRED'
  | 'ELEVATED'
  | 'KEPT'
  | 'REDUCED'
  | 'DISCARDED';

export interface WorkoutKnowledgeDecision {
  readonly packageId: WorkoutKnowledgePackageId;
  readonly originalPriority: WorkoutKnowledgePackage['priority'];
  readonly resolvedPriority: WorkoutReasoningPriority;
  readonly disposition: WorkoutKnowledgeDisposition;
  readonly rationaleCodes: readonly WorkoutReasoningRationaleCode[];
}

export interface WorkoutReasoningFactor {
  readonly packageId: WorkoutKnowledgePackageId;
  readonly factorCode: string;
  readonly polarity: 'POSITIVE' | 'NEGATIVE';
  readonly priority: WorkoutReasoningPriority;
}

export interface WorkoutDiscardedFactor {
  readonly packageId: WorkoutKnowledgePackageId;
  readonly factorCode: string;
  readonly reasonCode: 'PACKAGE_CONFLICT' | 'PACKAGE_REDUCED';
}

export interface WorkoutReasoningConflictResolution {
  readonly conflict: WorkoutReasoningConflict;
  readonly packageIds: readonly WorkoutKnowledgePackageId[];
  readonly elevatedStrategies: readonly WorkoutReasoningStrategy[];
  readonly reducedStrategies: readonly WorkoutReasoningStrategy[];
  readonly prohibitedStrategies: readonly WorkoutReasoningProhibition[];
  readonly rationaleCodes: readonly WorkoutReasoningRationaleCode[];
}

export interface WorkoutReasoningConstraint {
  readonly code: string;
  readonly enforcement: 'PROHIBIT' | 'REQUIRE' | 'CAUTION';
  readonly sourcePackageIds: readonly WorkoutKnowledgePackageId[];
}

export interface WorkoutSelectedStrategy {
  readonly strategy: WorkoutReasoningStrategy;
  readonly priority: Exclude<WorkoutReasoningPriority, 'IGNORED'>;
  readonly sourcePackageIds: readonly WorkoutKnowledgePackageId[];
  readonly rationaleCodes: readonly WorkoutReasoningRationaleCode[];
}

export interface WorkoutProhibitedStrategy {
  readonly prohibition: WorkoutReasoningProhibition;
  readonly sourcePackageIds: readonly WorkoutKnowledgePackageId[];
  readonly rationaleCodes: readonly WorkoutReasoningRationaleCode[];
}

export type WorkoutExperienceDecision =
  | 'BEGINNER'
  | 'INTERMEDIATE'
  | 'ADVANCED'
  | 'UNKNOWN'
  | 'CONFLICT';

export interface WorkoutReasoningModalityDecision {
  readonly requested: WorkoutModality | null;
  readonly profile: WorkoutModality | null;
  readonly resolved: WorkoutModality | null;
  readonly status: 'CONFIRMED' | 'UNKNOWN' | 'CONFLICT';
  readonly requiresConfirmation: boolean;
}

export type WorkoutInterventionIntensity =
  | 'RECOVERY'
  | 'LOW'
  | 'MODERATE'
  | 'MODERATE_HIGH'
  | 'HIGH'
  | 'BLOCKED';

export type WorkoutComplexityLevel =
  | 'MINIMAL'
  | 'SIMPLE'
  | 'STANDARD'
  | 'DETAILED'
  | 'ADVANCED'
  | 'RESTRICTED';

export type WorkoutProgressionDecision =
  | 'MAINTAIN'
  | 'PROGRESS'
  | 'REGRESS'
  | 'DELOAD'
  | 'REASSESS'
  | 'PAUSE';

export interface WorkoutReasoningPriorities {
  readonly safety: WorkoutReasoningPriority;
  readonly technique: WorkoutReasoningPriority;
  readonly adherence: WorkoutReasoningPriority;
  readonly motivation: WorkoutReasoningPriority;
  readonly education: WorkoutReasoningPriority;
  readonly strength: WorkoutReasoningPriority;
  readonly hypertrophy: WorkoutReasoningPriority;
  readonly endurance: WorkoutReasoningPriority;
  readonly conditioning: WorkoutReasoningPriority;
  readonly mobility: WorkoutReasoningPriority;
  readonly recovery: WorkoutReasoningPriority;
  readonly progression: WorkoutReasoningPriority;
  readonly practicality: WorkoutReasoningPriority;
  readonly equipment: WorkoutReasoningPriority;
  readonly environment: WorkoutReasoningPriority;
}

export interface WorkoutReasoningMetadata {
  readonly schemaVersion: typeof WORKOUT_REASONING_SCHEMA_VERSION;
  readonly strategyVersion: typeof WORKOUT_REASONING_STRATEGY_VERSION;
  readonly knowledgeSchemaVersion: number;
  readonly knowledgeCatalogVersion: string;
  readonly sourcePackageIds: readonly WorkoutKnowledgePackageId[];
  readonly conversationGoal: ConversationGoalDecision['goal'];
  readonly artifactType: WorkoutArtifactType;
  readonly requestedModality: WorkoutModality | null;
  readonly experience: WorkoutExperienceDecision;
  readonly deterministic: true;
  readonly safetyRestricted: boolean;
}

export interface WorkoutReasoningResult {
  readonly primaryObjective: WorkoutReasoningObjective;
  readonly secondaryObjectives: readonly WorkoutReasoningObjective[];
  readonly modality: WorkoutReasoningModalityDecision;
  readonly knowledgeDecisions: readonly WorkoutKnowledgeDecision[];
  readonly activeFactors: readonly WorkoutReasoningFactor[];
  readonly discardedFactors: readonly WorkoutDiscardedFactor[];
  readonly resolvedConflicts: readonly WorkoutReasoningConflictResolution[];
  readonly appliedConstraints: readonly WorkoutReasoningConstraint[];
  readonly selectedStrategies: readonly WorkoutSelectedStrategy[];
  readonly prohibitedStrategies: readonly WorkoutProhibitedStrategy[];
  readonly interventionIntensity: WorkoutInterventionIntensity;
  readonly authorizedComplexity: WorkoutComplexityLevel;
  readonly progressionDecision: WorkoutProgressionDecision;
  readonly priorities: WorkoutReasoningPriorities;
  readonly rationaleCodes: readonly WorkoutReasoningRationaleCode[];
  readonly metadata: WorkoutReasoningMetadata;
}

export interface WorkoutReasoningInput {
  readonly snapshot: CoachProfileSnapshot;
  readonly knowledgeResolution: WorkoutKnowledgeResolution;
  readonly conversationGoal: ConversationGoalDecision;
  readonly artifactType: WorkoutArtifactType;
  readonly recognizedModality: WorkoutModality | null;
}
