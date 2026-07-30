import { ConfigService } from '@nestjs/config';
import {
  CONVERSATION_LAYER_MODE,
  ConversationLayerOperationalConfigService,
} from '../responses/conversation-layer-operational-config.service';
import { ConversationGoalShadowConfigService } from './conversation-goal-shadow-config.service';

describe('ConversationGoalShadowConfigService', () => {
  function subject(values: Readonly<Record<string, string | undefined>>) {
    const config = new ConfigService(values);
    const operational = new ConversationLayerOperationalConfigService(config);

    return new ConversationGoalShadowConfigService(config, operational);
  }

  it('is release-locked off by default', () => {
    expect(subject({}).get()).toEqual({ requested: false, enabled: false });
  });

  it('enables only with the explicit flag and operational SHADOW mode', () => {
    expect(
      subject({
        CONVERSATION_LAYER_MODE: CONVERSATION_LAYER_MODE.SHADOW,
        CONVERSATION_GOAL_SHADOW_ENABLED: 'true',
      }).get(),
    ).toEqual({ requested: true, enabled: true });
  });

  it.each(['OFF', 'INTERNAL', 'CANARY', 'ROLLOUT', 'PRIMARY'] as const)(
    'remains disabled in %s even when explicitly requested',
    (mode) => {
      expect(
        subject({
          CONVERSATION_LAYER_MODE: mode,
          CONVERSATION_GOAL_SHADOW_ENABLED: 'true',
        }).get().enabled,
      ).toBe(false);
    },
  );

  it('honors the existing operational kill switch and returns a frozen result', () => {
    const result = subject({
      CONVERSATION_LAYER_MODE: CONVERSATION_LAYER_MODE.SHADOW,
      CONVERSATION_LAYER_KILL_SWITCH: 'true',
      CONVERSATION_GOAL_SHADOW_ENABLED: 'true',
    }).get();

    expect(result).toEqual({ requested: true, enabled: false });
    expect(Object.isFrozen(result)).toBe(true);
  });
});
