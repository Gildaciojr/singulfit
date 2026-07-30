export const COACHING_QUALITY_SCHEMA_VERSION = 1 as const;
export const COACHING_QUALITY_POLICY_VERSION = '2026.07.1' as const;

export type CoachingQualityDomain =
  | 'NUTRITION'
  | 'WORKOUT'
  | 'LONGITUDINAL'
  | 'CONVERSATION'
  | 'SAFETY'
  | 'PERSONALIZATION'
  | 'ADHERENCE';

export type CoachingQualityAvailability =
  | 'OBSERVED'
  | 'PARTIAL'
  | 'NOT_OBSERVED';

export type CoachingQualityCriterionStatus =
  | 'EXCELLENT'
  | 'GOOD'
  | 'ATTENTION'
  | 'CRITICAL'
  | 'NOT_OBSERVED';

export type CoachingQualityCriterionId =
  | 'NUTRITION_RESTRICTIONS'
  | 'NUTRITION_PREFERENCES'
  | 'NUTRITION_VARIETY'
  | 'NUTRITION_REPETITION'
  | 'NUTRITION_SIMPLICITY'
  | 'NUTRITION_PRACTICALITY'
  | 'NUTRITION_BUDGET'
  | 'NUTRITION_HYDRATION'
  | 'NUTRITION_EDUCATION'
  | 'NUTRITION_PROTEIN_DISTRIBUTION'
  | 'NUTRITION_RECOVERY'
  | 'NUTRITION_SATIETY'
  | 'NUTRITION_SAFETY'
  | 'WORKOUT_MODALITY'
  | 'WORKOUT_INTENSITY'
  | 'WORKOUT_PROGRESSION'
  | 'WORKOUT_COMPLEXITY'
  | 'WORKOUT_SAFETY'
  | 'WORKOUT_EXPERIENCE'
  | 'WORKOUT_EQUIPMENT'
  | 'WORKOUT_ENVIRONMENT'
  | 'WORKOUT_ADHERENCE'
  | 'WORKOUT_RECOVERY'
  | 'LONGITUDINAL_STABILITY'
  | 'LONGITUDINAL_ADAPTATION_TIMING'
  | 'LONGITUDINAL_MAINTENANCE_TIMING'
  | 'LONGITUDINAL_DELOAD'
  | 'LONGITUDINAL_REVIEW'
  | 'LONGITUDINAL_SIMPLIFICATION'
  | 'LONGITUDINAL_PROGRESSION'
  | 'LONGITUDINAL_REGRESSION'
  | 'CONVERSATION_PERSONALIZATION'
  | 'CONVERSATION_STRUCTURAL_EMPATHY'
  | 'CONVERSATION_QUESTION_BALANCE'
  | 'CONVERSATION_CLARITY'
  | 'CONVERSATION_FOCUS'
  | 'CONVERSATION_EDUCATION'
  | 'CONVERSATION_ENCOURAGEMENT'
  | 'CONVERSATION_COHERENCE'
  | 'SAFETY_RESTRICTIONS'
  | 'SAFETY_CONFLICTS'
  | 'SAFETY_BLOCKS'
  | 'SAFETY_CLINICAL_BOUNDARY'
  | 'SAFETY_WORKOUT'
  | 'SAFETY_NUTRITION'
  | 'PERSONALIZATION_FACTORS'
  | 'PERSONALIZATION_PREFERENCES'
  | 'PERSONALIZATION_RESTRICTIONS'
  | 'PERSONALIZATION_LONGITUDINAL'
  | 'PERSONALIZATION_MODALITY'
  | 'PERSONALIZATION_ROUTINE'
  | 'PERSONALIZATION_BUDGET'
  | 'PERSONALIZATION_TIME'
  | 'ADHERENCE_COMPLEXITY'
  | 'ADHERENCE_ROUTINE'
  | 'ADHERENCE_TIME'
  | 'ADHERENCE_BUDGET'
  | 'ADHERENCE_HISTORY'
  | 'ADHERENCE_MOTIVATION'
  | 'ADHERENCE_RESTRICTIONS';

