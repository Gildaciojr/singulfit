export type ConversationAnswerDisposition =
  | 'ANSWER'
  | 'CLARIFY'
  | 'DEFER_TO_SIDE_EFFECT_PIPELINE'
  | 'SAFE_RESPONSE';

export type ConversationAnswerDomain =
  | 'NUTRITION'
  | 'WORKOUT'
  | 'PROGRESS'
  | 'GENERAL';

export type ConversationAnswerGrounding =
  | 'CURRENT_PLAN'
  | 'PROFILE'
  | 'RECENT_CONTEXT'
  | 'GENERAL_KNOWLEDGE'
  | 'MIXED';

export interface ConversationAnswerCandidate {
  readonly disposition: ConversationAnswerDisposition;
  readonly domain: ConversationAnswerDomain;
  readonly answer: string | null;
  readonly followUpQuestion: string | null;
  readonly grounding: ConversationAnswerGrounding;
  readonly confidence: 'HIGH' | 'MEDIUM' | 'LOW';
}

export interface ConversationQAObservability {
  readonly answerSource: 'AI' | 'AI_REUSED' | 'DETERMINISTIC_FALLBACK';
  readonly disposition: ConversationAnswerDisposition | null;
  readonly domain: ConversationAnswerDomain | null;
  readonly grounding: ConversationAnswerGrounding | null;
  readonly providerDurationMs: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
  readonly fallbackReason: string | null;
}
