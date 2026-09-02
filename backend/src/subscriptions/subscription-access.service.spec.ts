import {
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionAccessService } from './subscription-access.service';

describe('SubscriptionAccessService', () => {
  function createSubject(
    subscription: Record<string, unknown> | null,
    updateCount = 1,
  ) {
    const prisma = {
      subscription: {
        findFirst: jest.fn().mockResolvedValue(subscription),
        updateMany: jest.fn().mockResolvedValue({ count: updateCount }),
      },
    };

    return {
      service: new SubscriptionAccessService(
        prisma as unknown as PrismaService,
      ),
      prisma,
    };
  }

  const base = {
    id: 'subscription-id',
    userId: 'user-id',
    planId: 'plan-id',
    status: SubscriptionStatus.ACTIVE,
    currentPeriodEnd: new Date('2026-06-10T12:00:00.000Z'),
    billingPeriodEnd: new Date('2026-06-10T12:00:00.000Z'),
    gracePeriodEnd: new Date('2026-06-13T12:00:00.000Z'),
    cancelAtPeriodEnd: false,
    endedAt: null,
    plan: {
      isActive: true,
    },
  };

  it('blocks exactly at period end without extending coaching through grace', async () => {
    const subject = createSubject(base);

    await expect(
      subject.service.requireAccess(
        'user-id',
        new Date('2026-06-10T12:00:00.000Z'),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(subject.prisma.subscription.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: SubscriptionStatus.EXPIRED,
        }),
      }),
    );
  });

  it('blocks PAST_DUE even while gracePeriodEnd is in the future', async () => {
    const subject = createSubject({
      ...base,
      status: SubscriptionStatus.PAST_DUE,
      currentPeriodEnd: new Date('2026-06-12T12:00:00.000Z'),
      billingPeriodEnd: new Date('2026-06-12T12:00:00.000Z'),
    });

    await expect(
      subject.service.requireAccess(
        'user-id',
        new Date('2026-06-11T12:00:00.000Z'),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(subject.prisma.subscription.updateMany).not.toHaveBeenCalled();
  });

  it('expires and blocks access after the grace period', async () => {
    const subject = createSubject({
      ...base,
      status: SubscriptionStatus.PAST_DUE,
    });

    await expect(
      subject.service.requireAccess(
        'user-id',
        new Date('2026-06-14T12:00:00.000Z'),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(subject.prisma.subscription.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: SubscriptionStatus.EXPIRED,
        }),
      }),
    );
  });

  it('does not extend a cancellation through the grace period', async () => {
    const subject = createSubject({
      ...base,
      cancelAtPeriodEnd: true,
    });

    await expect(
      subject.service.requireAccess(
        'user-id',
        new Date('2026-06-10T12:00:00.000Z'),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(subject.prisma.subscription.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: SubscriptionStatus.CANCELED,
        }),
      }),
    );
  });

  it('rejects malformed subscriptions without an access period', async () => {
    const subject = createSubject({
      ...base,
      currentPeriodEnd: null,
      billingPeriodEnd: null,
    });

    await expect(
      subject.service.requireAccess('user-id'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
