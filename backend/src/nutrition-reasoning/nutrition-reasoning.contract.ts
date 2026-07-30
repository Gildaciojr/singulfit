import type { CoachProfileSnapshot } from '../context/coach-profile-snapshot.contract';
import type { ConversationGoalDecision } from '../context/conversation-goal-planner.contract';
import type { NutritionArtifactType } from '../diet/v2/nutrition-planning-artifact.contract';
import type {
  NutritionKnowledgePackage,
  NutritionKnowledgePackageId,
} from '../nutrition-knowledge/nutrition-knowledge.contract';

export const NUTRITION_REASONING_SCHEMA_VERSION = 1 as const;
export const NUTRITION_REASONING_STRATEGY_VERSION = '2026.07.1' as const;

export const NUTRITION_REASONING_PRIORITY = {
  CRITICAL: 'CRITICAL',
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW',
  IGNORED: 'IGNORED',
} as const;

export type NutritionReasoningPriority =
  (typeof NUTRITION_REASONING_PRIORITY)[keyof typeof NUTRITION_REASONING_PRIORITY];

export const NUTRITION_REASONING_OBJECTIVE = {
  SAFETY: 'SAFETY',
  WEIGHT_REDUCTION: 'WEIGHT_REDUCTION',
  MUSCLE_DEVELOPMENT: 'MUSCLE_DEVELOPMENT',
  WEIGHT_MAINTENANCE: 'WEIGHT_MAINTENANCE',
  ADHERENCE: 'ADHERENCE',
  PERFORMANCE: 'PERFORMANCE',
  RECOVERY: 'RECOVERY',
  SATIETY: 'SATIETY',
  PRACTICALITY: 'PRACTICALITY',
  ECONOMY: 'ECONOMY',
  NUTRITION_EDUCATION: 'NUTRITION_EDUCATION',
} as const;

export type NutritionReasoningObjective =
  (typeof NUTRITION_REASONING_OBJECTIVE)[keyof typeof NUTRITION_REASONING_OBJECTIVE];

export const NUTRITION_REASONING_STRATEGY = {
  ENERGY_BALANCE: 'ENERGY_BALANCE',
  PROTEIN_PRIORITY: 'PROTEIN_PRIORITY',
  PROTEIN_DISTRIBUTION: 'PROTEIN_DISTRIBUTION',
  ENERGY_DENSITY: 'ENERGY_DENSITY',
  SATIETY_SUPPORT: 'SATIETY_SUPPORT',
  PRACTICAL_MEALS: 'PRACTICAL_MEALS',
  QUICK_MEALS: 'QUICK_MEALS',
  CONTROLLED_VARIETY: 'CONTROLLED_VARIETY',
  EXTENSIVE_VARIETY: 'EXTENSIVE_VARIETY',
  RECOVERY_SUPPORT: 'RECOVERY_SUPPORT',
  HYDRATION_SUPPORT: 'HYDRATION_SUPPORT',
  SPORTS_FUELING: 'SPORTS_FUELING',
  FOOD_SUBSTITUTION: 'FOOD_SUBSTITUTION',
  NUTRITION_EDUCATION: 'NUTRITION_EDUCATION',
  ECONOMIC_SELECTION: 'ECONOMIC_SELECTION',
  ROUTINE_ALIGNMENT: 'ROUTINE_ALIGNMENT',
  EATING_OUT_NAVIGATION: 'EATING_OUT_NAVIGATION',
  BEHAVIOR_ADHERENCE: 'BEHAVIOR_ADHERENCE',
  CONSTRAINT_PRESERVATION: 'CONSTRAINT_PRESERVATION',
  SOPHISTICATED_RECIPES: 'SOPHISTICATED_RECIPES',
  HIGH_COST_DEFAULTS: 'HIGH_COST_DEFAULTS',
  CLINICAL_PROTOCOL: 'CLINICAL_PROTOCOL',
  AGGRESSIVE_RESTRICTION: 'AGGRESSIVE_RESTRICTION',
} as const;

