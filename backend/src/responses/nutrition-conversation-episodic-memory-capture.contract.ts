import type { LongitudinalResponseContext } from '../longitudinal/interfaces/longitudinal.interface';
import type { NutritionConversationContext } from './nutrition-conversation-context.interface';
import type {
  NutritionConversationEpisode,
  NutritionConversationEpisodeEvidence,
  NutritionConversationEpisodeLifecycleAction,
} from './nutrition-conversation-episodic-memory.contract';

export type NutritionConversationEpisodeCaptureOperation =
  | 'CREATE'
  | 'UPDATE'
  | 'COMPLETE'
  | 'SUPERSEDE'
  | 'INVALIDATE'
  | 'EXPIRE'
  | 'NO_OP';

export interface NutritionConversationPersistedEpisodeReference {
  readonly sourceKey: string;
  readonly episode: NutritionConversationEpisode;
}

export interface NutritionConversationEpisodeCaptureInput {
  readonly userId: string;
  readonly sourceEvidenceKey: string;
  readonly logicalNow: number;
  readonly context: NutritionConversationContext;
  readonly longitudinal?: LongitudinalResponseContext;
  readonly preferredMealTimes?: unknown;
  readonly coachReengagement?: {
    readonly reason: string;
    readonly confidence: number;
  };
  readonly existing: readonly NutritionConversationPersistedEpisodeReference[];
}

export interface NutritionConversationEpisodeCaptureCommand {
  readonly operation: NutritionConversationEpisodeCaptureOperation;
  readonly sourceKey: string;
  readonly continuityKey: string;
  readonly reason: string;
  readonly evidence?: NutritionConversationEpisodeEvidence;
  readonly lifecycleAction?: NutritionConversationEpisodeLifecycleAction;
}
