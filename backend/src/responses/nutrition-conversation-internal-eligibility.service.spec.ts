import { ConfigService } from '@nestjs/config';
import { NutritionConversationInternalEligibilityService } from './nutrition-conversation-internal-eligibility.service';

describe('NutritionConversationInternalEligibilityService', () => {
  function subject(value: string | undefined) {
    const config = {
      get: jest.fn().mockReturnValue(value),
    };
    return new NutritionConversationInternalEligibilityService(
      config as unknown as ConfigService,
    );
  }

  it.each([undefined, '', '   '])(
    'fails closed when the INTERNAL allowlist is %p',
    (value) => {
      expect(subject(value).isEligible('user-a')).toBe(false);
    },
  );

  it('uses exact user IDs and rejects users outside the allowlist', () => {
    const service = subject('user-a,user-b');

    expect(service.isEligible('user-a')).toBe(true);
    expect(service.isEligible('user-c')).toBe(false);
    expect(service.isEligible('user')).toBe(false);
  });

  it('trims, ignores empty entries and deduplicates the allowlist', () => {
    const service = subject(' user-a , user-b,user-a ,, ');

    expect(service.isEligible('user-a')).toBe(true);
    expect(service.isEligible('user-b')).toBe(true);
    expect(service.isEligible('')).toBe(false);
  });
});
