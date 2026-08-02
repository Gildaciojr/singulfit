import type {
  ConversationCollectorContext,
  ConversationContinuityContext,
  ConversationHistoryEntry,
  ConversationProfileContext,
  ConversationChannel,
} from './conversation-context.contract';
import type {
  ConversationEntity,
  ConversationReference,
} from './conversation-entity.contract';
import type {
  ConversationConfidence,
  ConversationDomain,
  ConversationIntent,
  ConversationOperation,
  ConversationUnderstandingSource,
} from './conversation-intent.contract';

export const CONVERSATION_UNDERSTANDING_VERSION =
  'conversation-understanding:v1' as const;

export interface ConversationUnderstandingInput {
  readonly contractVersion: typeof CONVERSATION_UNDERSTANDING_VERSION;
  readonly userId: string;
  readonly conversationId: string;
  readonly messageId: string;
  readonly channel: ConversationChannel;
  readonly text: string;
  readonly receivedAt: string;
  readonly profile: ConversationProfileContext;
  readonly collector: ConversationCollectorContext | null;
  readonly recentHistory: readonly ConversationHistoryEntry[];
  readonly continuity: ConversationContinuityContext;
}

export interface ConversationSafetySignal {
  readonly category:
    | 'PAIN'
    | 'INJURY'
    | 'MEDICAL'
    | 'INCAPACITY'
    | 'EXTREME_REQUEST'
    | 'OTHER_RISK';
  readonly severity: 'UNSPECIFIED' | 'LOW' | 'MEDIUM' | 'HIGH';
}

export interface ConversationSafety {
  readonly signals: readonly ConversationSafetySignal[];
  readonly requiresSafeResponse: boolean;
  readonly requiresProfessionalGuidance: boolean;
  readonly medicalAdviceProhibited: boolean;
}

export interface ConversationAmbiguity {
  readonly present: boolean;
  readonly codes: readonly (
    | 'MISSING_DOMAIN'
    | 'MISSING_REFERENCE'
    | 'CONFLICTING_GOALS'
    | 'MULTIPLE_OPERATIONS'
    | 'INSUFFICIENT_CONTEXT'
  )[];
  readonly clarificationRequired: boolean;
}

export type ConversationContextUsage =
  | 'CURRENT_MESSAGE'
  | 'RECENT_HISTORY'
  | 'PROFILE_SNAPSHOT'
  | 'COLLECTOR_DECISION'
  | 'CONTINUITY';

export type ConversationRationaleCode =
  | 'CURRENT_PLANNER_DECISION'
  | 'EXPLICIT_CURRENT_TURN'
  | 'ACTIVE_PROFILE_QUESTION'
  | 'PENDING_CONFIRMATION'
  | 'CONTEXTUAL_REFERENCE_RESOLVED'
  | 'SAFETY_SIGNAL_PRESENT'
  | 'INSUFFICIENT_CONTEXT'
  | 'IMPLEMENTATION_PENDING';

export interface ConversationMetadata {
  readonly contractVersion: typeof CONVERSATION_UNDERSTANDING_VERSION;
  readonly source: ConversationUnderstandingSource;
  readonly operationKey: string;
  readonly evaluatedAt: string;
  readonly contextUsed: readonly ConversationContextUsage[];
  readonly rationaleCodes: readonly ConversationRationaleCode[];
}

export interface ConversationSecondaryIntent {
  readonly intent: ConversationIntent;
  readonly domain: ConversationDomain;
  readonly operation: ConversationOperation;
}

interface ConversationUnderstandingBase {
  readonly intent: ConversationIntent;
  readonly operation: ConversationOperation;
  readonly domain: ConversationDomain;
  readonly confidence: ConversationConfidence;
  readonly secondaryIntents: readonly ConversationSecondaryIntent[];
  readonly entities: readonly ConversationEntity[];
  readonly references: readonly ConversationReference[];
  readonly ambiguity: ConversationAmbiguity;
  readonly safety: ConversationSafety;
  readonly metadata: ConversationMetadata;
}

export type ConversationUnderstandingFailure =
  | 'EMPTY_MESSAGE'
  | 'UNSUPPORTED_CONTENT'
  | 'INVALID_RESULT'
  | 'AMBIGUOUS'
  | 'CONTEXT_UNAVAILABLE'
  | 'NOT_IMPLEMENTED';

export type ConversationUnderstandingResult =
  | (ConversationUnderstandingBase &
      Readonly<{ status: 'UNDERSTOOD'; failure: null }>)
  | (ConversationUnderstandingBase &
      Readonly<{
        status: 'FAILED';
        failure: ConversationUnderstandingFailure;
      }>);
