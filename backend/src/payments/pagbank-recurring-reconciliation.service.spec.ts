import { PaymentProvider, PaymentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PagBankRecurringGateway } from '../pagbank/pagbank-recurring.gateway';
import { PaymentSettlementService } from './payment-settlement.service';
import { PagBankRecurringReconciliationService } from './pagbank-recurring-reconciliation.service';

describe('PagBankRecurringReconciliationService', () => {
  const providerSubscriptionId = 'SUBS_CANONICAL';
  const providerInvoiceId = 'INVO_CANONICAL';
  const providerPaymentId = 'PAY_CANONICAL';
  const localSubscription = { id: 'local-subscription' };
  const localInvoice = {
    id: 'local-invoice',
    subscriptionId: 'local-subscription',
  };
  const localPayment = {
    id: 'local-payment',
    invoiceId: 'local-invoice',
    status: PaymentStatus.PENDING,
  };
  const invoice = {
    id: providerInvoiceId,
    subscriptionId: providerSubscriptionId,
    cycleNumber: 1,
    amountInCents: 2990,
    currency: 'BRL',
    periodStart: new Date('2026-09-01T00:00:00.000Z'),
    periodEnd: new Date('2026-10-01T00:00:00.000Z'),
    dueAt: new Date('2026-09-01T00:00:00.000Z'),
  };
  type ProviderPaymentStatus =
    | 'APPROVED'
    | 'DENIED'
    | 'IN_ANALYSIS'
    | 'PENDING'
    | 'UNPAID'
    | 'REFUNDED';
  const payment = (status: ProviderPaymentStatus = 'APPROVED') => ({
    id: providerPaymentId,
    invoiceId: providerInvoiceId,
    subscriptionId: providerSubscriptionId,
    orderId: 'ORDER_CANONICAL',
    status,
    amountInCents: 2990,
    currency: 'BRL',
    approvedAt: new Date('2026-09-01T01:00:00.000Z'),
  });

  function subject(status: ProviderPaymentStatus = 'APPROVED') {
    const prisma = {
      subscription: {
        findUnique: jest.fn().mockResolvedValue(localSubscription),
      },
      invoice: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(localInvoice),
      },
      payment: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(localPayment),
      },
    };
    const gateway = {
      getSubscription: jest
        .fn()
        .mockResolvedValue({ id: providerSubscriptionId, status: 'ACTIVE' }),
      listSubscriptionInvoices: jest.fn().mockResolvedValue([invoice]),
      listInvoicePayments: jest.fn().mockResolvedValue([payment(status)]),
    };
    const settlement = {
      settlePagBankPayment: jest.fn().mockResolvedValue('APPROVED'),
    };
    return {
      prisma,
      gateway,
      settlement,
      service: new PagBankRecurringReconciliationService(
        prisma as unknown as PrismaService,
        gateway as unknown as PagBankRecurringGateway,
        settlement as unknown as PaymentSettlementService,
      ),
    };
  }

  it('reads the authenticated subscription, invoices, and invoice payments', async () => {
    const { gateway, service } = subject();
    await service.reconcile(providerSubscriptionId);
    expect(gateway.getSubscription).toHaveBeenCalledWith(
      providerSubscriptionId,
    );
    expect(gateway.listSubscriptionInvoices).toHaveBeenCalledWith(
      providerSubscriptionId,
    );
    expect(gateway.listInvoicePayments).toHaveBeenCalledWith(providerInvoiceId);
  });

  it('materializes approved invoice/payment ids and delegates canonical settlement', async () => {
    const { prisma, settlement, service } = subject();
    await service.reconcile(providerSubscriptionId);
    expect(prisma.invoice.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ providerInvoiceId }),
      }),
    );
    expect(prisma.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          provider: PaymentProvider.PAGBANK,
          providerPaymentId,
        }),
      }),
    );
    expect(settlement.settlePagBankPayment).toHaveBeenCalledWith(
      expect.objectContaining({ providerPaymentId, status: 'APPROVED' }),
    );
  });

  it('does not duplicate payment or settlement after a repeated approved reconciliation', async () => {
    const { prisma, settlement, service } = subject();
    prisma.invoice.findUnique.mockResolvedValue(localInvoice);
    prisma.payment.findUnique.mockResolvedValue({
      ...localPayment,
      status: PaymentStatus.APPROVED,
    });
    await service.reconcile(providerSubscriptionId);
    await service.reconcile(providerSubscriptionId);
    expect(prisma.payment.create).not.toHaveBeenCalled();
    expect(settlement.settlePagBankPayment).not.toHaveBeenCalled();
  });

  it.each(['DENIED', 'PENDING', 'IN_ANALYSIS', 'UNPAID', 'REFUNDED'] as const)(
    '%s never delegates settlement',
    async (status) => {
      const { settlement, service } = subject(status);
      await service.reconcile(providerSubscriptionId);
      expect(settlement.settlePagBankPayment).not.toHaveBeenCalled();
    },
  );

  it.each([
    'getSubscription',
    'listSubscriptionInvoices',
    'listInvoicePayments',
  ] as const)(
    '%s failure does not mutate financial records',
    async (method) => {
      const { gateway, prisma, settlement, service } = subject();
      gateway[method].mockRejectedValue(new Error('provider unavailable'));
      await expect(service.reconcile(providerSubscriptionId)).rejects.toThrow(
        'provider unavailable',
      );
      expect(prisma.invoice.create).not.toHaveBeenCalled();
      expect(prisma.payment.create).not.toHaveBeenCalled();
      expect(settlement.settlePagBankPayment).not.toHaveBeenCalled();
    },
  );

  it('rejects an unknown local subscription before provider access', async () => {
    const { gateway, prisma, settlement, service } = subject();
    prisma.subscription.findUnique.mockResolvedValue(null);
    await expect(service.reconcile(providerSubscriptionId)).rejects.toThrow(
      'local',
    );
    expect(gateway.getSubscription).not.toHaveBeenCalled();
    expect(settlement.settlePagBankPayment).not.toHaveBeenCalled();
  });

  it('rejects a payment that belongs to another invoice or subscription', async () => {
    const { gateway, settlement, service } = subject();
    gateway.listInvoicePayments.mockResolvedValue([
      { ...payment(), invoiceId: 'INVO_OTHER' },
    ]);
    await expect(service.reconcile(providerSubscriptionId)).rejects.toThrow(
      'incompatível',
    );
    expect(settlement.settlePagBankPayment).not.toHaveBeenCalled();
  });

  it('rejects a provider subscription response for another subscription', async () => {
    const { gateway, service } = subject();
    gateway.getSubscription.mockResolvedValue({
      id: 'SUBS_OTHER',
      status: 'ACTIVE',
    });
    await expect(service.reconcile(providerSubscriptionId)).rejects.toThrow(
      'incompatível',
    );
  });

  it('does not accept an approved payment without canonical approval time', async () => {
    const { gateway, settlement, service } = subject();
    gateway.listInvoicePayments.mockResolvedValue([
      { ...payment(), approvedAt: undefined },
    ]);
    await expect(service.reconcile(providerSubscriptionId)).rejects.toThrow(
      'canônica',
    );
    expect(settlement.settlePagBankPayment).not.toHaveBeenCalled();
  });

  it('does not change the local subscription before approved settlement', async () => {
    const { prisma, service } = subject('PENDING');
    await service.reconcile(providerSubscriptionId);
    expect(prisma.subscription.update).toBeUndefined();
  });

  it('rejects an invoice returned for another subscription', async () => {
    const { gateway, settlement, service } = subject();
    gateway.listSubscriptionInvoices.mockResolvedValue([
      { ...invoice, subscriptionId: 'SUBS_OTHER' },
    ]);
    await expect(service.reconcile(providerSubscriptionId)).rejects.toThrow(
      'Fatura',
    );
    expect(settlement.settlePagBankPayment).not.toHaveBeenCalled();
  });

  it('rejects an existing provider invoice owned by another local subscription', async () => {
    const { prisma, service } = subject();
    prisma.invoice.findUnique.mockResolvedValue({
      ...localInvoice,
      subscriptionId: 'other-local-subscription',
    });
    await expect(service.reconcile(providerSubscriptionId)).rejects.toThrow(
      'outra assinatura',
    );
  });

  it('rejects an existing provider payment owned by another local invoice', async () => {
    const { prisma, service } = subject();
    prisma.invoice.findUnique.mockResolvedValue(localInvoice);
    prisma.payment.findUnique.mockResolvedValue({
      ...localPayment,
      invoiceId: 'other-local-invoice',
    });
    await expect(service.reconcile(providerSubscriptionId)).rejects.toThrow(
      'outra fatura',
    );
  });

  it('persists a denied payment as rejected without invoking settlement', async () => {
    const { prisma, settlement, service } = subject('DENIED');
    await service.reconcile(providerSubscriptionId);
    expect(prisma.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: PaymentStatus.REJECTED }),
      }),
    );
    expect(settlement.settlePagBankPayment).not.toHaveBeenCalled();
  });
});
