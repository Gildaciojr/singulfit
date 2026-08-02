import type {
  ConversationBlockType,
  ConversationPresentation,
} from './conversation-composition.contract';
import type {
  NutritionConversationCoachClosingStrategy,
  NutritionConversationCoachLexicalVariant,
  NutritionConversationCoachOpeningStrategy,
  NutritionConversationCoachPacing,
  NutritionConversationCoachToneStrategy,
  NutritionConversationCoachTransitionStyle,
} from './nutrition-conversation-coach-style.contract';

export type NutritionConversationCognitiveLoad = 'LOW' | 'MODERATE' | 'HIGH';
export type NutritionConversationExplanationLevel =
  | 'ANSWER_ONLY'
  | 'BRIEF_REASON'
  | 'CONTEXTUAL'
  | 'DETAILED';
export type NutritionConversationFormality =
  | 'NATURAL'
  | 'PROFESSIONAL_NATURAL'
  | 'PROFESSIONAL_PRECISE';
export type NutritionConversationMotivationalIntensity =
  | 'NONE'
  | 'DISCREET'
  | 'MODERATE';
export type NutritionConversationFocusLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export interface NutritionConversationPersonalization {
  readonly cognitiveLoad: NutritionConversationCognitiveLoad;
  readonly explanationLevel: NutritionConversationExplanationLevel;
  readonly formality: NutritionConversationFormality;
  readonly motivationalIntensity: NutritionConversationMotivationalIntensity;
  readonly objectivity: NutritionConversationFocusLevel;
  readonly educationalFocus: NutritionConversationFocusLevel;
  readonly behavioralFocus: NutritionConversationFocusLevel;
  readonly safetySensitive: boolean;
  readonly performanceOriented: boolean;
  readonly continuityAvailable: boolean;
  readonly repetitionRisk: boolean;
  readonly questionBudget: 0 | 1;
  readonly rationaleCodes: readonly string[];
}

export interface NutritionConversationStylePlan {
  readonly toneStrategy: NutritionConversationCoachToneStrategy;
  readonly openingStrategy: NutritionConversationCoachOpeningStrategy;
  readonly closingStrategy: NutritionConversationCoachClosingStrategy;
  readonly pacing: NutritionConversationCoachPacing;
  readonly transitionStyle: NutritionConversationCoachTransitionStyle;
  readonly lexicalVariant: NutritionConversationCoachLexicalVariant;
  readonly humor: 'PROHIBITED' | 'SUBTLE_LIGHTNESS_ALLOWED';
  readonly explanationLevel: NutritionConversationExplanationLevel;
  readonly formality: NutritionConversationFormality;
  readonly motivationalIntensity: NutritionConversationMotivationalIntensity;
  readonly objectivity: NutritionConversationFocusLevel;
  readonly educationalFocus: NutritionConversationFocusLevel;
  readonly behavioralFocus: NutritionConversationFocusLevel;
  readonly maximumQuestions: 0 | 1;
  readonly rationaleCodes: readonly string[];
}

export type NutritionConversationFlowPattern =
  | 'SHORT_ANSWER_REASON_CLOSING'
  | 'OBSERVATION_EXPLANATION_GUIDANCE_CLOSING'
  | 'RECOGNITION_EXPLANATION_NEXT_STEP_QUESTION'
  | 'CONTINUITY_OBSERVATION_NEXT_STEP'
  | 'CLARIFICATION_BEFORE_ANALYSIS'
  | 'SAFETY_FIRST_GUIDANCE'
  | 'DETAILED_PROGRESSIVE_ANALYSIS';

export interface NutritionConversationFlowPlan {
  readonly pattern: NutritionConversationFlowPattern;
  readonly orderedBlockTypes: readonly ConversationBlockType[];
  readonly presentation: ConversationPresentation;
  readonly maximumQuestions: 0 | 1;
  readonly shouldExplain: boolean;
  readonly shouldTeach: boolean;
  readonly shouldReinforce: boolean;
  readonly shouldSummarize: boolean;
  readonly shouldContinueThread: boolean;
  readonly shouldConfirm: boolean;
  readonly suppressRepeatedEducation: boolean;
  readonly rationaleCodes: readonly string[];
}
