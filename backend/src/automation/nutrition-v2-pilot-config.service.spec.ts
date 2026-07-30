import { ConfigService } from '@nestjs/config';
import { NutritionV2PilotConfigService } from './nutrition-v2-pilot-config.service';

const USER_ID = '123e4567-e89b-42d3-a456-426614174000';
const OTHER_USER_ID = '123e4567-e89b-42d3-a456-426614174001';

describe('NutritionV2PilotConfigService', () => {
  function subject(environment: Record<string, string | undefined>) {
    const config = {
      get: jest.fn((key: string) => environment[key]),
    };
    return {
      config,
      service: new NutritionV2PilotConfigService(
        config as unknown as ConfigService,
      ),
    };
  }

  it.each([
    {},
    { NUTRITION_V2_PILOT_ENABLED: '' },
    { NUTRITION_V2_PILOT_ENABLED: 'false' },
  ])(
    'fails closed when the kill switch is disabled or absent',
    (environment) => {
      expect(subject(environment).service.authorize(USER_ID)).toEqual({
        status: 'DISABLED',
      });
    },
  );

  it.each(['TRUE', ' true ', '1', 'yes'])(
    'rejects the unexpected kill-switch value %s',
    (value) => {
      expect(
        subject({
          NUTRITION_V2_PILOT_ENABLED: value,
          NUTRITION_V2_PILOT_USER_IDS: USER_ID,
        }).service.authorize(USER_ID),
      ).toEqual({ status: 'INVALID_CONFIG' });
    },
  );

  it.each([undefined, '', ' , , '])(
    'authorizes nobody when the allowlist is empty',
    (allowlist) => {
      expect(
        subject({
          NUTRITION_V2_PILOT_ENABLED: 'true',
          NUTRITION_V2_PILOT_USER_IDS: allowlist,
        }).service.authorize(USER_ID),
      ).toEqual({ status: 'NOT_AUTHORIZED' });
    },
  );

  it('normalizes spaces, case and empty entries in the allowlist', () => {
    expect(
      subject({
        NUTRITION_V2_PILOT_ENABLED: 'true',
        NUTRITION_V2_PILOT_USER_IDS: ` , ${USER_ID.toUpperCase()} , , ${OTHER_USER_ID} `,
      }).service.authorize(USER_ID),
    ).toEqual({ status: 'AUTHORIZED' });
  });

  it('invalidates the complete allowlist when one identifier is invalid', () => {
    expect(
      subject({
        NUTRITION_V2_PILOT_ENABLED: 'true',
        NUTRITION_V2_PILOT_USER_IDS: `${USER_ID},not-a-uuid`,
      }).service.authorize(USER_ID),
    ).toEqual({ status: 'INVALID_CONFIG' });
  });

  it('removes authorization as soon as the current configuration no longer lists the user', () => {
    const environment: Record<string, string | undefined> = {
      NUTRITION_V2_PILOT_ENABLED: 'true',
      NUTRITION_V2_PILOT_USER_IDS: USER_ID,
    };
    const test = subject(environment);

    expect(test.service.authorize(USER_ID)).toEqual({ status: 'AUTHORIZED' });
    environment.NUTRITION_V2_PILOT_USER_IDS = OTHER_USER_ID;
    expect(test.service.authorize(USER_ID)).toEqual({
      status: 'NOT_AUTHORIZED',
    });
  });
});
