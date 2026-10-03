import { SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SubscriptionAccessService } from '../../subscriptions/subscription-access.service';
import { ProfileAcquisitionAuthorizationService } from './profile-acquisition-authorization.service';
import { ProfileAcquisitionOperationalConfigService } from './profile-acquisition-operational-config.service';
import { ProfileAcquisitionInternalEligibilityService } from './profile-acquisition-internal-eligibility.service';
import {
  PROFILE_ACQUISITION_MODE as Mode,
  ProfileAcquisitionMode,
} from './profile-acquisition.contract';

describe('Commercial profile acquisition access', () => {
  const at = new Date('2026-10-02T15:00:00Z');
  function setup(mode: ProfileAcquisitionMode = Mode.PRODUCTIVE) {
    const user = {
      id: 'user-a',
      role: 'USER',
      isActive: true,
      onboardingCompleted: true,
    };
    const subscription = {
      id: 'subscription-a',
      userId: user.id,
      status: SubscriptionStatus.ACTIVE,
      plan: { code: 'BASIC', isActive: true },
      currentPeriodEnd: new Date('2027-01-01'),
      billingPeriodEnd: null,
      endedAt: null,
      cancelAtPeriodEnd: false,
    };
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(user) },
      subscription: {
        findFirst: jest.fn().mockResolvedValue(subscription),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const internal = {
      evaluate: jest
        .fn()
        .mockResolvedValue({ internal: false, eligible: false }),
    };
    const access = new SubscriptionAccessService(
      prisma as unknown as PrismaService,
    );
    const service = new ProfileAcquisitionAuthorizationService(
      prisma as unknown as PrismaService,
      {
        get: () => ({ mode }),
      } as unknown as ProfileAcquisitionOperationalConfigService,
      internal as unknown as ProfileAcquisitionInternalEligibilityService,
      access,
    );
    return { service, prisma, user, subscription, internal };
  }

  it.each(['BASIC', 'PREMIUM'])(
    'allows paid USER %s through the canonical policy',
    async (code) => {
      const s = setup();
      s.subscription.plan.code = code;
      await expect(s.service.isAllowed('user-a', at)).resolves.toBe(true);
      expect(s.internal.evaluate).not.toHaveBeenCalled();
    },
  );
  it.each([
    SubscriptionStatus.PENDING_PAYMENT,
    SubscriptionStatus.EXPIRED,
    SubscriptionStatus.CANCELED,
    SubscriptionStatus.PAST_DUE,
  ])('rejects canonical denial for %s', async (status) => {
    const s = setup();
    s.subscription.status = status;
    await expect(s.service.isAllowed('user-a', at)).resolves.toBe(false);
  });
  it('rejects an expired ACTIVE period through canonical expiration', async () => {
    const s = setup();
    s.subscription.currentPeriodEnd = new Date('2026-01-01');
    await expect(s.service.isAllowed('user-a', at)).resolves.toBe(false);
    expect(s.prisma.subscription.updateMany).toHaveBeenCalledTimes(1);
  });
  it('rejects inactive users before subscription access', async () => {
    const s = setup();
    s.user.isActive = false;
    await expect(s.service.isAllowed('user-a', at)).resolves.toBe(false);
    expect(s.prisma.subscription.findFirst).not.toHaveBeenCalled();
  });
  it('does not grant PRODUCTIVE access merely because the user is ADMIN', async () => {
    const s = setup();
    s.user.role = 'ADMIN';
    s.prisma.subscription.findFirst.mockResolvedValue(null);
    await expect(s.service.isAllowed('user-a', at)).resolves.toBe(false);
    expect(s.internal.evaluate).not.toHaveBeenCalled();
  });
  it('rejects foreign user and subscription records', async () => {
    const s = setup();
    s.subscription.userId = 'user-b';
    await expect(s.service.isAllowed('user-a', at)).resolves.toBe(false);
    s.user.id = 'user-b';
    await expect(s.service.isAllowed('user-a', at)).resolves.toBe(false);
  });
  it.each([Mode.OFF, Mode.SHADOW])('does not acquire in %s', async (mode) => {
    const s = setup(mode);
    await expect(s.service.isAllowed('user-a', at)).resolves.toBe(false);
    expect(s.prisma.subscription.findFirst).not.toHaveBeenCalled();
  });
  it('keeps USER blocked and ADMIN eligible in INTERNAL', async () => {
    const s = setup(Mode.INTERNAL);
    await expect(s.service.isAllowed('user-a', at)).resolves.toBe(false);
    s.internal.evaluate.mockResolvedValue({ internal: true, eligible: true });
    await expect(s.service.isAllowed('admin', at)).resolves.toBe(true);
    expect(s.prisma.subscription.findFirst).not.toHaveBeenCalled();
  });
});
