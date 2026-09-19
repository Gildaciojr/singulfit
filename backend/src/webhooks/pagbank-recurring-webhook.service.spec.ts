import { PaymentProvider, SubscriptionStatus } from '@prisma/client';
import { PagBankRecurringGateway } from '../pagbank/pagbank-recurring.gateway';
import { PagBankRecurringReconciliationService } from '../payments/pagbank-recurring-reconciliation.service';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { PagBankRecurringWebhookService } from './pagbank-recurring-webhook.service';

describe('PagBankRecurringWebhookService grace policy', () => {
  const externalSubscriptionId = 'SUBS_GRACE';
  const existingGrace = new Date('2026-10-04T00:00:00.000Z');
  const canonicalGrace = new Date('2026-10-05T00:00:00.000Z');

  function subject(providerStatus: string, gracePeriodEnd: Date | null = null) {
    const prisma = {
      subscription: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'subscription-id',
          provider: PaymentProvider.PAGBANK,
          externalSubscriptionId,
          status: SubscriptionStatus.PAST_DUE,
          currentPeriodEnd: new Date('2026-10-01T00:00:00.000Z'),
          gracePeriodEnd,
        }),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
    };
    const gateway = {
      getSubscription: jest.fn().mockResolvedValue({
        id: externalSubscriptionId,
        status: providerStatus,
      }),
    };
    const reconciliation = {
      reconcile: jest.fn().mockResolvedValue({ outcomes: ['APPROVED'] }),
    };
    const subscriptions = {
      calculateGracePeriodEnd: jest.fn().mockReturnValue(canonicalGrace),
    };
    return {
      prisma,
      gateway,
      reconciliation,
      subscriptions,
      service: new PagBankRecurringWebhookService(
        prisma as unknown as PrismaService,
        gateway as unknown as PagBankRecurringGateway,
        reconciliation as unknown as PagBankRecurringReconciliationService,
        subscriptions as unknown as SubscriptionsService,
      ),
    };
  }

  it('uses the existing grace policy for OVERDUE', async () => {
    const { prisma, subscriptions, service } = subject('OVERDUE');
    await service.process(externalSubscriptionId, 'subscription.updated');
    expect(subscriptions.calculateGracePeriodEnd).toHaveBeenCalledWith(
      new Date('2026-10-01T00:00:00.000Z'),
    );
    expect(prisma.subscription.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: SubscriptionStatus.PAST_DUE,
          gracePeriodEnd: canonicalGrace,
        }),
      }),
    );
  });

  it('keeps grace stable when OVERDUE is replayed', async () => {
    const { prisma, subscriptions, service } = subject(
      'OVERDUE',
      existingGrace,
    );
    await service.process(externalSubscriptionId, 'subscription.updated');
    expect(subscriptions.calculateGracePeriodEnd).not.toHaveBeenCalled();
    expect(prisma.subscription.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ gracePeriodEnd: existingGrace }),
      }),
    );
  });

  it('clears grace after canonical ACTIVE recovery', async () => {
    const { prisma, service } = subject('ACTIVE', existingGrace);
    await service.process(externalSubscriptionId, 'subscription.recurrence');
    expect(prisma.subscription.updateMany).toHaveBeenCalledWith({
      where: { id: 'subscription-id', status: SubscriptionStatus.ACTIVE },
      data: { gracePeriodEnd: null },
    });
  });

  it('does not create a cycle or arbitrary grace for PENDING_ACTION', async () => {
    const { prisma, service } = subject('PENDING_ACTION');
    await service.process(externalSubscriptionId, 'subscription.updated');
    expect(prisma.subscription.update).not.toHaveBeenCalled();
    expect(prisma.subscription.updateMany).not.toHaveBeenCalled();
  });

  it('does not create a paid cycle for SUSPENDED', async () => {
    const { prisma, service } = subject('SUSPENDED');
    await service.process(externalSubscriptionId, 'subscription.suspended');
    expect(prisma.subscription.update).not.toHaveBeenCalled();
    expect(prisma.subscription.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    ['subscription.initial', 'PENDING_ACTION'],
    ['subscription.updated', 'PENDING_ACTION'],
    ['subscription.activated', 'ACTIVE'],
    ['subscription.recurrence', 'ACTIVE'],
    ['subscription.suspended', 'SUSPENDED'],
    ['subscription.expired', 'EXPIRED', false],
    ['subscription.canceled', 'CANCELED', false],
    ['subscription.migrated', 'PENDING_ACTION'],
  ] as const)(
    '%s is an authenticated reconciliation trigger',
    async (action, status, reconciles = true) => {
      const { gateway, reconciliation, service } = subject(status);
      await expect(
        service.process(externalSubscriptionId, action),
      ).resolves.toMatchObject({
        ignored: false,
      });
      if (reconciles) {
        expect(reconciliation.reconcile).toHaveBeenCalledWith(
          externalSubscriptionId,
        );
      } else {
        expect(reconciliation.reconcile).not.toHaveBeenCalled();
      }
      expect(gateway.getSubscription).toHaveBeenCalledWith(
        externalSubscriptionId,
      );
    },
  );

  it('ignores an unknown event without any mutation or reconciliation', async () => {
    const { prisma, reconciliation, service } = subject('ACTIVE');
    await expect(
      service.process(externalSubscriptionId, 'subscription.paid'),
    ).resolves.toEqual({
      ignored: true,
    });
    expect(reconciliation.reconcile).not.toHaveBeenCalled();
    expect(prisma.subscription.update).not.toHaveBeenCalled();
    expect(prisma.subscription.updateMany).not.toHaveBeenCalled();
  });

  it('does not trust an APPROVED body signal without canonical provider confirmation', async () => {
    const { prisma, gateway, reconciliation, service } =
      subject('PENDING_ACTION');
    reconciliation.reconcile.mockResolvedValue({ outcomes: [] });
    await service.process(externalSubscriptionId, 'subscription.activated');
    expect(gateway.getSubscription).toHaveBeenCalledWith(
      externalSubscriptionId,
    );
    expect(prisma.subscription.update).not.toHaveBeenCalled();
    expect(prisma.subscription.updateMany).not.toHaveBeenCalled();
  });

  it('ignores an unknown SUBS without creating financial state', async () => {
    const { prisma, reconciliation, service } = subject('ACTIVE');
    prisma.subscription.findUnique.mockResolvedValue(null);
    await expect(
      service.process('SUBS_UNKNOWN', 'subscription.updated'),
    ).resolves.toEqual({
      ignored: true,
    });
    expect(reconciliation.reconcile).not.toHaveBeenCalled();
    expect(prisma.subscription.update).not.toHaveBeenCalled();
    expect(prisma.subscription.updateMany).not.toHaveBeenCalled();
  });

  it('replays a persisted event through idempotent reconciliation without new local cycle mutation', async () => {
    const { prisma, reconciliation, service } = subject('PENDING_ACTION');
    reconciliation.reconcile.mockResolvedValue({
      outcomes: ['ALREADY_PROCESSED'],
    });
    await service.process(externalSubscriptionId, 'subscription.updated');
    await service.process(externalSubscriptionId, 'subscription.updated');
    expect(prisma.subscription.update).not.toHaveBeenCalled();
    expect(prisma.subscription.updateMany).not.toHaveBeenCalled();
  });
});