export type CoachingQualityCode =
  | 'RESTRICTIONS_RESPECTED'
  | 'RESTRICTIONS_NOT_OBSERVED'
  | 'PREFERENCES_CONSIDERED'
  | 'PREFERENCES_NOT_OBSERVED'
  | 'VARIETY_SUPPORTED'
  | 'VARIETY_CONTROLLED'
  | 'VARIETY_NOT_OBSERVED'
  | 'REPETITION_NOT_OBSERVED'
  | 'SIMPLE_STRATEGY'
  | 'HIGH_COMPLEXITY'
  | 'PRACTICAL_STRATEGY'
  | 'PRACTICALITY_NOT_OBSERVED'
  | 'BUDGET_ALIGNED'
  | 'BUDGET_NOT_OBSERVED'
  | 'HYDRATION_SUPPORTED'
  | 'HYDRATION_NOT_OBSERVED'
  | 'NUTRITION_EDUCATION_PRESENT'
  | 'NUTRITION_EDUCATION_NOT_OBSERVED'
  | 'GOOD_PROTEIN_DISTRIBUTION'
  | 'PROTEIN_DISTRIBUTION_NOT_OBSERVED'
  | 'RECOVERY_SUPPORTED'
  | 'RECOVERY_NOT_OBSERVED'
  | 'SATIETY_SUPPORTED'
  | 'SATIETY_NOT_OBSERVED'
  | 'NUTRITION_SAFETY_PRESENT'
  | 'NUTRITION_SAFETY_NOT_OBSERVED'
  | 'MODALITY_ALIGNED'
  | 'MODALITY_UNKNOWN'
  | 'SAFE_INTENSITY'
  | 'INTENSITY_RESTRICTED'
  | 'SAFE_PROGRESS'
  | 'PROGRESSION_REQUIRES_REVIEW'
  | 'COMPLEXITY_COMPATIBLE'
  | 'WORKOUT_SAFETY_PRESENT'
  | 'EXPERIENCE_COMPATIBLE'
  | 'EXPERIENCE_NOT_OBSERVED'
  | 'EQUIPMENT_COMPATIBLE'
  | 'EQUIPMENT_NOT_OBSERVED'
  | 'ENVIRONMENT_COMPATIBLE'
  | 'ENVIRONMENT_NOT_OBSERVED'
  | 'WORKOUT_ADHERENCE_SUPPORTED'
  | 'WORKOUT_RECOVERY_SUPPORTED'
  | 'WORKOUT_RECOVERY_NOT_OBSERVED'
  | 'LONGITUDINAL_STABLE'
  | 'LONGITUDINAL_IMPROVING'
  | 'LONGITUDINAL_PLATEAU'
  | 'LONGITUDINAL_REGRESSION'
  | 'LONGITUDINAL_UNKNOWN'
  | 'ADAPTATION_TIMELY'
  | 'ADAPTATION_MISTIMED'
  | 'MAINTENANCE_TIMELY'
  | 'MAINTENANCE_MISTIMED'
  | 'DELOAD_TIMELY'
  | 'DELOAD_MISSING'
  | 'REVIEW_TIMELY'
  | 'REVIEW_MISSING'
  | 'SIMPLIFICATION_TIMELY'
  | 'SIMPLIFICATION_MISSING'
  | 'PROGRESSION_TIMELY'
  | 'PROGRESSION_MISTIMED'
  | 'REGRESSION_HANDLED'
  | 'REGRESSION_UNHANDLED'
  | 'HIGH_PERSONALIZATION'
  | 'CONTEXTUAL_PERSONALIZATION'
  | 'LOW_PERSONALIZATION'
  | 'STRUCTURAL_EMPATHY_PRESENT'
  | 'STRUCTURAL_EMPATHY_NOT_OBSERVED'
  | 'QUESTION_BALANCED'
  | 'EXCESS_QUESTIONS'
  | 'INSUFFICIENT_QUESTIONS'
  | 'CLEAR_GOAL'
  | 'UNCLEAR_GOAL'
  | 'FOCUSED_RESPONSE_STRUCTURE'
  | 'UNFOCUSED_RESPONSE_STRUCTURE'
  | 'EDUCATIONAL_STRUCTURE'
  | 'ENCOURAGEMENT_STRUCTURE'
  | 'ENCOURAGEMENT_NOT_OBSERVED'
  | 'COHERENT_STRUCTURE'
  | 'INCOHERENT_STRUCTURE'
  | 'SAFETY_RESTRICTION_APPLIED'
  | 'SAFETY_RESTRICTION_MISSING'
  | 'SAFETY_CONFLICT_RESOLVED'
  | 'SAFETY_CONFLICT_UNRESOLVED'
  | 'SAFETY_BLOCK_APPLIED'
  | 'SAFETY_BLOCK_MISSING'
  | 'CLINICAL_BOUNDARY_RESPECTED'
  | 'CLINICAL_BOUNDARY_MISSING'
  | 'WORKOUT_SAFETY_RESTRICTED'
  | 'NUTRITION_SAFETY_RESTRICTED'
  | 'FACTORS_USED'
  | 'NO_FACTORS_USED'
  | 'LONGITUDINAL_CONTEXT_USED'
  | 'ROUTINE_CONTEXT_USED'
  | 'TIME_CONTEXT_USED'
  | 'GOOD_ADHERENCE'
  | 'MODERATE_ADHERENCE'
  | 'LOW_ADHERENCE'
  | 'HISTORICAL_ADHERENCE_USED'
  | 'MOTIVATION_USED'
  | 'MOTIVATION_NOT_OBSERVED';

