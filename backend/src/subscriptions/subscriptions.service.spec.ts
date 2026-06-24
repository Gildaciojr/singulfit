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
      );

      await expect(service.getProfileSubscription('user-id')).resolves.toBe(
        subscription,
      );
    },
  );

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
    );

    await expect(
      service.getProfileSubscription('user-id'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
