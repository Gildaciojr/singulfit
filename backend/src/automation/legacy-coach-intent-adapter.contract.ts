import type { ProfileAcquisitionIntent } from '../context/coach-adaptive-profile-collector.contract';
import type {
  ConversationGoalPlanTarget,
  ConversationRecognizedIntent,
} from '../context/conversation-goal-planner.contract';
import type { CoachCommandIntent } from './coach-command.service';

export const LEGACY_COACH_INTENT_ADAPTER_VERSION =
  'legacy-coach-intent-adapter:v1';

export type LegacyCoachIntentCertainty = 'EXPLICIT' | 'INSUFFICIENT';

export interface LegacyCoachIntentAdaptation {
  readonly legacyIntent: CoachCommandIntent;
  readonly recognizedIntent: ConversationRecognizedIntent;
  readonly acquisitionIntent: ProfileAcquisitionIntent;
  readonly planTarget: ConversationGoalPlanTarget | null;
  readonly certainty: LegacyCoachIntentCertainty;
  readonly adapterVersion: typeof LEGACY_COACH_INTENT_ADAPTER_VERSION;
}
