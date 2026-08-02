import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  PaymentMethod,
  PaymentProvider,
  Prisma,
  SubscriptionStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionAccessService } from './subscription-access.service';
import { AuditService } from '../observability/audit.service';

describe('SubscriptionsService', () => {
  it('does not extend a subscription activated by the same invoice', async () => {
    const currentPeriodEnd = new Date('2026-07-06T18:30:00.000Z');
    const subscription = {
      id: 'subscription-id',
      status: SubscriptionStatus.ACTIVE,
      activationInvoiceId: 'invoice-id',
      currentPeriodEnd,
      plan: {
        billingIntervalCount: 1,
      },
    };
    const transaction = {
      invoice: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'invoice-id',
          subscriptionId: subscription.id,
          cycleNumber: 1,
          periodStart: new Date('2026-06-06T18:30:00.000Z'),
          periodEnd: currentPeriodEnd,
        }),
      },
      subscription: {
        findUnique: jest.fn().mockResolvedValue(subscription),
        update: jest.fn(),
      },
    };
    const service = new SubscriptionsService(
      {} as PrismaService,
      {
        get: jest.fn().mockReturnValue('3'),
      } as unknown as ConfigService,
      {} as SubscriptionAccessService,
      {} as AuditService,
    );

    const result = await service.activateForInvoiceInTransaction(
      transaction as unknown as Prisma.TransactionClient,
      {
        subscriptionId: subscription.id,
        invoiceId: 'invoice-id',
        approvedAt: new Date('2026-06-06T18:30:00.000Z'),
        provider: PaymentProvider.PAGBANK,
        providerPaymentId: 'CHAR_TEST',
        paymentMethod: PaymentMethod.PIX,
      },
    );

    expect(result.changed).toBe(false);
    expect(result.subscription.currentPeriodEnd).toBe(currentPeriodEnd);
    expect(transaction.subscription.update).not.toHaveBeenCalled();
  });

  it.each([
    ['PIX', PaymentMethod.PIX],
    ['credit card', PaymentMethod.CREDIT_CARD],
  ])(
    'activates a subscription with the supplied %s payment method',
    async (_label, paymentMethod) => {
      const approvedAt = new Date('2026-06-06T18:30:00.000Z');
      const subscription = {
        id: 'subscription-id',
        status: SubscriptionStatus.PENDING_PAYMENT,
        activationInvoiceId: null,
        plan: {
          billingIntervalCount: 1,
        },
      };
      const transaction = {
        invoice: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'invoice-id',
            subscriptionId: subscription.id,
            cycleNumber: 1,
            periodStart: approvedAt,
            periodEnd: new Date('2026-07-06T18:30:00.000Z'),
          }),
        },
        subscription: {
          findUnique: jest.fn().mockResolvedValue(subscription),
          update: jest.fn().mockResolvedValue({
            ...subscription,
            status: SubscriptionStatus.ACTIVE,
            paymentMethod,
          }),
        },
      };
      const service = new SubscriptionsService(
        {} as PrismaService,
        {
          get: jest.fn().mockReturnValue('3'),
        } as unknown as ConfigService,
        {} as SubscriptionAccessService,
        {} as AuditService,
      );

      const result = await service.activateForInvoiceInTransaction(
        transaction as unknown as Prisma.TransactionClient,
        {
          subscriptionId: subscription.id,
          invoiceId: 'invoice-id',
          approvedAt,
          provider: PaymentProvider.PAGBANK,
          providerPaymentId: 'CHAR_TEST',
          paymentMethod,
        },
      );

      expect(result.changed).toBe(true);
      expect(transaction.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            paymentMethod,
          }),
        }),
      );
    },
  );

  it.each([SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE])(
    'allows profile access for %s subscriptions',
    async (status) => {
      const subscription = {
        id: 'subscription-id',
        status,
      };
      const accessService = {
        requireAccess: jest.fn().mockResolvedValue(subscription),
      };
      const service = new SubscriptionsService(
        {} as PrismaService,
        {} as ConfigService,
        accessService as unknown as SubscriptionAccessService,
        {} as AuditService,
      );

      await expect(service.getProfileSubscription('user-id')).resolves.toBe(
        subscription,
      );
    },
  );

  it('reactivates the same subscription for a later paid cycle', async () => {
    const approvedAt = new Date('2026-08-14T12:00:00.000Z');
    const subscription = {
      id: 'subscription-id',
      userId: 'user-id',
      planId: 'plan-id',
      status: SubscriptionStatus.EXPIRED,
      activationInvoiceId: 'invoice-1',
      currentPeriodEnd: new Date('2026-07-10T12:00:00.000Z'),
      startedAt: new Date('2026-01-10T12:00:00.000Z'),
      plan: { billingIntervalCount: 1 },
    };
    const transaction = {
      invoice: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'invoice-4',
          subscriptionId: subscription.id,
          cycleNumber: 4,
          periodStart: new Date('2026-07-10T12:00:00.000Z'),
          periodEnd: new Date('2026-08-10T12:00:00.000Z'),
        }),
      },
      subscription: {
        findUnique: jest.fn().mockResolvedValue(subscription),
        update: jest.fn().mockResolvedValue({
          ...subscription,
          status: SubscriptionStatus.ACTIVE,
        }),
      },
    };
    const service = new SubscriptionsService(
      {} as PrismaService,
      { get: jest.fn().mockReturnValue('3') } as unknown as ConfigService,
      {} as SubscriptionAccessService,
      {} as AuditService,
    );

    const result = await service.activateForInvoiceInTransaction(
      transaction as unknown as Prisma.TransactionClient,
      {
        subscriptionId: subscription.id,
        invoiceId: 'invoice-4',
        approvedAt,
        provider: PaymentProvider.PAGBANK,
        providerPaymentId: 'CHAR_RENEWAL',
        paymentMethod: PaymentMethod.PIX,
      },
    );

    expect(result).toMatchObject({
      changed: true,
      reactivated: true,
      cycleNumber: 4,
    });
    expect(transaction.subscription.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: subscription.id },
        data: expect.objectContaining({
          activationInvoiceId: 'invoice-1',
          startedAt: subscription.startedAt,
          cancelAtPeriodEnd: false,
          endedAt: null,
        }),
      }),
    );
  });

  it('cancels immediately in one audited transaction', async () => {
    const subscription = {
      id: 'subscription-id',
      userId: 'user-id',
      status: SubscriptionStatus.ACTIVE,
      cancelAtPeriodEnd: false,
    };
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([{ locked: true }]),
      subscription: {
        findUnique: jest.fn().mockResolvedValue(subscription),
        update: jest.fn().mockResolvedValue({
          ...subscription,
          status: SubscriptionStatus.CANCELED,
        }),
      },
    };
    const prisma = {
      $transaction: jest.fn(
        (operation: (client: typeof transaction) => Promise<unknown>) =>
          operation(transaction),
      ),
    };
    const audit = { recordInTransaction: jest.fn().mockResolvedValue({}) };
    const service = new SubscriptionsService(
      prisma as unknown as PrismaService,
      {} as ConfigService,
      {} as SubscriptionAccessService,
      audit as unknown as AuditService,
    );

    await expect(
      service.cancelSubscription(
        subscription.id,
        'IMMEDIATE',
        new Date('2026-08-14T12:00:00.000Z'),
      ),
    ).resolves.toMatchObject({ status: SubscriptionStatus.CANCELED });
    expect(audit.recordInTransaction).toHaveBeenCalledWith(
      transaction,
      expect.objectContaining({
        action: 'SUBSCRIPTION_CANCELED',
        entityId: subscription.id,
      }),
    );
  });

  it('blocks profile access without an eligible subscription', async () => {
    const accessService = {
      requireAccess: jest
        .fn()
        .mockRejectedValue(new ForbiddenException('Sem acesso')),
    };
    const service = new SubscriptionsService(
      {} as PrismaService,
      {} as ConfigService,
      accessService as unknown as SubscriptionAccessService,
      {} as AuditService,
    );

    await expect(
      service.getProfileSubscription('user-id'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
