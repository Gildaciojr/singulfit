export type NutritionConversationCoachToneStrategy =
  | 'CALM_OBJECTIVE'
  | 'DISCREET_CELEBRATION'
  | 'SUPPORTIVE_CORRECTION'
  | 'CALM_RECOVERY'
  | 'PLATEAU_REASSURANCE'
  | 'PROGRESS_REINFORCEMENT'
  | 'CURIOUS_EXPLANATION';

export type NutritionConversationCoachOpeningStrategy =
  | 'DIRECT'
  | 'CONTEXTUAL'
  | 'CONTINUITY'
  | 'VALIDATING'
  | 'CELEBRATORY';

export type NutritionConversationCoachClosingStrategy =
  | 'NONE'
  | 'GROUNDING'
  | 'CONTINUITY'
  | 'AUTONOMY'
  | 'REFLECTIVE';

export type NutritionConversationCoachPacing =
  | 'COMPACT'
  | 'DIRECT'
  | 'BALANCED'
  | 'SUPPORTIVE'
  | 'EXPLANATORY';

export type NutritionConversationCoachTransitionStyle =
  | 'SEAMLESS'
  | 'GENTLE'
  | 'LOGICAL'
  | 'CONTINUITY';

export type NutritionConversationCoachLexicalVariant = 'A' | 'B' | 'C' | 'D';

export interface NutritionConversationCoachPersonality {
  readonly warmth: number;
  readonly professionalism: number;
  readonly empathy: number;
  readonly optimism: number;
  readonly objectivity: number;
  readonly calmness: number;
  readonly supportiveness: number;
  readonly respect: number;
  readonly encouragement: number;
  readonly humility: number;
  readonly naturalness: number;
}

export interface NutritionConversationCoachStyle {
  readonly identity: 'SINGULFIT_COACH_V1';
  readonly role: 'SPORTS_NUTRITION_COACH';
  readonly personality: NutritionConversationCoachPersonality;
  readonly toneStrategy: NutritionConversationCoachToneStrategy;
  readonly openingStrategy: NutritionConversationCoachOpeningStrategy;
  readonly closingStrategy: NutritionConversationCoachClosingStrategy;
  readonly pacing: NutritionConversationCoachPacing;
  readonly transitionStyle: NutritionConversationCoachTransitionStyle;
  readonly lexicalVariant: NutritionConversationCoachLexicalVariant;
  readonly humor: 'PROHIBITED' | 'SUBTLE_LIGHTNESS_ALLOWED';
  readonly evidencePolicy: {
    readonly praiseRequiresEvidence: true;
    readonly motivationRequiresEvidence: true;
    readonly empathyRequiresEvidence: true;
    readonly memoryRequiresAuthorization: true;
  };
  readonly guardrails: {
    readonly paternalismProhibited: true;
    readonly moralizingProhibited: true;
    readonly salesLanguageProhibited: true;
    readonly emotionalInferenceProhibited: true;
    readonly sarcasmProhibited: true;
    readonly ironyProhibited: true;
    readonly jokesProhibited: true;
  };
}

export type NutritionConversationHumanizationViolation =
  | 'GENERIC_PRAISE_WITHOUT_EVIDENCE'
  | 'MOTIVATION_WITHOUT_EVIDENCE'
  | 'ROBOTIC_LANGUAGE'
  | 'PATERNALISTIC_LANGUAGE'
  | 'MORALIZING_LANGUAGE'
  | 'SALES_LANGUAGE'
  | 'EMOTIONAL_INFERENCE'
  | 'PSYCHOLOGICAL_DIAGNOSIS'
  | 'UNAUTHORIZED_PROMISE'
  | 'LEXICAL_REPETITION'
  | 'REPETITIVE_OPENING'
  | 'GENERIC_CLOSING'
  | 'EXCESSIVE_ADJECTIVES'
  | 'EXCESSIVE_EXCLAMATION'
  | 'ARTIFICIAL_PARAGRAPHS'
  | 'TONE_MISMATCH'
  | 'CONTINUITY_LANGUAGE_UNNATURAL'
  | 'HUMOR_BOUNDARY_VIOLATION';

export interface NutritionConversationHumanizationMetrics {
  readonly naturalness: number;
  readonly coachIdentity: number;
  readonly toneConsistency: number;
  readonly empathyQuality: number;
  readonly lexicalDiversity: number;
  readonly openingDiversity: number;
  readonly closingDiversity: number;
  readonly transitionQuality: number;
  readonly humanPerception: number;
  readonly motivationQuality: number;
  readonly warmth: number;
  readonly professionalism: number;
}

export interface NutritionConversationHumanizationEvaluation {
  readonly valid: boolean;
  readonly violations: readonly NutritionConversationHumanizationViolation[];
  readonly metrics: NutritionConversationHumanizationMetrics;
}
