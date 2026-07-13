import type { LanguageRealizationResult } from './conversation-language-realization.contract';
import type {
  ConversationEvaluationReport,
  ConversationEvaluationScenario,
  ConversationEvaluationScores,
} from './conversation-evaluation-harness.contract';

export type ConversationCorpusMode = 'DETERMINISTIC' | 'EXPERIMENTAL';

export type ConversationCorpusClassification =
  | 'ELIGIBLE'
  | 'ELIGIBLE_WITH_WARNING'
  | 'LEGACY_PREFERRED'
  | 'INVALID_CANDIDATE'
  | 'FALLBACK_REQUIRED';

export interface ConversationCorpusScenario extends ConversationEvaluationScenario {
  readonly tags: readonly string[];
  readonly golden: boolean;
}

export interface ConversationCandidateFactory {
  realize(
    scenario: ConversationCorpusScenario,
  ): Promise<LanguageRealizationResult>;
}

export interface ConversationCorpusAcceptanceCriteria {
  readonly minimumFactualScore: number;
  readonly minimumStructuralScore: number;
  readonly minimumConsistencyScore: number;
}

export interface ConversationCorpusScenarioResult {
  readonly scenarioId: string;
  readonly classification: ConversationCorpusClassification;
  readonly reasons: readonly string[];
  readonly report: ConversationEvaluationReport;
}

export interface ConversationCorpusAggregateReport {
  readonly mode: ConversationCorpusMode;
  readonly totalScenarios: number;
  readonly eligible: number;
  readonly eligibleWithWarning: number;
  readonly legacyPreferred: number;
  readonly invalidCandidates: number;
  readonly fallbackRequired: number;
  readonly averageScores: ConversationEvaluationScores;
  readonly lowestFinalScore: number;
  readonly highestFinalScore: number;
  readonly frequentDivergences: readonly {
    readonly code: string;
    readonly count: number;
  }[];
  readonly frequentWarnings: readonly {
    readonly code: string;
    readonly count: number;
  }[];
  readonly criticalScenarioIds: readonly string[];
  readonly experimentalAverageLatencyMs: number | null;
  readonly experimentalAverageTotalTokens: number | null;
  readonly scenarios: readonly ConversationCorpusScenarioResult[];
}

export interface RunConversationCorpusOptions {
  readonly mode?: ConversationCorpusMode;
  readonly experimentalEnabled?: boolean;
  readonly candidateFactory?: ConversationCandidateFactory;
}
