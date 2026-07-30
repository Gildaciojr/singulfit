import type { AuthorizedFactValue } from './conversation-authorized-facts.contract';
import type { ConversationDialogueProfile } from './conversation-composition.contract';

export type NutritionConversationEpisodeCategory =
  | 'GOAL'
  | 'DIFFICULTY'
  | 'HABIT'
  | 'SUCCESS'
  | 'SETBACK'
  | 'PLAN'
  | 'COMMITMENT'
  | 'QUESTION'
  | 'PREFERENCE'
  | 'ROUTINE'
  | 'ALLERGY'
  | 'RESTRICTION'
  | 'TRAVEL'
  | 'WORKOUT'
  | 'MILESTONE'
  | 'FOLLOW_UP';

export type NutritionConversationEpisodeNature =
  | 'FACT'
  | 'INFERENCE'
  | 'HYPOTHESIS'
  | 'OBSERVATION';

export type NutritionConversationEpisodeConfidence = 'LOW' | 'MEDIUM' | 'HIGH';

export type NutritionConversationEpisodeStatus =
  | 'ACTIVE'
  | 'PENDING'
  | 'COMPLETED'
  | 'SUPERSEDED'
  | 'EXPIRED'
  | 'INVALIDATED';

export type NutritionConversationEpisodeImportance =
  | 'LOW'
  | 'MEDIUM'
  | 'HIGH'
  | 'CRITICAL';

export type NutritionConversationEpisodeSource =
  | 'NUTRITION'
  | 'USER_CONTEXT'
  | 'BEHAVIOR'
  | 'COACH'
  | 'LONGITUDINAL'
  | 'RECOMMENDATION';

export type NutritionConversationEpisodeSensitivity = 'STANDARD' | 'SENSITIVE';

export type NutritionConversationEpisodeResumePolicy =
  | 'NEVER'
  | 'WHEN_RELEVANT'
  | 'ON_FOLLOW_UP';

export type NutritionConversationEpisodeRecallPolicy =
  | 'FREE'
  | 'REQUIRES_CONFIRMATION'
  | 'PROHIBITED';

export type NutritionConversationEpisodeRecallReason =
  | 'CURRENT_GOAL'
  | 'CURRENT_THEME'
  | 'FOLLOW_UP_DUE'
  | 'SAFETY_RELEVANCE'
  | 'STRATEGY_CONTINUITY'
  | 'PROGRESS_CONTINUITY'
  | 'USER_PREFERENCE';

export type NutritionConversationEpisodeConfirmation =
  | 'NOT_REQUIRED'
  | 'UNCONFIRMED'
  | 'CONFIRMED';

export type NutritionConversationEpisodeLifecycleState =
  | 'ORIGINAL'
  | 'CONSOLIDATED'
  | 'SUPERSEDED'
  | 'EXPIRED'
  | 'INVALIDATED';

export interface NutritionConversationEpisodeOriginEvidence {
  readonly code: string;
  readonly source: NutritionConversationEpisodeSource;
  readonly value: AuthorizedFactValue;
}

export interface NutritionConversationEpisodeLifecycle {
  readonly state: NutritionConversationEpisodeLifecycleState;
  readonly version: number;
  readonly lastTransitionAtLogical: number;
  readonly transitionReason?: string;
}

export interface NutritionConversationEpisode {
  readonly category: NutritionConversationEpisodeCategory;
  readonly nature: NutritionConversationEpisodeNature;
  readonly confidence: NutritionConversationEpisodeConfidence;
  readonly createdAtLogical: number;
  readonly expiresAtLogical?: number;
  readonly status: NutritionConversationEpisodeStatus;
  readonly importance: NutritionConversationEpisodeImportance;
  readonly source: NutritionConversationEpisodeSource;
  readonly eligibleForConversation: boolean;
  readonly resumePolicy: NutritionConversationEpisodeResumePolicy;
  readonly recallPolicy: NutritionConversationEpisodeRecallPolicy;
  readonly recallReason: NutritionConversationEpisodeRecallReason;
  readonly continuityKey: string;
  readonly originEvidence: readonly NutritionConversationEpisodeOriginEvidence[];
  readonly sensitivity: NutritionConversationEpisodeSensitivity;
  readonly lifecycle: NutritionConversationEpisodeLifecycle;
  readonly confirmation: NutritionConversationEpisodeConfirmation;
  readonly fact: AuthorizedFactValue;
  readonly relationToContext: string;
  readonly goalRelation?: string;
  readonly theme?: string;
}