export interface CoachingQualityCriterionEvaluation {
  readonly criterion: CoachingQualityCriterionId;
  readonly availability: CoachingQualityAvailability;
  readonly status: CoachingQualityCriterionStatus;
  readonly score: number | null;
  readonly codes: readonly CoachingQualityCode[];
}

export interface CoachingQualityDomainEvaluation {
  readonly domain: CoachingQualityDomain;
  readonly score: number;
  readonly coverage: number;
  readonly availability: CoachingQualityAvailability;
  readonly criteria: readonly CoachingQualityCriterionEvaluation[];
  readonly codes: readonly CoachingQualityCode[];
}

export interface NutritionQualityEvaluation extends CoachingQualityDomainEvaluation {
  readonly domain: 'NUTRITION';
}

export interface WorkoutQualityEvaluation extends CoachingQualityDomainEvaluation {
  readonly domain: 'WORKOUT';
}

export interface LongitudinalQualityEvaluation extends CoachingQualityDomainEvaluation {
  readonly domain: 'LONGITUDINAL';
}

export interface ConversationQualityEvaluation extends CoachingQualityDomainEvaluation {
  readonly domain: 'CONVERSATION';
}

export interface SafetyQualityEvaluation extends CoachingQualityDomainEvaluation {
  readonly domain: 'SAFETY';
}

export interface PersonalizationQualityEvaluation extends CoachingQualityDomainEvaluation {
  readonly domain: 'PERSONALIZATION';
}

export interface AdherencePredictionEvaluation extends CoachingQualityDomainEvaluation {
  readonly domain: 'ADHERENCE';
}

export interface CoachingOverallScore {
  readonly score: number;
  readonly observedWeight: number;
  readonly codes: readonly CoachingQualityCode[];
}

export interface CoachingQualityReport {
  readonly schemaVersion: typeof COACHING_QUALITY_SCHEMA_VERSION;
  readonly policyVersion: typeof COACHING_QUALITY_POLICY_VERSION;
  readonly sourceSchemaVersion: number;
  readonly runId: string;
  readonly nutrition: NutritionQualityEvaluation;
  readonly workout: WorkoutQualityEvaluation;
  readonly longitudinal: LongitudinalQualityEvaluation;
  readonly conversation: ConversationQualityEvaluation;
  readonly safety: SafetyQualityEvaluation;
  readonly personalization: PersonalizationQualityEvaluation;
  readonly adherencePrediction: AdherencePredictionEvaluation;
  readonly overall: CoachingOverallScore;
  readonly deterministic: true;
}