export type NutritionReasoningStrategy =
  (typeof NUTRITION_REASONING_STRATEGY)[keyof typeof NUTRITION_REASONING_STRATEGY];

export const NUTRITION_REASONING_CONFLICT = {
  HYPERTROPHY_LOW_BUDGET: 'HYPERTROPHY_LOW_BUDGET',
  WEIGHT_LOSS_EATING_OUT_LOW_ADHERENCE: 'WEIGHT_LOSS_EATING_OUT_LOW_ADHERENCE',
  CROSSFIT_LIMITED_TIME: 'CROSSFIT_LIMITED_TIME',
  RUNNING_INADEQUATE_HYDRATION: 'RUNNING_INADEQUATE_HYDRATION',
  VEGAN_PROTEIN: 'VEGAN_PROTEIN',
  REJECTIONS_LOW_BUDGET: 'REJECTIONS_LOW_BUDGET',
  PRACTICALITY_VARIETY: 'PRACTICALITY_VARIETY',
} as const;

export type NutritionReasoningConflict =
  (typeof NUTRITION_REASONING_CONFLICT)[keyof typeof NUTRITION_REASONING_CONFLICT];

export type NutritionReasoningReasonCode =
  | 'KNOWLEDGE_PRIORITY'
  | 'KNOWLEDGE_DEPENDENCY'
  | 'SAFETY_MANDATORY'
  | 'GOAL_ALIGNMENT'
  | 'ARTIFACT_ALIGNMENT'
  | 'LOW_ADHERENCE'
  | 'HIGH_ADHERENCE'
  | 'LOW_BUDGET'
  | 'HIGH_BUDGET'
  | 'LIMITED_COOKING_TIME'
  | 'MEALS_AWAY_FROM_HOME'
  | 'INADEQUATE_HYDRATION'
  | 'ADEQUATE_HYDRATION'
  | 'SPORTS_CONTEXT'
  | 'FOOD_RESTRICTIONS'
  | 'FOOD_REJECTIONS'
  | 'VEGAN_PATTERN'
  | 'CONFLICT_RESOLUTION'
  | 'COMPLEXITY_REDUCTION'
  | 'VARIETY_REDUCTION'
  | 'CLINICAL_BOUNDARY'
  | 'GENERAL_GUIDANCE'
  | 'PACKAGE_CONFLICT';

export interface NutritionPrioritizedObjective {
  readonly objective: NutritionReasoningObjective;
  readonly priority: NutritionReasoningPriority;
  readonly primary: boolean;
  readonly sourcePackageIds: readonly NutritionKnowledgePackageId[];
  readonly reasonCodes: readonly NutritionReasoningReasonCode[];
}

export interface NutritionReasoningFactorDecision {
  readonly packageId: NutritionKnowledgePackageId;
  readonly factorCode: string;
  readonly polarity: 'POSITIVE' | 'NEGATIVE';
  readonly priority: NutritionReasoningPriority;
}

export interface NutritionDiscardedFactor {
  readonly packageId: NutritionKnowledgePackageId;
  readonly factorCode: string;
  readonly reasonCode: 'PACKAGE_CONFLICT' | 'PACKAGE_IGNORED';
}

export interface NutritionKnowledgePackageDecision {
  readonly packageId: NutritionKnowledgePackageId;
  readonly originalPriority: NutritionKnowledgePackage['priority'];
  readonly resolvedPriority: NutritionReasoningPriority;
  readonly disposition:
    | 'REQUIRED'
    | 'ELEVATED'
    | 'KEPT'
    | 'REDUCED'
    | 'DISCARDED';
  readonly reasonCodes: readonly NutritionReasoningReasonCode[];
}

