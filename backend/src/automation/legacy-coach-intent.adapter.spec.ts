import { PROFILE_ACQUISITION_INTENT } from '../context/coach-adaptive-profile-collector.contract';
import { CONVERSATION_RECOGNIZED_INTENT } from '../context/conversation-goal-planner.contract';
import { LegacyCoachIntentAdapter } from './legacy-coach-intent.adapter';

describe('LegacyCoachIntentAdapter', () => {
  const adapter = new LegacyCoachIntentAdapter();

  it.each([
    [
      'DIET',
      CONVERSATION_RECOGNIZED_INTENT.DIET_PLAN_REQUEST,
      PROFILE_ACQUISITION_INTENT.DIET_PLAN_REQUEST,
      'DIET',
    ],
    [
      'WORKOUT',
      CONVERSATION_RECOGNIZED_INTENT.WORKOUT_PLAN_REQUEST,
      PROFILE_ACQUISITION_INTENT.WORKOUT_PLAN_REQUEST,
      'WORKOUT',
    ],
    [
      'BOTH',
      CONVERSATION_RECOGNIZED_INTENT.COMBINED_PLAN_REQUEST,
      PROFILE_ACQUISITION_INTENT.COMBINED_PLAN_REQUEST,
      'BOTH',
    ],
  ] as const)(
    'adapts %s without reclassifying message text',
    (legacyIntent, recognizedIntent, acquisitionIntent, planTarget) => {
      const result = adapter.adapt(legacyIntent);

      expect(result).toEqual({
        legacyIntent,
        recognizedIntent,
        acquisitionIntent,
        planTarget,
        certainty: 'EXPLICIT',
        adapterVersion: 'legacy-coach-intent-adapter:v1',
      });
      expect(Object.isFrozen(result)).toBe(true);
      expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    },
  );

  it('preserves the uncertainty of UNKNOWN without inspecting text', () => {
    const result = adapter.adapt('UNKNOWN');

    expect(result).toEqual({
      legacyIntent: 'UNKNOWN',
      recognizedIntent: CONVERSATION_RECOGNIZED_INTENT.UNKNOWN,
      acquisitionIntent: PROFILE_ACQUISITION_INTENT.GENERAL_CONVERSATION,
      planTarget: null,
      certainty: 'INSUFFICIENT',
      adapterVersion: 'legacy-coach-intent-adapter:v1',
    });
    expect(Object.keys(result)).not.toContain('text');
  });
});
