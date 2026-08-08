import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { NutritionPlanImplementation } from '@prisma/client';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { CanonicalNutritionController } from './canonical-nutrition.controller';
import { CurrentNutritionPlanReaderService } from './current-nutrition-plan-reader.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { JwtTokenService } from '../auth/services/jwt-token.service';
import { AuthSessionsService } from '../auth/services/auth-sessions.service';

describe('CanonicalNutritionController', () => {
  function subject(
    current: object | null = { implementation: 'V2', id: 'plan-id' },
  ) {
    const reader = {
      getCurrent: jest.fn().mockResolvedValue(current),
      listHistory: jest.fn().mockResolvedValue([]),
      getByReference: jest.fn().mockResolvedValue(current),
    };
    const subscriptions = {
      getProfileSubscription: jest.fn().mockResolvedValue({ status: 'ACTIVE' }),
    };
    return {
      reader,
      subscriptions,
      controller: new CanonicalNutritionController(
        reader as unknown as CurrentNutritionPlanReaderService,
        subscriptions as unknown as SubscriptionsService,
      ),
    };
  }

  it('protects current/history/reference with subscription and user ownership', async () => {
    const test = subject();
    const user = { userId: 'user-id' } as never;
    await test.controller.getCurrent(user);
    await test.controller.getHistory(user, '25');
    await test.controller.getByReference(
      user,
      NutritionPlanImplementation.V2,
      'plan-id',
    );
    expect(test.subscriptions.getProfileSubscription).toHaveBeenCalledTimes(3);
    expect(test.reader.getByReference).toHaveBeenCalledWith('user-id', {
      implementation: NutritionPlanImplementation.V2,
      id: 'plan-id',
    });
  });

  it('returns explicit not found when no canonical current exists', async () => {
    const test = subject(null);
    await expect(
      test.controller.getCurrent({ userId: 'user-id' } as never),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('declares the real JWT guard and preserves entitlement failures', async () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, CanonicalNutritionController),
    ).toContain(JwtAuthGuard);
    const test = subject();
    test.subscriptions.getProfileSubscription.mockRejectedValueOnce(
      new ForbiddenException(),
    );
    await expect(
      test.controller.getCurrent({ userId: 'user-id' } as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(test.reader.getCurrent).not.toHaveBeenCalled();
  });

  it('passes bounded history limits and propagates canonical conflicts', async () => {
    const test = subject();
    const user = { userId: 'user-id' } as never;
    await test.controller.getHistory(user, '25');
    expect(test.reader.listHistory).toHaveBeenCalledWith('user-id', 25);
    test.reader.getCurrent.mockRejectedValueOnce(new ConflictException());
    await expect(test.controller.getCurrent(user)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('enforces 401/403 and cross-user isolation through the real HTTP guard', async () => {
    const reader = {
      getCurrent: jest.fn().mockResolvedValue({
        implementation: 'V2',
        id: '123e4567-e89b-42d3-a456-426614174001',
        title: 'Plano canônico',
      }),
      listHistory: jest.fn().mockResolvedValue([]),
      getByReference: jest.fn().mockResolvedValue(null),
    };
    const subscriptions = {
      getProfileSubscription: jest.fn().mockResolvedValue({ status: 'ACTIVE' }),
    };
    const token = {
      verifyAccessToken: jest.fn().mockReturnValue({
        sub: 'user-id',
        role: 'USER',
        sessionId: 'session-id',
        jti: 'jti',
      }),
    };
    const sessions = {
      assertSessionActive: jest.fn().mockResolvedValue(undefined),
    };
    const module = await Test.createTestingModule({
      controllers: [CanonicalNutritionController],
      providers: [
        JwtAuthGuard,
        { provide: CurrentNutritionPlanReaderService, useValue: reader },
        { provide: SubscriptionsService, useValue: subscriptions },
        { provide: JwtTokenService, useValue: token },
        { provide: AuthSessionsService, useValue: sessions },
      ],
    }).compile();
    const app: INestApplication = module.createNestApplication();
    await app.init();
    try {
      await request(app.getHttpServer())
        .get('/api/v2/nutrition-plans/current')
        .expect(401);
      await request(app.getHttpServer())
        .get('/api/v2/nutrition-plans/current')
        .set('Authorization', 'Bearer valid')
        .expect(200)
        .expect(({ body }) => {
          expect(body).toMatchObject({ implementation: 'V2' });
        });
      subscriptions.getProfileSubscription.mockRejectedValueOnce(
        new ForbiddenException(),
      );
      await request(app.getHttpServer())
        .get('/api/v2/nutrition-plans/current')
        .set('Authorization', 'Bearer valid')
        .expect(403);
      await request(app.getHttpServer())
        .get('/api/v2/nutrition-plans/V2/123e4567-e89b-42d3-a456-426614174002')
        .set('Authorization', 'Bearer valid')
        .expect(404);
      expect(reader.getByReference).toHaveBeenCalledWith('user-id', {
        implementation: 'V2',
        id: '123e4567-e89b-42d3-a456-426614174002',
      });
    } finally {
      await app.close();
    }
  });
});
