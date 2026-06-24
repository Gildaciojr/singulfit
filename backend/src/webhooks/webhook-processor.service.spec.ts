import { Currency, PaymentMethod, PaymentStatus, Prisma } from '@prisma/client';
import { BillingService } from '../billing/billing.service';
import { InvoicesService } from '../billing/invoices.service';
import { PaymentsService } from '../payments/payments.service';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { WebhookProcessorService } from './webhook-processor.service';
import { AuditService } from '../observability/audit.service';
import { EventBusService } from '../event-bus/event-bus.service';

describe('WebhookProcessorService', () => {
  it('audits payment and subscription changes in the settlement transaction', async () => {
    const transaction = {};
    const prisma = {
      $transaction: jest.fn(
        (
          operation: (
            currentTransaction: Prisma.TransactionClient,
          ) => Promise<unknown>,
        ) => operation(transaction as Prisma.TransactionClient),
      ),
    };
    const payment = {
      id: 'payment-id',
      invoiceId: 'invoice-id',
      amount: new Prisma.Decimal('19.90'),
      currency: Currency.BRL,
      externalReference: 'pay_reference',
      method: PaymentMethod.PIX,
      status: PaymentStatus.PENDING,
      invoice: {
        subscriptionId: 'subscription-id',
        subscription: {
          userId: 'user-id',
        },
      },
    };
    const paymentsService = {
      findPagBankPayment: jest.fn().mockResolvedValue(payment),
      approveInTransaction: jest.fn().mockResolvedValue({
        payment: {
          ...payment,
          status: PaymentStatus.APPROVED,
        },
        changed: true,
      }),
    };
    const billingService = {
      assertCanonicalSettlement: jest.fn(),
    };
    const invoicesService = {
      markPaidInTransaction: jest.fn().mockResolvedValue({
        changed: true,
      }),
    };
    const subscriptionsService = {
      activateForInvoiceInTransaction: jest.fn().mockResolvedValue({
        subscription: {
          id: 'subscription-id',
          userId: 'user-id',
          planId: 'plan-id',
        },
        changed: true,
      }),
    };
    const auditService = {
      recordInTransaction: jest.fn(),
    };
    const eventBus = {
      publish: jest.fn(),
    };
    const service = new WebhookProcessorService(
      prisma as unknown as PrismaService,
      billingService as unknown as BillingService,
      paymentsService as unknown as PaymentsService,
      invoicesService as unknown as InvoicesService,
      subscriptionsService as unknown as SubscriptionsService,
      auditService as unknown as AuditService,
      eventBus as unknown as EventBusService,
    );

    await expect(
      service.processPagBankPayment({
        providerOrderId: 'ORDE_TEST',
        providerPaymentId: 'CHAR_TEST',
        externalReference: 'pay_reference',
        status: 'APPROVED',
        amountInCents: 1990,
        currency: Currency.BRL,
        approvedAt: new Date('2026-06-06T18:30:00.000Z'),
      }),
    ).resolves.toBe('APPROVED');
    expect(auditService.recordInTransaction).toHaveBeenNthCalledWith(
      1,
      transaction,
      expect.objectContaining({
        action: 'PAYMENT_APPROVED',
        entityId: 'payment-id',
      }),
    );
    expect(eventBus.publish).toHaveBeenCalledTimes(2);
    expect(
      subscriptionsService.activateForInvoiceInTransaction,
    ).toHaveBeenCalledWith(
      transaction,
      expect.objectContaining({
        paymentMethod: PaymentMethod.PIX,
      }),
    );
    expect(auditService.recordInTransaction).toHaveBeenNthCalledWith(
      2,
      transaction,
      expect.objectContaining({
        action: 'SUBSCRIPTION_ACTIVATED',
        entityId: 'subscription-id',
      }),
    );
  });

  it('returns already processed without extending the subscription', async () => {
    const transaction = {};
    const prisma = {
      $transaction: jest.fn(
        (
          operation: (
            currentTransaction: Prisma.TransactionClient,
          ) => Promise<unknown>,
        ) => operation(transaction as Prisma.TransactionClient),
      ),
    };
    const paymentsService = {
      findPagBankPayment: jest.fn().mockResolvedValue({
        id: 'payment-id',
        invoiceId: 'invoice-id',
        amount: new Prisma.Decimal('19.90'),
        currency: Currency.BRL,
        externalReference: 'pay_reference',
        method: PaymentMethod.PIX,
        status: PaymentStatus.APPROVED,
        invoice: {
          subscriptionId: 'subscription-id',
        },
      }),
      approveInTransaction: jest.fn().mockResolvedValue({
        changed: false,
      }),
    };
    const billingService = {
      assertCanonicalSettlement: jest.fn(),
    };
    const invoicesService = {
      markPaidInTransaction: jest.fn().mockResolvedValue({
        changed: false,
      }),
    };
    const subscriptionsService = {
      activateForInvoiceInTransaction: jest.fn().mockResolvedValue({
        changed: false,
      }),
    };
    const auditService = {
      recordInTransaction: jest.fn(),
    };
    const eventBus = {
      publish: jest.fn(),
    };
    const service = new WebhookProcessorService(
      prisma as unknown as PrismaService,
      billingService as unknown as BillingService,
      paymentsService as unknown as PaymentsService,
      invoicesService as unknown as InvoicesService,
      subscriptionsService as unknown as SubscriptionsService,
      auditService as unknown as AuditService,
      eventBus as unknown as EventBusService,
    );

    const result = await service.processPagBankPayment({
      providerOrderId: 'ORDE_TEST',
      providerPaymentId: 'CHAR_TEST',
      externalReference: 'pay_reference',
      status: 'APPROVED',
      amountInCents: 1990,
      currency: Currency.BRL,
      approvedAt: new Date('2026-06-06T18:30:00.000Z'),
    });

    expect(result).toBe('ALREADY_PROCESSED');
    expect(
      subscriptionsService.activateForInvoiceInTransaction,
    ).toHaveBeenCalledTimes(1);
    expect(auditService.recordInTransaction).not.toHaveBeenCalled();
  });

  it('returns payment not found without opening a transaction', async () => {
    const prisma = {
      $transaction: jest.fn(),
    };
    const paymentsService = {
      findPagBankPayment: jest.fn().mockResolvedValue(null),
    };
    const billingService = {
      assertCanonicalSettlement: jest.fn(),
    };
    const service = new WebhookProcessorService(
      prisma as unknown as PrismaService,
      billingService as unknown as BillingService,
      paymentsService as unknown as PaymentsService,
      {} as InvoicesService,
      {} as SubscriptionsService,
      {} as AuditService,
      {} as EventBusService,
    );

    const result = await service.processPagBankPayment({
      providerOrderId: 'ORDE_UNKNOWN',
      providerPaymentId: 'CHAR_UNKNOWN',
      externalReference: 'pay_unknown',
      status: 'APPROVED',
      amountInCents: 1990,
      currency: Currency.BRL,
      approvedAt: new Date('2026-06-06T18:30:00.000Z'),
    });

    expect(result).toBe('PAYMENT_NOT_FOUND');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('ignores a canonical status that is not approved', async () => {
    const paymentsService = {
      findPagBankPayment: jest.fn(),
    };
    const billingService = {
      assertCanonicalSettlement: jest.fn(),
    };
    const service = new WebhookProcessorService(
      {} as PrismaService,
      billingService as unknown as BillingService,
      paymentsService as unknown as PaymentsService,
      {} as InvoicesService,
      {} as SubscriptionsService,
      {} as AuditService,
      {} as EventBusService,
    );

    const result = await service.processPagBankPayment({
      providerOrderId: 'ORDE_PENDING',
      providerPaymentId: 'CHAR_PENDING',
      externalReference: 'pay_pending',
      status: 'PENDING',
      amountInCents: 1990,
      currency: Currency.BRL,
    });

    expect(result).toBe('IGNORED_STATUS');
    expect(paymentsService.findPagBankPayment).not.toHaveBeenCalled();
  });
});
