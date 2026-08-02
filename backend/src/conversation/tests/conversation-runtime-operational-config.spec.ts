import { ConfigService } from '@nestjs/config';
import { ConversationRuntimeOperationalConfigService } from '../runtime/conversation-runtime-operational-config.service';

describe('ConversationRuntimeOperationalConfigService', () => {
  function subject(values: Readonly<Record<string, string>>) {
    return new ConversationRuntimeOperationalConfigService(
      new ConfigService(values),
    );
  }

  it('fails closed with safe defaults', () => {
    const service = subject({});

    expect(service.get()).toEqual({
      mode: 'OFF',
      killSwitch: false,
      internalUserIds: [],
      canaryPercentage: 0,
      timeoutMs: 25_000,
      valid: true,
    });
  });

  it.each([
    'OFF',
    'SHADOW',
    'INTERNAL',
    'CANARY',
    'ROLLOUT',
    'PRIMARY',
  ] as const)('accepts the %s mode', (mode) => {
    expect(subject({ CONVERSATION_RUNTIME_MODE: mode }).get().mode).toBe(mode);
  });

  it('applies the kill switch before every mode', () => {
    const config = subject({
      CONVERSATION_RUNTIME_MODE: 'PRIMARY',
      CONVERSATION_RUNTIME_KILL_SWITCH: 'true',
    }).get();

    expect(config.mode).toBe('OFF');
    expect(config.killSwitch).toBe(true);
  });

  it.each([
    { CONVERSATION_RUNTIME_MODE: 'INVALID' },
    { CONVERSATION_RUNTIME_KILL_SWITCH: 'yes' },
    { CONVERSATION_RUNTIME_CANARY_PERCENTAGE: '101' },
    { CONVERSATION_RUNTIME_TIMEOUT_MS: '999' },
  ])('fails closed for invalid configuration: %o', (values) => {
    const config = subject(values).get();

    expect(config.valid).toBe(false);
    expect(config.mode).toBe('OFF');
  });

  it('uses an explicit internal allowlist', () => {
    const service = subject({
      CONVERSATION_RUNTIME_MODE: 'INTERNAL',
      CONVERSATION_RUNTIME_INTERNAL_USER_IDS: 'user-1, user-2',
    });

    expect(service.isOfficiallyEligible('user-1')).toBe(true);
    expect(service.isOfficiallyEligible('other')).toBe(false);
  });

  it('uses a stable deterministic percentage bucket', () => {
    const service = subject({
      CONVERSATION_RUNTIME_MODE: 'CANARY',
      CONVERSATION_RUNTIME_CANARY_PERCENTAGE: '37',
    });

    expect(service.isOfficiallyEligible('stable-user')).toBe(
      service.isOfficiallyEligible('stable-user'),
    );
    expect(
      subject({
        CONVERSATION_RUNTIME_MODE: 'CANARY',
        CONVERSATION_RUNTIME_CANARY_PERCENTAGE: '0',
      }).isOfficiallyEligible('any-user'),
    ).toBe(false);
    expect(
      subject({
        CONVERSATION_RUNTIME_MODE: 'ROLLOUT',
        CONVERSATION_RUNTIME_CANARY_PERCENTAGE: '100',
      }).isOfficiallyEligible('any-user'),
    ).toBe(true);
  });

  it('authorizes every user only in PRIMARY', () => {
    const service = subject({ CONVERSATION_RUNTIME_MODE: 'PRIMARY' });

    expect(service.isOfficiallyEligible('user-id')).toBe(true);
  });
});
