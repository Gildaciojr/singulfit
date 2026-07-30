import type {
  ConversationComparisonCheckCode,
  ConversationComparisonMetrics,
  ConversationComparisonResult,
} from './conversation-comparison.contract';
import type { LanguageRealizationResult } from './conversation-language-realization.contract';
import type { SanitizedConversationPayload } from './sanitized-conversation-payload.contract';
import type { NutritionConversationHumanizationMetrics } from './nutrition-conversation-coach-style.contract';

export type ConversationEvaluationValue =
  | string
  | number
  | boolean
  | null
  | readonly ConversationEvaluationValue[]
  | { readonly [key: string]: ConversationEvaluationValue };

export interface ConversationEvaluationScenario {
  readonly id: string;
  readonly userMessage: string;
  readonly nutritionContext: ConversationEvaluationValue;
  readonly behavioralContext: ConversationEvaluationValue;
  readonly memory: ConversationEvaluationValue;
  readonly recommendations: ConversationEvaluationValue;
  readonly longitudinalContext: ConversationEvaluationValue;
  readonly expectedLegacyResponse: string;
  readonly candidate: LanguageRealizationResult | null;
  readonly payload: SanitizedConversationPayload;
  readonly expectedFoods: readonly string[];
  readonly expectedRecommendations: readonly string[];
  readonly incrementalLatencyMs: number;
  readonly usage: {
    readonly promptTokens: number | null;
    readonly completionTokens: number | null;
    readonly totalTokens: number | null;
  };
}

export interface ConversationEvaluationScores {
  readonly factual: number;
  readonly structural: number;
  readonly decisionAdherence: number;
  readonly coverage: number;
  readonly completeness: number;
  readonly consistency: number;
  readonly final: number;
}

export interface ConversationEvaluationReport {
  readonly scenarioId: string;
  readonly summary: {
    readonly passedCheckCount: number;
    readonly failedCheckCount: number;
    readonly warningCount: number;
    readonly candidateState: ConversationComparisonResult['candidateState'];
  };
  readonly passedChecks: readonly ConversationComparisonCheckCode[];
  readonly failedChecks: readonly ConversationComparisonCheckCode[];
  readonly warnings: readonly ConversationComparisonCheckCode[];
  readonly objectiveReasons: readonly string[];
  readonly comparison: ConversationComparisonResult;
  readonly metrics: ConversationComparisonMetrics &
    NutritionConversationHumanizationMetrics & {
      readonly foodsPreserved: boolean;
      readonly recommendationsPreserved: boolean;
      readonly recognitionEvidencePreserved: boolean;
      readonly genericPraiseAbsent: boolean;
      readonly emotionalEvidencePreserved: boolean;
      readonly unsafeEmotionalLanguageAbsent: boolean;
      readonly profileRespected: boolean;
      readonly centralIntentPreserved: boolean;
      readonly paragraphBudgetRespected: boolean;
      readonly questionBudgetRespected: boolean;
      readonly actionBudgetRespected: boolean;
      readonly unnecessaryQuestionAbsent: boolean;
      readonly unnecessaryRecommendationAbsent: boolean;
      readonly detailedAnalysisUsedOnlyWhenEligible: boolean;
      readonly recoveryStayedBrief: boolean;
      readonly celebrationStayedFocused: boolean;
      readonly clarificationAvoidedSpeculation: boolean;
      readonly technicalHeadingsAbsentWhenProhibited: boolean;
      readonly structuralDiversity: boolean;
      readonly memoryRecallCorrect: boolean;
      readonly memoryRecallNecessary: boolean;
      readonly memoryNotInvented: boolean;
      readonly continuityNatural: boolean;
      readonly episodeRelevance: boolean;
      readonly episodeReuse: boolean;
      readonly episodeExpiration: boolean;
      readonly density: SanitizedConversationPayload['structure']['density'];
      readonly depth: SanitizedConversationPayload['structure']['depth'];
    };
  readonly scores: ConversationEvaluationScores;
}
