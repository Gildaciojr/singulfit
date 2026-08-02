import type { ConversationRoutingDecision } from './conversation-execution-route.contract';

export const CONVERSATION_RUNTIME_MODE = {
  OFF: 'OFF',
  SHADOW: 'SHADOW',
  INTERNAL: 'INTERNAL',
  CANARY: 'CANARY',
  ROLLOUT: 'ROLLOUT',
  PRIMARY: 'PRIMARY',
} as const;

export type ConversationRuntimeMode =
  (typeof CONVERSATION_RUNTIME_MODE)[keyof typeof CONVERSATION_RUNTIME_MODE];

export type ConversationLegacyIntent = 'DIET' | 'WORKOUT' | 'BOTH' | 'UNKNOWN';

export interface ConversationRuntimeConfig {
  readonly mode: ConversationRuntimeMode;
  readonly killSwitch: boolean;
  readonly internalUserIds: readonly string[];
  readonly canaryPercentage: number;
  readonly timeoutMs: number;
  readonly valid: boolean;
}

export interface ConversationRuntimeInput {
  readonly userId: string;
  readonly conversationId: string;
  readonly messageId: string;
  readonly text: string;
  readonly receivedAt: string;
  readonly legacyIntent: ConversationLegacyIntent;
  readonly profileId?: string;
}

export type ConversationRuntimeStatus =
  | 'SKIPPED'
  | 'SHADOW_COMPLETED'
  | 'OFFICIAL_CANDIDATE'
  | 'FALLBACK_REQUIRED'
  | 'FAILED';

export interface ConversationRuntimeSummary {
  readonly status: ConversationRuntimeStatus;
  readonly mode: ConversationRuntimeMode;
  readonly operationKey: string;
  readonly understandingStatus: 'NOT_EVALUATED' | 'UNDERSTOOD' | 'FAILED';
  readonly recognizedIntent: string | null;
  readonly goal: string | null;
  readonly routeKind: string | null;
  readonly confidence: 'HIGH' | 'MEDIUM' | 'LOW' | null;
  readonly ambiguityPresent: boolean;
  readonly safetyRequired: boolean;
  readonly authorized: boolean;
  readonly fallbackReason: string | null;
  readonly durationMs: number;
  readonly versions: {
    readonly runtime: 'conversation-runtime:v1';
    readonly understanding: 'conversation-understanding:v1';
    readonly routing: 'conversation-routing-decision:v1';
  };
}

export interface ConversationRuntimeEvaluation {
  readonly summary: ConversationRuntimeSummary;
  readonly decision: ConversationRoutingDecision | null;
}

export type ConversationBridgeResult =
  | Readonly<{
      status: 'COMPLETED';
      content: string;
      routeKind: string;
    }>
  | Readonly<{
      status: 'FALLBACK_REQUIRED' | 'FAILED';
      content: null;
      routeKind: string | null;
      reason: string;
    }>;

export type ConversationOfficialSource = 'LEGACY' | 'CONVERSATION_RUNTIME';

export interface ConversationOfficialSelection {
  readonly source: ConversationOfficialSource;
  readonly content: string;
  readonly reason:
    | 'RUNTIME_DISABLED'
    | 'SHADOW_ONLY'
    | 'USER_NOT_ELIGIBLE'
    | 'RUNTIME_SELECTED'
    | 'RUNTIME_FALLBACK'
    | 'RUNTIME_TIMEOUT'
    | 'RUNTIME_FAILURE';
}

export interface ConversationRuntimeIntegrationInput extends ConversationRuntimeInput {
  readonly legacyContent: string;
}
