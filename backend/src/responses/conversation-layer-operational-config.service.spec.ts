import { ConfigService } from '@nestjs/config';
import {
  CONVERSATION_LAYER_MODE,
  ConversationLayerOperationalConfigService,
} from './conversation-layer-operational-config.service';

describe('ConversationLayerOperationalConfigService', () => {
  function subject(values: Readonly<Record<string, string | undefined>>) {
    const configService = {
      get: (key: string) => values[key],
    };

    return new ConversationLayerOperationalConfigService(
      configService as ConfigService,
    );
  }

  it('defaults to OFF when no configuration is provided', () => {
    expect(subject({}).get()).toEqual({
      configuredMode: CONVERSATION_LAYER_MODE.OFF,
      effectiveMode: CONVERSATION_LAYER_MODE.OFF,
      killSwitchEnabled: false,
    });
  });

  it.each([
    ['off', CONVERSATION_LAYER_MODE.OFF],
    [' shadow ', CONVERSATION_LAYER_MODE.SHADOW],
    ['INTERNAL', CONVERSATION_LAYER_MODE.INTERNAL],
    ['canary', CONVERSATION_LAYER_MODE.CANARY],
    ['rollout', CONVERSATION_LAYER_MODE.ROLLOUT],
    ['primary', CONVERSATION_LAYER_MODE.PRIMARY],
  ])('resolves the configured mode %s deterministically', (value, mode) => {
    expect(subject({ CONVERSATION_LAYER_MODE: value }).get()).toEqual({
      configuredMode: mode,
      effectiveMode: mode,
      killSwitchEnabled: false,
    });
  });

  it('fails closed to OFF for an invalid mode', () => {
    expect(
      subject({ CONVERSATION_LAYER_MODE: 'unexpected' }).get().effectiveMode,
    ).toBe(CONVERSATION_LAYER_MODE.OFF);
  });

  it.each(['1', 'true', 'TRUE', ' yes ', 'on'])(
    'forces the effective mode to OFF when kill switch is %s',
    (killSwitch) => {
      expect(
        subject({
          CONVERSATION_LAYER_MODE: 'PRIMARY',
          CONVERSATION_LAYER_KILL_SWITCH: killSwitch,
        }).get(),
      ).toEqual({
        configuredMode: CONVERSATION_LAYER_MODE.PRIMARY,
        effectiveMode: CONVERSATION_LAYER_MODE.OFF,
        killSwitchEnabled: true,
      });
    },
  );

  it.each(['0', 'false', 'FALSE', ' no ', 'off'])(
    'keeps the configured mode when kill switch is %s',
    (killSwitch) => {
      expect(
        subject({
          CONVERSATION_LAYER_MODE: 'SHADOW',
          CONVERSATION_LAYER_KILL_SWITCH: killSwitch,
        }).get().effectiveMode,
      ).toBe(CONVERSATION_LAYER_MODE.SHADOW);
    },
  );

  it('fails closed when the kill switch value is invalid', () => {
    expect(
      subject({
        CONVERSATION_LAYER_MODE: 'PRIMARY',
        CONVERSATION_LAYER_KILL_SWITCH: 'invalid',
      }).get(),
    ).toEqual({
      configuredMode: CONVERSATION_LAYER_MODE.PRIMARY,
      effectiveMode: CONVERSATION_LAYER_MODE.OFF,
      killSwitchEnabled: true,
    });
  });

  it('returns an immutable configuration snapshot', () => {
    expect(Object.isFrozen(subject({}).get())).toBe(true);
  });
});
