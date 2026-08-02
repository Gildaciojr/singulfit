import { ForbiddenException } from '@nestjs/common';
import { SubscriptionStatus } from '@prisma/client';
import { AutomationService } from '../automation/automation.service';
import { BillingService } from '../billing/billing.service';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionAccessService } from './subscription-access.service';
import { SubscriptionLifecycleService } from './subscription-lifecycle.service';

describe('SubscriptionLifecycleService', () => {
  function subject(input?: { denied?: boolean; periodEnd?: Date }) {
    const periodEnd = input?.periodEnd ?? new Date('2026-08-10T12:00:00.000Z');
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          name: 'Gil da Silva',
          subscriptions: [{ status: SubscriptionStatus.EXPIRED }],
        }),
      },
      subscription: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'subscription-id',
            userId: 'user-id',
            status: SubscriptionStatus.ACTIVE,
            currentPeriodEnd: periodEnd,
            gracePeriodEnd: new Date('2026-08-13T12:00:00.000Z'),
            user: { name: 'Gil da Silva' },
          },
        ]),
      },
    };
    const billing = {
      getOrCreatePayableInvoice: jest.fn().mockResolvedValue({}),
    };
    const automation = {
      scheduleSubscriptionNotice: jest.fn().mockResolvedValue({}),
    };
    const access = {
      requireAccess: input?.denied
        ? jest.fn().mockRejectedValue(new ForbiddenException('Expirada'))
        : jest.fn().mockResolvedValue({ id: 'subscription-id' }),
    };
    return {
      service: new SubscriptionLifecycleService(
        prisma as unknown as PrismaService,
        billing as unknown as BillingService,
        automation as unknown as AutomationService,
        access as unknown as SubscriptionAccessService,
      ),
      billing,
      automation,
      access,
    };
  }

  it('blocks before paid processing and schedules one minimal response', async () => {
    const test = subject({ denied: true });
    await expect(
      test.service.authorizeOrNotify(
        'user-id',
        'message-id',
        new Date('2026-08-14T12:00:00.000Z'),
      ),
    ).resolves.toBe(false);
    expect(test.automation.scheduleSubscriptionNotice).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-id',
        noticeKey: 'access-blocked:message-id',
      }),
    );
  });

  it('creates the renewal invoice and the seven-day notice', async () => {
    const test = subject();
    await expect(
      test.service.processDue(new Date('2026-08-03T12:00:00.000Z')),
    ).resolves.toEqual({ scanned: 1, processed: 1 });
    expect(test.billing.getOrCreatePayableInvoice).toHaveBeenCalledWith(
      'user-id',
      new Date('2026-08-03T12:00:00.000Z'),
    );
    expect(test.automation.scheduleSubscriptionNotice).toHaveBeenCalledWith(
      expect.objectContaining({
        noticeKey: expect.stringContaining('before-7'),
      }),
    );
  });

  it('uses cycle identity for an idempotent reactivation welcome', async () => {
    const test = subject();
    await test.service.notifyActivated(
      'user-id',
      4,
      true,
      new Date('2026-08-14T12:00:00.000Z'),
    );
    expect(test.automation.scheduleSubscriptionNotice).toHaveBeenCalledWith(
      expect.objectContaining({
        noticeKey: 'activated:cycle-4',
        content: expect.stringContaining('Mantive todo o seu histórico'),
      }),
    );
  });

  it('creates a missing renewal invoice after due date during grace', async () => {
    const test = subject();
    await test.service.processDue(new Date('2026-08-11T12:00:00.000Z'));
    expect(test.billing.getOrCreatePayableInvoice).toHaveBeenCalledWith(
      'user-id',
      new Date('2026-08-11T12:00:00.000Z'),
    );
    expect(test.access.requireAccess).toHaveBeenCalled();
  });
});
