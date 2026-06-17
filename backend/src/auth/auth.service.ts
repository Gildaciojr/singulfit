import { randomUUID } from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { RegisterDto } from './dto/register.dto';
import { UsersService } from '../users/users.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { LogoutDto } from './dto/logout.dto';
import { AuthRequestMetadata } from './interfaces/auth-request-metadata.interface';
import { JwtTokenService } from './services/jwt-token.service';
import { AuthSessionsService } from './services/auth-sessions.service';
import { AuthenticatedUser } from './interfaces/jwt-auth-payload.interface';
import { UserRole } from '@prisma/client';
import { AuditService } from '../observability/audit.service';
import {
  AUDIT_ACTION,
  AUDIT_ENTITY,
} from '../observability/observability.constants';

@Injectable()
export class AuthService {
  private static readonly PASSWORD_SALT_ROUNDS = 12;

  constructor(
    private readonly usersService: UsersService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly jwtTokenService: JwtTokenService,
    private readonly authSessionsService: AuthSessionsService,
    private readonly auditService: AuditService,
  ) {}

  async register(data: RegisterDto, metadata: AuthRequestMetadata = {}) {
    const passwordHash = await bcrypt.hash(
      data.password,
      AuthService.PASSWORD_SALT_ROUNDS,
    );

    const user = await this.usersService.createUser({
      name: data.name,
      phone: data.phone,
      email: data.email,
      passwordHash,
      cpf: data.cpf,
      address: data.address,
      city: data.city,
      state: data.state,
      zipCode: data.zipCode,
    });

    const subscription =
      await this.subscriptionsService.createPendingSubscription(
        user.id,
        data.planType,
      );
    const authenticatedUser = await this.usersService.updateLastLoginAt(
      user.id,
    );
    const tokens = await this.createAuthenticatedSession(
      authenticatedUser.id,
      authenticatedUser.role,
      metadata,
    );

    return {
      message: 'Cadastro realizado com sucesso. Aguardando pagamento.',
      user: authenticatedUser,
      subscription,
      tokens,
    };
  }

  async login(data: LoginDto, metadata: AuthRequestMetadata = {}) {
    const user = await this.usersService.findByEmailForAuth(data.email);

    if (
      !user ||
      !user.isActive ||
      !user.passwordHash ||
      !(await bcrypt.compare(data.password, user.passwordHash))
    ) {
      throw new UnauthorizedException('E-mail ou senha inválidos');
    }

    const authenticatedUser = await this.usersService.updateLastLoginAt(
      user.id,
    );
    const tokens = await this.createAuthenticatedSession(
      user.id,
      user.role,
      metadata,
    );
    await this.auditService.record({
      userId: user.id,
      action: AUDIT_ACTION.LOGIN,
      entityType: AUDIT_ENTITY.USER,
      entityId: user.id,
      metadata: {
        ipAddress: metadata.ipAddress ?? null,
        userAgent: metadata.userAgent ?? null,
      },
    });

    return {
      user: authenticatedUser,
      tokens,
    };
  }

  async refresh(data: RefreshTokenDto, metadata: AuthRequestMetadata = {}) {
    const currentPayload = this.jwtTokenService.verifyRefreshToken(
      data.refreshToken,
    );
    const user = await this.usersService.findAuthIdentityById(
      currentPayload.sub,
    );

    if (!user?.isActive) {
      throw new UnauthorizedException('Usuário inativo ou inexistente');
    }

    const nextSessionId = randomUUID();
    const nextRefreshJti = randomUUID();
    const tokens = this.jwtTokenService.issueTokenPair({
      userId: user.id,
      role: user.role,
      sessionId: nextSessionId,
      accessJti: randomUUID(),
      refreshJti: nextRefreshJti,
    });

    await this.authSessionsService.rotateSession({
      currentPayload,
      currentRefreshToken: data.refreshToken,
      nextSession: {
        id: nextSessionId,
        userId: user.id,
        refreshToken: tokens.refreshToken,
        jti: nextRefreshJti,
        expiresAt: this.getRefreshExpirationDate(),
        ...metadata,
      },
    });

    return {
      tokens,
    };
  }

  async logout(data: LogoutDto) {
    const payload = this.jwtTokenService.verifyRefreshToken(data.refreshToken);

    await this.authSessionsService.revokeSession(payload, data.refreshToken);

    return {
      message: 'Logout realizado com sucesso',
    };
  }

  async me(authenticatedUser: AuthenticatedUser) {
    return this.usersService.findById(authenticatedUser.userId);
  }

  private async createAuthenticatedSession(
    userId: string,
    role: UserRole,
    metadata: AuthRequestMetadata,
  ) {
    const sessionId = randomUUID();
    const refreshJti = randomUUID();
    const tokens = this.jwtTokenService.issueTokenPair({
      userId,
      role,
      sessionId,
      accessJti: randomUUID(),
      refreshJti,
    });

    await this.authSessionsService.createSession({
      id: sessionId,
      userId,
      refreshToken: tokens.refreshToken,
      jti: refreshJti,
      expiresAt: this.getRefreshExpirationDate(),
      ...metadata,
    });

    return tokens;
  }

  private getRefreshExpirationDate(): Date {
    return new Date(
      Date.now() + JwtTokenService.REFRESH_TOKEN_TTL_SECONDS * 1000,
    );
  }
}
