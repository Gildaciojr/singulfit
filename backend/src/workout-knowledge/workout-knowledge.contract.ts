export const WORKOUT_KNOWLEDGE_SCHEMA_VERSION = 1 as const;
export const WORKOUT_KNOWLEDGE_CATALOG_VERSION = '2026.07.1' as const;

export type WorkoutKnowledgeFitnessGoal =
  | 'WEIGHT_LOSS'
  | 'MUSCLE_GAIN'
  | 'MAINTENANCE';

export const WORKOUT_KNOWLEDGE_DOMAIN = {
  RESISTANCE_TRAINING: 'RESISTANCE_TRAINING',
  RUNNING: 'RUNNING',
  WALKING: 'WALKING',
  CYCLING: 'CYCLING',
  CROSSFIT: 'CROSSFIT',
  CALISTHENICS: 'CALISTHENICS',
  FUNCTIONAL: 'FUNCTIONAL',
  HOME_TRAINING: 'HOME_TRAINING',
  MOBILITY: 'MOBILITY',
  RECOVERY: 'RECOVERY',
  CARDIO_CONDITIONING: 'CARDIO_CONDITIONING',
  EXPERIENCE: 'EXPERIENCE',
  PROGRESSION: 'PROGRESSION',
  PREPARATION: 'PREPARATION',
  TECHNIQUE: 'TECHNIQUE',
  SAFETY: 'SAFETY',
  EQUIPMENT: 'EQUIPMENT',
  ENVIRONMENT: 'ENVIRONMENT',
  ROUTINE: 'ROUTINE',
  BEHAVIOR: 'BEHAVIOR',
  EDUCATION: 'EDUCATION',
} as const;

export type WorkoutKnowledgeDomain =
  (typeof WORKOUT_KNOWLEDGE_DOMAIN)[keyof typeof WORKOUT_KNOWLEDGE_DOMAIN];

export const WORKOUT_KNOWLEDGE_PACKAGE_ID = {
  TRAINING_FOUNDATION: 'TRAINING_FOUNDATION',
  RESISTANCE_TRAINING: 'RESISTANCE_TRAINING',
  HYPERTROPHY: 'HYPERTROPHY',
  STRENGTH: 'STRENGTH',
  MUSCULAR_ENDURANCE: 'MUSCULAR_ENDURANCE',
  MAINTENANCE: 'MAINTENANCE',
  RUNNING_ADAPTATION: 'RUNNING_ADAPTATION',
  RUNNING_ENDURANCE: 'RUNNING_ENDURANCE',
  WALKING: 'WALKING',
  CYCLING: 'CYCLING',
  CROSSFIT: 'CROSSFIT',
  CALISTHENICS: 'CALISTHENICS',
  FUNCTIONAL: 'FUNCTIONAL',
  HOME_TRAINING: 'HOME_TRAINING',
  MOBILITY: 'MOBILITY',
  ACTIVE_RECOVERY: 'ACTIVE_RECOVERY',
  CARDIO_CONDITIONING: 'CARDIO_CONDITIONING',
  BEGINNER: 'BEGINNER',
  INTERMEDIATE: 'INTERMEDIATE',
  ADVANCED: 'ADVANCED',
  PROGRESSION: 'PROGRESSION',
  DELOAD: 'DELOAD',
  RECOVERY: 'RECOVERY',
  WARM_UP: 'WARM_UP',
  STRETCHING: 'STRETCHING',
  TECHNIQUE: 'TECHNIQUE',
  SAFETY_FOUNDATION: 'SAFETY_FOUNDATION',
  PHYSICAL_LIMITATIONS: 'PHYSICAL_LIMITATIONS',
  EQUIPMENT_AVAILABLE: 'EQUIPMENT_AVAILABLE',
  NO_EQUIPMENT: 'NO_EQUIPMENT',
  ENVIRONMENT: 'ENVIRONMENT',
  WEEKLY_FREQUENCY: 'WEEKLY_FREQUENCY',
  LIMITED_TIME: 'LIMITED_TIME',
  ADHERENCE: 'ADHERENCE',
  MOTIVATION: 'MOTIVATION',
  TRAINING_EDUCATION: 'TRAINING_EDUCATION',
  FEVER_SAFETY: 'FEVER_SAFETY',
  ACUTE_PAIN_SAFETY: 'ACUTE_PAIN_SAFETY',
  SIGNIFICANT_FATIGUE_SAFETY: 'SIGNIFICANT_FATIGUE_SAFETY',
  RETURN_AFTER_BREAK: 'RETURN_AFTER_BREAK',
  VOLUME_CAUTION: 'VOLUME_CAUTION',
  PROGRESSION_CAUTION: 'PROGRESSION_CAUTION',
  INTENSITY_CAUTION: 'INTENSITY_CAUTION',
  EQUIPMENT_COMPATIBILITY: 'EQUIPMENT_COMPATIBILITY',
  ENVIRONMENT_COMPATIBILITY: 'ENVIRONMENT_COMPATIBILITY',
  CLINICAL_SAFETY_BOUNDARY: 'CLINICAL_SAFETY_BOUNDARY',
} as const;

