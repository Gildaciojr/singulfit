import type { FitnessGoal } from '@prisma/client';
import type { CoachProfileSnapshot } from '../context/coach-profile-snapshot.contract';
import type { NutritionArtifactType } from '../diet/v2/nutrition-planning-artifact.contract';

export const NUTRITION_KNOWLEDGE_SCHEMA_VERSION = 1 as const;
export const NUTRITION_KNOWLEDGE_CATALOG_VERSION = '2026.08.1' as const;

export const NUTRITION_KNOWLEDGE_DOMAIN = {
  HEALTHY_EATING: 'HEALTHY_EATING',
  BODY_COMPOSITION: 'BODY_COMPOSITION',
  WEIGHT_LOSS: 'WEIGHT_LOSS',
  HYPERTROPHY: 'HYPERTROPHY',
  MAINTENANCE: 'MAINTENANCE',
  SPORTS_NUTRITION: 'SPORTS_NUTRITION',
  BEHAVIOR: 'BEHAVIOR',
  MEAL_TIMING: 'MEAL_TIMING',
  HYDRATION: 'HYDRATION',
  FOOD_SUBSTITUTION: 'FOOD_SUBSTITUTION',
  SAFETY: 'SAFETY',
  CLINICAL_RESTRICTIONS: 'CLINICAL_RESTRICTIONS',
  SPECIAL_POPULATIONS: 'SPECIAL_POPULATIONS',
  FOOD_BUDGET: 'FOOD_BUDGET',
  ROUTINE: 'ROUTINE',
  PREFERENCES: 'PREFERENCES',
  NUTRITION_EDUCATION: 'NUTRITION_EDUCATION',
} as const;

export type NutritionKnowledgeDomain =
  (typeof NUTRITION_KNOWLEDGE_DOMAIN)[keyof typeof NUTRITION_KNOWLEDGE_DOMAIN];

export const NUTRITION_KNOWLEDGE_PACKAGE_ID = {
  HEALTHY_EATING_FOUNDATION: 'HEALTHY_EATING_FOUNDATION',
  NUTRITION_EDUCATION_FOUNDATION: 'NUTRITION_EDUCATION_FOUNDATION',
  WEIGHT_LOSS: 'WEIGHT_LOSS',
  HYPERTROPHY: 'HYPERTROPHY',
  MAINTENANCE: 'MAINTENANCE',
  SPORTS_NUTRITION_FOUNDATION: 'SPORTS_NUTRITION_FOUNDATION',
  RUNNING: 'RUNNING',
  CROSSFIT: 'CROSSFIT',
  CYCLING: 'CYCLING',
  VEGETARIAN: 'VEGETARIAN',
  VEGAN: 'VEGAN',
  LACTOSE_INTOLERANCE: 'LACTOSE_INTOLERANCE',
  GLUTEN_RESTRICTION: 'GLUTEN_RESTRICTION',
  FOOD_RESTRICTION_SAFETY: 'FOOD_RESTRICTION_SAFETY',
  FOOD_SUBSTITUTION: 'FOOD_SUBSTITUTION',
  BUDGET_LOW: 'BUDGET_LOW',
  BUDGET_MEDIUM: 'BUDGET_MEDIUM',
  BUDGET_HIGH: 'BUDGET_HIGH',
  LIMITED_COOKING_TIME: 'LIMITED_COOKING_TIME',
  MEALS_AWAY_FROM_HOME: 'MEALS_AWAY_FROM_HOME',
  MEAL_TIMING: 'MEAL_TIMING',
  HYDRATION: 'HYDRATION',
  FOOD_PREFERENCES: 'FOOD_PREFERENCES',
  FOOD_REJECTIONS: 'FOOD_REJECTIONS',
  BEHAVIOR_ADHERENCE: 'BEHAVIOR_ADHERENCE',
  CLINICAL_SAFETY_BOUNDARY: 'CLINICAL_SAFETY_BOUNDARY',
  SPECIAL_POPULATION_BOUNDARY: 'SPECIAL_POPULATION_BOUNDARY',
  BODY_RECOMPOSITION: 'BODY_RECOMPOSITION',
  MUSCLE_PRESERVING_CUT: 'MUSCLE_PRESERVING_CUT',
  CONTROLLED_BULKING: 'CONTROLLED_BULKING',
  STRENGTH_NUTRITION: 'STRENGTH_NUTRITION',
  FUNCTIONAL_TRAINING_NUTRITION: 'FUNCTIONAL_TRAINING_NUTRITION',
  HIIT_NUTRITION: 'HIIT_NUTRITION',
  ENDURANCE_NUTRITION: 'ENDURANCE_NUTRITION',
  HYBRID_TRAINING_NUTRITION: 'HYBRID_TRAINING_NUTRITION',
  BEGINNER_NUTRITION_GUIDANCE: 'BEGINNER_NUTRITION_GUIDANCE',
  INTERMEDIATE_NUTRITION_GUIDANCE: 'INTERMEDIATE_NUTRITION_GUIDANCE',
  ADVANCED_NUTRITION_GUIDANCE: 'ADVANCED_NUTRITION_GUIDANCE',
  PRE_WORKOUT_NUTRITION: 'PRE_WORKOUT_NUTRITION',
  INTRA_WORKOUT_NUTRITION: 'INTRA_WORKOUT_NUTRITION',
  POST_WORKOUT_RECOVERY: 'POST_WORKOUT_RECOVERY',
  TRAINING_DAY_CARBOHYDRATE_SUPPORT: 'TRAINING_DAY_CARBOHYDRATE_SUPPORT',
  PROTEIN_DISTRIBUTION_EDUCATION: 'PROTEIN_DISTRIBUTION_EDUCATION',
  HYDRATION_INSUFFICIENCY: 'HYDRATION_INSUFFICIENCY',
  ELECTROLYTE_CAUTION: 'ELECTROLYTE_CAUTION',
  MULTIPLE_FOOD_CONSTRAINTS: 'MULTIPLE_FOOD_CONSTRAINTS',
  LOW_ADHERENCE_SUPPORT: 'LOW_ADHERENCE_SUPPORT',
  HIGH_ADHERENCE_AUTONOMY: 'HIGH_ADHERENCE_AUTONOMY',
  ADOLESCENT_SAFETY: 'ADOLESCENT_SAFETY',
  OLDER_ADULT_SAFETY: 'OLDER_ADULT_SAFETY',
  PREGNANCY_SAFETY: 'PREGNANCY_SAFETY',
  DIABETES_SAFETY: 'DIABETES_SAFETY',
  HYPERTENSION_SAFETY: 'HYPERTENSION_SAFETY',
  RENAL_CONDITION_SAFETY: 'RENAL_CONDITION_SAFETY',
  HEPATIC_CONDITION_SAFETY: 'HEPATIC_CONDITION_SAFETY',
  SEVERE_OBESITY_SAFETY: 'SEVERE_OBESITY_SAFETY',
} as const;

