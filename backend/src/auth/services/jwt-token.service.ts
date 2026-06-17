import {
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '@prisma/client';
import {
  JwtPayload,
  SignOptions,
  sign,
  verify,
  VerifyOptions,
} from 'jsonwebtoken';
import { AuthTokens } from '../interfaces/auth-tokens.interface';
import {
  JwtAuthPayload,
  JwtTokenType,
} from '../interfaces/jwt-auth-payload.interface';

interface IssueTokenPairInput {
  userId: string;
  role: UserRole;
  sessionId: string;
  accessJti: string;
  refreshJti: string;
}

@Injectable()
export class JwtTokenService {
  static readonly ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
  static readonly REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

  private readonly accessSecret: string;
  private readonly refreshSecret: string;
  private readonly issuer: string;
  private readonly audience: string;

  constructor(private readonly configService: ConfigService) {
    const fallbackSecret = this.configService.get<string>('JWT_SECRET');

    this.accessSecret =
      this.configService.get<string>('JWT_ACCESS_SECRET') ??
      fallbackSecret ??
      '';
    this.refreshSecret =
      this.configService.get<string>('JWT_REFRESH_SECRET') ??
      fallbackSecret ??
      '';
    this.issuer = this.configService.get<string>('JWT_ISSUER') ?? 'lucyfit-api';
    this.audience =
      this.configService.get<string>('JWT_AUDIENCE') ?? 'lucyfit-app';

    if (!this.accessSecret || !this.refreshSecret) {
      throw new InternalServerErrorException(
        'Segredos JWT não foram configurados',
      );
    }
  }

  issueTokenPair(input: IssueTokenPairInput): AuthTokens {
    const accessToken = this.signToken(
      input,
      'access',
      input.accessJti,
      JwtTokenService.ACCESS_TOKEN_TTL_SECONDS,
      this.accessSecret,
    );
    const refreshToken = this.signToken(
      input,
      'refresh',
      input.refreshJti,
      JwtTokenService.REFRESH_TOKEN_TTL_SECONDS,
      this.refreshSecret,
    );

    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      accessTokenExpiresIn: JwtTokenService.ACCESS_TOKEN_TTL_SECONDS,
      refreshTokenExpiresIn: JwtTokenService.REFRESH_TOKEN_TTL_SECONDS,
    };
  }

  verifyAccessToken(token: string): JwtAuthPayload {
    return this.verifyToken(token, 'access', this.accessSecret);
  }

  verifyRefreshToken(token: string): JwtAuthPayload {
    return this.verifyToken(token, 'refresh', this.refreshSecret);
  }

  private signToken(
    input: IssueTokenPairInput,
    tokenType: JwtTokenType,
    jti: string,
    expiresIn: number,
    secret: string,
  ): string {
    const options: SignOptions = {
      algorithm: 'HS256',
      subject: input.userId,
      jwtid: jti,
      issuer: this.issuer,
      audience: this.audience,
      expiresIn,
    };

    return sign(
      {
        role: input.role,
        sessionId: input.sessionId,
        tokenType,
      },
      secret,
      options,
    );
  }

  private verifyToken(
    token: string,
    expectedType: JwtTokenType,
    secret: string,
  ): JwtAuthPayload {
    try {
      const options: VerifyOptions = {
        algorithms: ['HS256'],
        issuer: this.issuer,
        audience: this.audience,
      };
      const decoded = verify(token, secret, options);

      if (
        typeof decoded === 'string' ||
        !this.isValidPayload(decoded, expectedType)
      ) {
        throw new UnauthorizedException('Token inválido');
      }

      return decoded;
    } catch (error: unknown) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }

      throw new UnauthorizedException('Token inválido ou expirado');
    }
  }

  private isValidPayload(
    payload: JwtPayload,
    expectedType: JwtTokenType,
  ): payload is JwtPayload & JwtAuthPayload {
    return (
      typeof payload.sub === 'string' &&
      Object.values(UserRole).includes(payload.role as UserRole) &&
      typeof payload.sessionId === 'string' &&
      typeof payload.jti === 'string' &&
      typeof payload.iss === 'string' &&
      (typeof payload.aud === 'string' || Array.isArray(payload.aud)) &&
      typeof payload.iat === 'number' &&
      typeof payload.exp === 'number' &&
      payload.tokenType === expectedType
    );
  }
}
