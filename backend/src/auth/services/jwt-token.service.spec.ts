import { ConfigService } from '@nestjs/config';
import { UserRole } from '@prisma/client';
import { JwtTokenService } from './jwt-token.service';

describe('JwtTokenService', () => {
  let service: JwtTokenService;

  beforeEach(() => {
    const values: Record<string, string> = {
      JWT_ACCESS_SECRET: 'test-access-secret-with-sufficient-entropy',
      JWT_REFRESH_SECRET: 'test-refresh-secret-with-sufficient-entropy',
      JWT_ISSUER: 'lucyfit-test-api',
      JWT_AUDIENCE: 'lucyfit-test-app',
    };
    const configService = {
      get: <T>(key: string): T | undefined => values[key] as T | undefined,
    } as ConfigService;

    service = new JwtTokenService(configService);
  });

  it('issues access and refresh tokens with the required claims', () => {
    const tokens = service.issueTokenPair({
      userId: '5e2172b9-7b1d-44c8-8a15-6c9346894f08',
      role: UserRole.USER,
      sessionId: 'fc0bfd65-3e68-4981-87cc-5c66550f906a',
      accessJti: 'bb48915d-5510-4e5c-a40c-65691a10825f',
      refreshJti: '5bf1512a-27bc-4f88-a5eb-ff6f3a86774e',
    });

    const accessPayload = service.verifyAccessToken(tokens.accessToken);
    const refreshPayload = service.verifyRefreshToken(tokens.refreshToken);

    expect(accessPayload).toEqual(
      expect.objectContaining({
        sub: '5e2172b9-7b1d-44c8-8a15-6c9346894f08',
        role: UserRole.USER,
        sessionId: 'fc0bfd65-3e68-4981-87cc-5c66550f906a',
        jti: 'bb48915d-5510-4e5c-a40c-65691a10825f',
        iss: 'lucyfit-test-api',
        aud: 'lucyfit-test-app',
        tokenType: 'access',
      }),
    );
    expect(refreshPayload).toEqual(
      expect.objectContaining({
        jti: '5bf1512a-27bc-4f88-a5eb-ff6f3a86774e',
        tokenType: 'refresh',
      }),
    );
    expect(accessPayload.exp - accessPayload.iat).toBe(15 * 60);
    expect(refreshPayload.exp - refreshPayload.iat).toBe(30 * 24 * 60 * 60);
  });

  it('does not accept a refresh token as an access token', () => {
    const tokens = service.issueTokenPair({
      userId: '5e2172b9-7b1d-44c8-8a15-6c9346894f08',
      role: UserRole.ADMIN,
      sessionId: 'fc0bfd65-3e68-4981-87cc-5c66550f906a',
      accessJti: 'bb48915d-5510-4e5c-a40c-65691a10825f',
      refreshJti: '5bf1512a-27bc-4f88-a5eb-ff6f3a86774e',
    });

    expect(() => service.verifyAccessToken(tokens.refreshToken)).toThrow(
      'Token inválido ou expirado',
    );
  });
});