export interface NutritionConversationEpisodeEvidence {
  readonly category: NutritionConversationEpisodeCategory;
  readonly nature: NutritionConversationEpisodeNature;
  readonly confidence: NutritionConversationEpisodeConfidence;
  readonly createdAtLogical: number;
  readonly expiresAtLogical?: number;
  readonly initialStatus?: 'ACTIVE' | 'PENDING' | 'COMPLETED';
  readonly importance: NutritionConversationEpisodeImportance;
  readonly source: NutritionConversationEpisodeSource;
  readonly eligibleForConversation: boolean;
  readonly resumePolicy: NutritionConversationEpisodeResumePolicy;
  readonly recallPolicy: NutritionConversationEpisodeRecallPolicy;
  readonly recallReason: NutritionConversationEpisodeRecallReason;
  readonly continuityKey: string;
  readonly originEvidence: readonly NutritionConversationEpisodeOriginEvidence[];
  readonly sensitivity: NutritionConversationEpisodeSensitivity;
  readonly confirmation: NutritionConversationEpisodeConfirmation;
  readonly fact: AuthorizedFactValue;
  readonly relationToContext: string;
  readonly goalRelation?: string;
  readonly theme?: string;
}

export type NutritionConversationEpisodeLifecycleAction =
  | 'COMPLETE'
  | 'INVALIDATE'
  | 'EXPIRE';

export interface NutritionConversationEpisodeLifecycleDirective {
  readonly continuityKey: string;
  readonly action: NutritionConversationEpisodeLifecycleAction;
  readonly atLogical: number;
  readonly reason: string;
}

export interface NutritionConversationEpisodeSelectionContext {
  readonly logicalNow: number;
  readonly currentGoal?: string;
  readonly currentTheme?: string;
  readonly relevantCategories: readonly NutritionConversationEpisodeCategory[];
  readonly fatigueScore: number;
  readonly dialogueProfile: ConversationDialogueProfile;
  readonly limit: number;
  readonly previouslyRecalledContinuityKeys: readonly string[];
}

export type NutritionConversationEpisodeSuppressionReason =
  | 'STATUS_INELIGIBLE'
  | 'EXPIRED'
  | 'CONVERSATION_PROHIBITED'
  | 'CONFIRMATION_REQUIRED'
  | 'CONTEXT_MISMATCH'
  | 'FATIGUE'
  | 'CATEGORY_DUPLICATE'
  | 'RECALL_BUDGET';

export interface NutritionConversationEpisodicRecall {
  readonly continuityKey: string;
  readonly category: NutritionConversationEpisodeCategory;
  readonly fact: AuthorizedFactValue;
  readonly relationToContext: string;
  readonly recallReason: NutritionConversationEpisodeRecallReason;
  readonly source: NutritionConversationEpisodeSource;
  readonly sensitivity: NutritionConversationEpisodeSensitivity;
}

export interface NutritionConversationEpisodeSuppression {
  readonly continuityKey: string;
  readonly category: NutritionConversationEpisodeCategory;
  readonly reason: NutritionConversationEpisodeSuppressionReason;
}

export interface NutritionConversationEpisodeSelection {
  readonly episodes: readonly NutritionConversationEpisode[];
  readonly selected: readonly NutritionConversationEpisodicRecall[];
  readonly suppressed: readonly NutritionConversationEpisodeSuppression[];
}
