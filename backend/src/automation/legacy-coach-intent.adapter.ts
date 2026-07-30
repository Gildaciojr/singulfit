import { Injectable } from '@nestjs/common';
import { PROFILE_ACQUISITION_INTENT } from '../context/coach-adaptive-profile-collector.contract';
import { CONVERSATION_RECOGNIZED_INTENT } from '../context/conversation-goal-planner.contract';
import type { CoachCommandIntent } from './coach-command.service';
import {
  LEGACY_COACH_INTENT_ADAPTER_VERSION,
  LegacyCoachIntentAdaptation,
} from './legacy-coach-intent-adapter.contract';

@Injectable()
export class LegacyCoachIntentAdapter {
  adapt(intent: CoachCommandIntent): LegacyCoachIntentAdaptation {
    if (intent === 'DIET') {
      return this.result(
        intent,
        CONVERSATION_RECOGNIZED_INTENT.DIET_PLAN_REQUEST,
        PROFILE_ACQUISITION_INTENT.DIET_PLAN_REQUEST,
        'DIET',
        'EXPLICIT',
      );
    }

    if (intent === 'WORKOUT') {
      return this.result(
        intent,
        CONVERSATION_RECOGNIZED_INTENT.WORKOUT_PLAN_REQUEST,
        PROFILE_ACQUISITION_INTENT.WORKOUT_PLAN_REQUEST,
        'WORKOUT',
        'EXPLICIT',
      );
    }

    if (intent === 'BOTH') {
      return this.result(
        intent,
        CONVERSATION_RECOGNIZED_INTENT.COMBINED_PLAN_REQUEST,
        PROFILE_ACQUISITION_INTENT.COMBINED_PLAN_REQUEST,
        'BOTH',
        'EXPLICIT',
      );
    }

    return this.result(
      intent,
      CONVERSATION_RECOGNIZED_INTENT.UNKNOWN,
      PROFILE_ACQUISITION_INTENT.GENERAL_CONVERSATION,
      null,
      'INSUFFICIENT',
    );
  }

  private result(
    legacyIntent: CoachCommandIntent,
    recognizedIntent: LegacyCoachIntentAdaptation['recognizedIntent'],
    acquisitionIntent: LegacyCoachIntentAdaptation['acquisitionIntent'],
    planTarget: LegacyCoachIntentAdaptation['planTarget'],
    certainty: LegacyCoachIntentAdaptation['certainty'],
  ): LegacyCoachIntentAdaptation {
    return Object.freeze({
      legacyIntent,
      recognizedIntent,
      acquisitionIntent,
      planTarget,
      certainty,
      adapterVersion: LEGACY_COACH_INTENT_ADAPTER_VERSION,
    });
  }
}