export interface NutritionSelectedStrategy {
  readonly strategy: NutritionReasoningStrategy;
  readonly priority: Exclude<NutritionReasoningPriority, 'IGNORED'>;
  readonly sourcePackageIds: readonly NutritionKnowledgePackageId[];
  readonly reasonCodes: readonly NutritionReasoningReasonCode[];
}

export interface NutritionProhibitedStrategy {
  readonly strategy: NutritionReasoningStrategy;
  readonly sourcePackageIds: readonly NutritionKnowledgePackageId[];
  readonly reasonCodes: readonly NutritionReasoningReasonCode[];
}

export interface NutritionResolvedConflict {
  readonly conflict: NutritionReasoningConflict;
  readonly packageIds: readonly NutritionKnowledgePackageId[];
  readonly elevatedStrategies: readonly NutritionReasoningStrategy[];
  readonly reducedStrategies: readonly NutritionReasoningStrategy[];
  readonly prohibitedStrategies: readonly NutritionReasoningStrategy[];
  readonly reasonCodes: readonly NutritionReasoningReasonCode[];
}

export interface NutritionAppliedRestriction {
  readonly code: string;
  readonly enforcement: 'PROHIBIT' | 'REQUIRE' | 'CAUTION';
  readonly sourcePackageIds: readonly NutritionKnowledgePackageId[];
}

export interface NutritionReasoningPriorityProfile {
  readonly adherence: NutritionReasoningPriority;
  readonly performance: NutritionReasoningPriority;
  readonly recovery: NutritionReasoningPriority;
  readonly education: NutritionReasoningPriority;
  readonly practicality: NutritionReasoningPriority;
  readonly economy: NutritionReasoningPriority;
  readonly satiety: NutritionReasoningPriority;
  readonly behavior: NutritionReasoningPriority;
}

export type NutritionInterventionIntensity =
  | 'LOW'
  | 'MODERATE'
  | 'HIGH'
  | 'RESTRICTED';

export type NutritionPersonalizationLevel = 'BASIC' | 'CONTEXTUAL' | 'HIGH';

export type NutritionRecommendedComplexity =
  | 'MINIMAL'
  | 'SIMPLE'
  | 'MODERATE'
  | 'DETAILED';

export interface NutritionReasoningMetadata {
  readonly schemaVersion: typeof NUTRITION_REASONING_SCHEMA_VERSION;
  readonly strategyVersion: typeof NUTRITION_REASONING_STRATEGY_VERSION;
  readonly knowledgeCatalogVersion: string;
  readonly sourcePackageIds: readonly NutritionKnowledgePackageId[];
  readonly conversationGoal: ConversationGoalDecision['goal'];
  readonly artifactType: NutritionArtifactType;
  readonly deterministic: true;
  readonly safetyRestricted: boolean;
}

export interface NutritionReasoningResult {
  readonly prioritizedObjectives: readonly NutritionPrioritizedObjective[];
  readonly packageDecisions: readonly NutritionKnowledgePackageDecision[];
  readonly activeFactors: readonly NutritionReasoningFactorDecision[];
  readonly discardedFactors: readonly NutritionDiscardedFactor[];
  readonly resolvedConflicts: readonly NutritionResolvedConflict[];
  readonly appliedRestrictions: readonly NutritionAppliedRestriction[];
  readonly selectedStrategies: readonly NutritionSelectedStrategy[];
  readonly prohibitedStrategies: readonly NutritionProhibitedStrategy[];
  readonly interventionIntensity: NutritionInterventionIntensity;
  readonly personalizationLevel: NutritionPersonalizationLevel;
  readonly recommendedComplexity: NutritionRecommendedComplexity;
  readonly priorities: NutritionReasoningPriorityProfile;
  readonly metadata: NutritionReasoningMetadata;
}

export interface NutritionReasoningInput {
  readonly snapshot: CoachProfileSnapshot;
  readonly knowledgePackages: readonly NutritionKnowledgePackage[];
  readonly conversationGoal: ConversationGoalDecision;
  readonly artifactType: NutritionArtifactType;
}
