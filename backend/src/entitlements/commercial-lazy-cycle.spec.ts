import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionAccessService } from '../subscriptions/subscription-access.service';
import {
  EntitlementsService,
  type CommercialEntitlementGrant,
} from './entitlements.service';

describe('EntitlementsService commercial lazy cycle', () => {
  const previousStart = new Date('2026-08-01T00:00:00.000Z');
  const previousEnd = new Date('2026-09-01T00:00:00.000Z');
  const currentStart = new Date('2026-09-01T00:00:00.000Z');
  const currentEnd = new Date('2026-10-01T00:00:00.000Z');

  function resolve(
    code: CommercialEntitlementGrant['code'],
    value: number,
    unlimited = false,
    periodStart = currentStart,
    periodEnd = currentEnd,
  ) {
    const subscription = {
      userId: 'user-id',
      planId: 'plan-id',
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
    };
    const transaction = {
      planEntitlement: {
        findFirst: jest.fn().mockResolvedValue({ value, unlimited }),
      },
      usageBucket: {
        deleteMany: jest.fn(),
        updateMany: jest.fn(),
        create: jest.fn(),
      },
    };
    const access = {
      requireAccessInTransaction: jest.fn().mockResolvedValue(subscription),
    };
    const service = new EntitlementsService(
      {} as PrismaService,
      access as unknown as SubscriptionAccessService,
    );
    return {
      transaction,
      resolve: () =>
        service.resolveCommercialGrantInTransaction(
          transaction as unknown as Prisma.TransactionClient,
          subscription.userId,
          code,
          periodStart,
        ),
    };
  }

  it('resolves BASIC Nutrition as 1 in the new cycle', async () => {
    await expect(
      resolve('NUTRITION_PLAN_GENERATION', 1).resolve(),
    ).resolves.toMatchObject({
      limit: 1,
      unlimited: false,
      periodStart: currentStart,
      periodEnd: currentEnd,
    });
  });

  it('resolves BASIC Workout as 1 in the new cycle', async () => {
    await expect(
      resolve('WORKOUT_PLAN_GENERATION', 1).resolve(),
    ).resolves.toMatchObject({ limit: 1 });
  });

  it('resolves BASIC Images as 5 in the new cycle', async () => {
    await expect(resolve('IMAGE_ANALYSIS', 5).resolve()).resolves.toMatchObject(
      { limit: 5 },
    );
  });

  it('does not let prior fully consumed usage change the new grant', async () => {
    await expect(resolve('IMAGE_ANALYSIS', 5).resolve()).resolves.toMatchObject(
      { periodStart: currentStart, limit: 5 },
    );
  });

  it('does not delete prior UsageBucket history while resolving a new cycle', async () => {
    const test = resolve('NUTRITION_PLAN_GENERATION', 1);
    await test.resolve();
    expect(test.transaction.usageBucket.deleteMany).not.toHaveBeenCalled();
    expect(test.transaction.usageBucket.updateMany).not.toHaveBeenCalled();
  });

  it('uses a distinct period identity for the new commercial cycle', async () => {
    const previous = await resolve(
      'WORKOUT_PLAN_GENERATION',
      1,
      false,
      previousStart,
      previousEnd,
    ).resolve();
    const next = await resolve('WORKOUT_PLAN_GENERATION', 1).resolve();
    expect([previous.periodStart, previous.periodEnd]).not.toEqual([
      next.periodStart,
      next.periodEnd,
    ]);
  });

  it('keeps entitlement resolution lazy without eager bucket provisioning', async () => {
    const test = resolve('IMAGE_ANALYSIS', 5);
    await test.resolve();
    expect(test.transaction.usageBucket.create).not.toHaveBeenCalled();
  });

  it('resolves the initial PREMIUM cycle as unlimited', async () => {
    await expect(
      resolve('NUTRITION_PLAN_GENERATION', 0, true).resolve(),
    ).resolves.toMatchObject({ unlimited: true, limit: null });
  });

  it('resolves the next PREMIUM cycle as unlimited', async () => {
    await expect(
      resolve('WORKOUT_PLAN_GENERATION', 0, true).resolve(),
    ).resolves.toMatchObject({
      unlimited: true,
      limit: null,
      periodStart: currentStart,
    });
  });

  it('does not assign PREMIUM a finite BASIC quota', async () => {
    await expect(
      resolve('IMAGE_ANALYSIS', 0, true).resolve(),
    ).resolves.toMatchObject({ unlimited: true, limit: null });
  });
});
