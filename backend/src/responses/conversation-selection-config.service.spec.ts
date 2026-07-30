import { ConfigService } from '@nestjs/config';
import { CONVERSATION_SELECTION_ROLLOUT_MODE } from './conversation-candidate-selection.contract';
import { ConversationSelectionConfigService } from './conversation-selection-config.service';

describe('ConversationSelectionConfigService', () => {
  function subject(values: Readonly<Record<string, string | undefined>>) {
    const configService = { get: (key: string) => values[key] };
    return new ConversationSelectionConfigService(
      configService as ConfigService,
    );
  }

  it('defaults deterministically to rollout OFF', () => {
    expect(subject({}).get()).toEqual({
      configuredMode: CONVERSATION_SELECTION_ROLLOUT_MODE.OFF,
      effectiveMode: CONVERSATION_SELECTION_ROLLOUT_MODE.OFF,
      formatterVersion: 'nutrition-response-formatter:v1',
    });
  });

  it.each(['INTERNAL', 'CANARY', 'ROLLOUT', 'PRIMARY'] as const)(
    'recognizes %s but keeps Macro H release-locked in OFF',
    (configuredMode) => {
      expect(
        subject({
          CONVERSATION_CANDIDATE_SELECTION_MODE: configuredMode,
        }).get(),
      ).toEqual({
        configuredMode,
        effectiveMode: CONVERSATION_SELECTION_ROLLOUT_MODE.OFF,
        formatterVersion: 'nutrition-response-formatter:v1',
      });
    },
  );

  it('fails closed for an invalid mode and resolves a centralized formatter version', () => {
    expect(
      subject({
        CONVERSATION_CANDIDATE_SELECTION_MODE: 'unexpected',
        NUTRITION_RESPONSE_FORMATTER_VERSION: ' formatter:v2 ',
      }).get(),
    ).toEqual({
      configuredMode: CONVERSATION_SELECTION_ROLLOUT_MODE.OFF,
      effectiveMode: CONVERSATION_SELECTION_ROLLOUT_MODE.OFF,
      formatterVersion: 'formatter:v2',
    });
  });

  it('returns an immutable snapshot', () => {
    expect(Object.isFrozen(subject({}).get())).toBe(true);
  });
});