export type WorkoutKnowledgePackageId =
  (typeof WORKOUT_KNOWLEDGE_PACKAGE_ID)[keyof typeof WORKOUT_KNOWLEDGE_PACKAGE_ID];

export type WorkoutKnowledgePriority =
  | 'CRITICAL'
  | 'HIGH'
  | 'STANDARD'
  | 'SUPPORTING';

export type WorkoutKnowledgeStringFact =
  | 'MODALITY'
  | 'EXPERIENCE'
  | 'ENVIRONMENT'
  | 'DESIRED_OUTCOME'
  | 'SAFETY_SIGNAL'
  | 'PERCEIVED_CONDITIONING'
  | 'INTENSITY_PREFERENCE';

export type WorkoutKnowledgeBooleanFact =
  | 'RETURNING_AFTER_BREAK'
  | 'HAS_LIMITATIONS'
  | 'HAS_EQUIPMENT'
  | 'NO_EQUIPMENT'
  | 'HAS_ENVIRONMENT'
  | 'HAS_WEEKLY_FREQUENCY'
  | 'HIGH_WEEKLY_FREQUENCY'
  | 'LIMITED_TIME'
  | 'HAS_ADHERENCE_CONTEXT'
  | 'HAS_MOTIVATION_CONTEXT'
  | 'HAS_CLINICAL_CONTEXT'
  | 'BEGINNER_HIGH_INTENSITY';

export type WorkoutKnowledgeCondition =
  | Readonly<{ fact: 'ALWAYS'; operator: 'ALWAYS' }>
  | Readonly<{
      fact: 'PRIMARY_GOAL';
      operator: 'EQUALS';
      value: WorkoutKnowledgeFitnessGoal;
    }>
  | Readonly<{
      fact: WorkoutKnowledgeStringFact;
      operator: 'CONTAINS_ANY';
      values: readonly string[];
    }>
  | Readonly<{
      fact: WorkoutKnowledgeBooleanFact;
      operator: 'IS';
      value: boolean;
    }>;

export interface WorkoutKnowledgeApplicability {
  readonly match: 'ALL' | 'ANY';
  readonly conditions: readonly WorkoutKnowledgeCondition[];
}

export interface WorkoutKnowledgeFactor {
  readonly code: string;
  readonly principle: string;
}

export interface WorkoutEducationalMessage {
  readonly code: string;
  readonly learningObjective: string;
  readonly keyPoints: readonly string[];
}

export interface WorkoutKnowledgeLimit {
  readonly code: string;
  readonly enforcement: 'PROHIBIT' | 'REQUIRE' | 'CAUTION';
  readonly description: string;
}

export interface WorkoutKnowledgeEvidenceReference {
  readonly code: string;
  readonly authority: string;
  readonly scope: string;
}

export interface WorkoutKnowledgePackage {
  readonly schemaVersion: typeof WORKOUT_KNOWLEDGE_SCHEMA_VERSION;
  readonly catalogVersion: typeof WORKOUT_KNOWLEDGE_CATALOG_VERSION;
  readonly packageVersion: number;
  readonly id: WorkoutKnowledgePackageId;
  readonly domain: WorkoutKnowledgeDomain;
  readonly objective: string;
  readonly priority: WorkoutKnowledgePriority;
  readonly whenToApply: WorkoutKnowledgeApplicability;
  readonly whenNotToApply: WorkoutKnowledgeApplicability;
  readonly dependencyPackageIds: readonly WorkoutKnowledgePackageId[];
  readonly conflictingPackageIds: readonly WorkoutKnowledgePackageId[];
  readonly positiveFactors: readonly WorkoutKnowledgeFactor[];
  readonly negativeFactors: readonly WorkoutKnowledgeFactor[];
  readonly educationalMessages: readonly WorkoutEducationalMessage[];
  readonly limits: readonly WorkoutKnowledgeLimit[];
  readonly evidenceReferences: readonly WorkoutKnowledgeEvidenceReference[];
}

export interface WorkoutKnowledgeMatchedFact {
  readonly packageId: WorkoutKnowledgePackageId;
  readonly facts: readonly (
    | WorkoutKnowledgeStringFact
    | WorkoutKnowledgeBooleanFact
    | 'PRIMARY_GOAL'
    | 'ALWAYS'
  )[];
}

export interface WorkoutKnowledgeResolution {
  readonly schemaVersion: typeof WORKOUT_KNOWLEDGE_SCHEMA_VERSION;
  readonly catalogVersion: typeof WORKOUT_KNOWLEDGE_CATALOG_VERSION;
  readonly packages: readonly WorkoutKnowledgePackage[];
  readonly packageIds: readonly WorkoutKnowledgePackageId[];
  readonly matchedFacts: readonly WorkoutKnowledgeMatchedFact[];
  readonly safetyRestricted: boolean;
}
