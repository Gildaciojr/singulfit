import { ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  PaymentMethod,
  PaymentProvider,
  Prisma,
  SubscriptionStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../observability/audit.service';
import { SubscriptionAccessService } from './subscription-access.service';
import { SubscriptionsService } from './subscriptions.service';

describe('SubscriptionsService billing cycle boundary', () => {
  function subject(billingCycles: number | null, cycleNumber: number) {
    const periodStart = new Date('2026-09-01T00:00:00.000Z');
    const periodEnd = new Date('2026-10-01T00:00:00.000Z');
    const subscription = {
      id: 'subscription-id',
      status: SubscriptionStatus.PENDING_PAYMENT,
      billingCycles,
      activationInvoiceId: null,
      startedAt: null,
      currentPeriodStart: null,
      currentPeriodEnd: null,
      plan: { billingIntervalCount: 1 },
    };
    const transaction = {
      invoice: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'invoice-id',
          subscriptionId: subscription.id,
          cycleNumber,
          periodStart,
          periodEnd,
        }),
      },
      subscription: {
        findUnique: jest.fn().mockResolvedValue(subscription),
        update: jest.fn().mockResolvedValue({ ...subscription }),
      },
    };
    const service = new SubscriptionsService(
      {} as PrismaService,
      { get: jest.fn().mockReturnValue('3') } as unknown as ConfigService,
      {} as SubscriptionAccessService,
      {} as AuditService,
    );
    const activate = () =>
      service.activateForInvoiceInTransaction(
        transaction as unknown as Prisma.TransactionClient,
        {
          subscriptionId: subscription.id,
          invoiceId: 'invoice-id',
          approvedAt: periodStart,
          provider: PaymentProvider.PAGBANK,
          providerPaymentId: 'PAY_BOUNDARY',
          paymentMethod: PaymentMethod.CREDIT_CARD,
        },
      );
    return { activate, transaction, periodStart, periodEnd };
  }

  it('accepts the exact 1-cycle boundary and advances the canonical period', async () => {
    const test = subject(1, 1);
    await expect(test.activate()).resolves.toMatchObject({ changed: true });
    expect(test.transaction.subscription.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          currentPeriodStart: test.periodStart,
          currentPeriodEnd: test.periodEnd,
        }),
      }),
    );
  });

  it('rejects cycle 2 for a 1-cycle contract', async () => {
    await expect(subject(1, 2).activate()).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('accepts the exact 3-cycle boundary', async () => {
    await expect(subject(3, 3).activate()).resolves.toMatchObject({
      changed: true,
    });
  });

  it('rejects cycle 4 for a 3-cycle contract', async () => {
    await expect(subject(3, 4).activate()).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('rejects cycle 7 for a 6-cycle contract', async () => {
    await expect(subject(6, 7).activate()).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('rejects cycle 13 for a 12-cycle contract', async () => {
    await expect(subject(12, 13).activate()).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('preserves legacy null billing cycles', async () => {
    await expect(subject(null, 99).activate()).resolves.toMatchObject({
      changed: true,
    });
  });

  it('does not advance currentPeriodStart outside the contract', async () => {
    const test = subject(1, 2);
    await expect(test.activate()).rejects.toBeInstanceOf(ConflictException);
    expect(test.transaction.subscription.update).not.toHaveBeenCalled();
  });

  it('does not advance currentPeriodEnd outside the contract', async () => {
    const test = subject(1, 2);
    await expect(test.activate()).rejects.toBeInstanceOf(ConflictException);
    expect(test.transaction.subscription.update).not.toHaveBeenCalled();
  });

  it('does not activate or produce an entitlement effect outside the contract', async () => {
    const test = subject(1, 2);
    await expect(test.activate()).rejects.toBeInstanceOf(ConflictException);
    expect(test.transaction.subscription.update).not.toHaveBeenCalled();
  });
});