export type NutritionKnowledgePackageId =
  (typeof NUTRITION_KNOWLEDGE_PACKAGE_ID)[keyof typeof NUTRITION_KNOWLEDGE_PACKAGE_ID];

export type NutritionKnowledgePriority =
  | 'CRITICAL'
  | 'HIGH'
  | 'STANDARD'
  | 'SUPPORTING';

export type NutritionKnowledgeStringFact =
  | 'TRAINING_MODALITY'
  | 'DIETARY_PATTERN'
  | 'FOOD_CONSTRAINT'
  | 'FOOD_BUDGET'
  | 'COOKING_AVAILABILITY'
  | 'EATING_OUT_FREQUENCY'
  | 'HYDRATION'
  | 'EXPERIENCE_LEVEL'
  | 'DESIRED_OUTCOME'
  | 'TRAINING_TIME'
  | 'MEAL_TIMING_PATTERN'
  | 'ACTIVITY_LEVEL'
  | 'MEDICAL_CONTEXT'
  | 'TRAINING_INTENSITY';

export type NutritionKnowledgeNumberFact = 'SESSION_DURATION_MINUTES';

export type NutritionKnowledgeBooleanFact =
  | 'HAS_FOOD_CONSTRAINTS'
  | 'HAS_FOOD_PREFERENCES'
  | 'HAS_FOOD_REJECTIONS'
  | 'HAS_MEAL_TIMES'
  | 'HAS_TRAINING_TIME'
  | 'MEALS_AWAY_FROM_HOME'
  | 'HAS_ADHERENCE_CONTEXT'
  | 'HAS_MEDICAL_CONTEXT'
  | 'IS_SPECIAL_POPULATION'
  | 'HAS_MULTIPLE_RESTRICTIONS'
  | 'IS_BEGINNER'
  | 'IS_INTERMEDIATE'
  | 'IS_ADVANCED'
  | 'IS_ADOLESCENT'
  | 'IS_OLDER_ADULT'
  | 'IS_PREGNANT'
  | 'HAS_DIABETES_CONTEXT'
  | 'HAS_HYPERTENSION_CONTEXT'
  | 'HAS_RENAL_CONTEXT'
  | 'HAS_HEPATIC_CONTEXT'
  | 'HAS_SEVERE_OBESITY_CONTEXT'
  | 'HAS_LOW_ADHERENCE'
  | 'HAS_HIGH_ADHERENCE'
  | 'HAS_LIMITED_COOKING_TIME'
  | 'EATS_OUT_FREQUENTLY'
  | 'HAS_LOW_BUDGET'
  | 'HAS_INADEQUATE_HYDRATION'
  | 'HAS_ADEQUATE_HYDRATION';

