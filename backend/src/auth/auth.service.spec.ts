import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { JwtTokenService } from './services/jwt-token.service';
import { AuthSessionsService } from './services/auth-sessions.service';
import { AuditService } from '../observability/audit.service';
import * as bcrypt from 'bcrypt';
import { UserRole } from '@prisma/client';

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: UsersService,
          useValue: {
            createUser: jest.fn(),
            findByEmailForAuth: jest.fn(),
            findAuthIdentityById: jest.fn(),
            updateLastLoginAt: jest.fn(),
            findById: jest.fn(),
          },
        },
        {
          provide: SubscriptionsService,
          useValue: {
            createPendingSubscription: jest.fn(),
          },
        },
        {
          provide: JwtTokenService,
          useValue: {
            issueTokenPair: jest.fn(),
            verifyRefreshToken: jest.fn(),
          },
        },
        {
          provide: AuthSessionsService,
          useValue: {
            createSession: jest.fn(),
            rotateSession: jest.fn(),
            revokeSession: jest.fn(),
          },
        },
        {
          provide: AuditService,
          useValue: {
            record: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('records a successful login after creating the session', async () => {
    const passwordHash = await bcrypt.hash('StrongPassword123!', 4);
    const usersService = {
      findByEmailForAuth: jest.fn().mockResolvedValue({
        id: 'user-id',
        role: UserRole.USER,
        isActive: true,
        passwordHash,
      }),
      updateLastLoginAt: jest.fn().mockResolvedValue({
        id: 'user-id',
        role: UserRole.USER,
      }),
    };
    const jwtTokenService = {
      issueTokenPair: jest.fn().mockReturnValue({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      }),
    };
    const authSessionsService = {
      createSession: jest.fn(),
    };
    const auditService = {
      record: jest.fn(),
    };
    const subject = new AuthService(
      usersService as unknown as UsersService,
      {} as SubscriptionsService,
      jwtTokenService as unknown as JwtTokenService,
      authSessionsService as unknown as AuthSessionsService,
      auditService as unknown as AuditService,
    );

    await subject.login(
      {
        email: 'user@example.com',
        password: 'StrongPassword123!',
      },
      {
        ipAddress: '127.0.0.1',
        userAgent: 'jest',
      },
    );

    expect(authSessionsService.createSession).toHaveBeenCalled();
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-id',
        action: 'LOGIN',
        entityType: 'USER',
        entityId: 'user-id',
      }),
    );
  });
});