export type NutritionKnowledgeCondition =
  | {
      readonly fact: 'ALWAYS';
      readonly operator: 'ALWAYS';
    }
  | {
      readonly fact: 'PRIMARY_GOAL';
      readonly operator: 'EQUALS';
      readonly value: FitnessGoal;
    }
  | {
      readonly fact: NutritionKnowledgeStringFact;
      readonly operator: 'CONTAINS_ANY';
      readonly values: readonly string[];
    }
  | {
      readonly fact: NutritionKnowledgeBooleanFact;
      readonly operator: 'IS';
      readonly value: boolean;
    }
  | {
      readonly fact: NutritionKnowledgeNumberFact;
      readonly operator: 'GREATER_THAN_OR_EQUAL' | 'LESS_THAN_OR_EQUAL';
      readonly value: number;
    };

export interface NutritionKnowledgeApplicability {
  readonly match: 'ALL' | 'ANY';
  readonly conditions: readonly NutritionKnowledgeCondition[];
}

export interface NutritionKnowledgeFactor {
  readonly code: string;
  readonly principle: string;
}

export interface NutritionEducationalMessage {
  readonly code: string;
  readonly learningObjective: string;
  readonly keyPoints: readonly string[];
}

export interface NutritionKnowledgeLimit {
  readonly code: string;
  readonly enforcement: 'PROHIBIT' | 'REQUIRE' | 'CAUTION';
  readonly description: string;
}

export interface NutritionKnowledgeEvidenceReference {
  readonly code: string;
  readonly authority: string;
  readonly scope: string;
}

export interface NutritionKnowledgePackage {
  readonly schemaVersion: typeof NUTRITION_KNOWLEDGE_SCHEMA_VERSION;
  readonly catalogVersion: typeof NUTRITION_KNOWLEDGE_CATALOG_VERSION;
  readonly packageVersion: number;
  readonly id: NutritionKnowledgePackageId;
  readonly domain: NutritionKnowledgeDomain;
  readonly objective: string;
  readonly priority: NutritionKnowledgePriority;
  readonly whenToApply: NutritionKnowledgeApplicability;
  readonly whenNotToApply: NutritionKnowledgeApplicability;
  readonly conflictingPackageIds: readonly NutritionKnowledgePackageId[];
  readonly dependencyPackageIds: readonly NutritionKnowledgePackageId[];
  readonly positiveFactors: readonly NutritionKnowledgeFactor[];
  readonly negativeFactors: readonly NutritionKnowledgeFactor[];
  readonly educationalMessages: readonly NutritionEducationalMessage[];
  readonly limits: readonly NutritionKnowledgeLimit[];
  readonly evidenceReferences: readonly NutritionKnowledgeEvidenceReference[];
}

export interface NutritionKnowledgeMatchedFact {
  readonly packageId: NutritionKnowledgePackageId;
  readonly facts: readonly (
    | NutritionKnowledgeStringFact
    | NutritionKnowledgeBooleanFact
    | NutritionKnowledgeNumberFact
    | 'PRIMARY_GOAL'
    | 'ALWAYS'
  )[];
}

export interface NutritionKnowledgeResolution {
  readonly schemaVersion: typeof NUTRITION_KNOWLEDGE_SCHEMA_VERSION;
  readonly catalogVersion: typeof NUTRITION_KNOWLEDGE_CATALOG_VERSION;
  readonly packages: readonly NutritionKnowledgePackage[];
  readonly packageIds: readonly NutritionKnowledgePackageId[];
  readonly matchedFacts: readonly NutritionKnowledgeMatchedFact[];
  readonly safetyRestricted: boolean;
}

/** Future adapter boundary; it is intentionally not consumed by Nutrition V2 yet. */
export interface NutritionKnowledgeStrategyInput {
  readonly snapshot: CoachProfileSnapshot;
  readonly knowledgePackages: readonly NutritionKnowledgePackage[];
  readonly artifactType: NutritionArtifactType;
}
