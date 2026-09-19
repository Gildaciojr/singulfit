import {
  PaymentProvider,
  PlanType,
  PrismaClient,
  SubscriptionStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PagBankRecurringGateway } from '../pagbank/pagbank-recurring.gateway';
import { PaymentSettlementService } from './payment-settlement.service';
import { PagBankRecurringReconciliationService } from './pagbank-recurring-reconciliation.service';

const databaseUrl = process.env.DATABASE_URL;
const safeDatabaseUrl =
  databaseUrl ?? 'postgresql://disabled:disabled@127.0.0.1:1/disabled';
const integrationDescribe = databaseUrl ? describe : describe.skip;
const prefix = 'pagbank-reconciliation-integration-';

integrationDescribe(
  'PagBank recurring reconciliation PostgreSQL integration',
  () => {
    const prisma = new PrismaClient({
      datasources: { db: { url: safeDatabaseUrl } },
    });

    beforeAll(async () => {
      const parsed = new URL(safeDatabaseUrl);
      expect(parsed.hostname).toBe('127.0.0.1');
      expect(parsed.port).toBe('55433');
      expect(parsed.pathname).toBe('/singulfit_recurring_test');
      await prisma.$connect();
    });

    afterAll(async () => {
      await prisma.payment.deleteMany({
        where: { invoice: { subscriptionId: { startsWith: prefix } } },
      });
      await prisma.invoice.deleteMany({
        where: { subscriptionId: { startsWith: prefix } },
      });
      await prisma.subscription.deleteMany({
        where: { id: { startsWith: prefix } },
      });
      await prisma.user.deleteMany({ where: { id: { startsWith: prefix } } });
      await prisma.plan.deleteMany({ where: { id: { startsWith: prefix } } });
      await prisma.$disconnect();
    });

    it('converges concurrent reconciliation of one provider payment to one canonical payment', async () => {
      const suffix = Date.now().toString();
      const planId = `${prefix}plan-${suffix}`;
      const userId = `${prefix}user-${suffix}`;
      const subscriptionId = `${prefix}subscription-${suffix}`;
      const externalSubscriptionId = `SUBS_RECONCILIATION_${suffix}`;
      await prisma.plan.create({
        data: {
          id: planId,
          type: PlanType.BASIC,
          name: planId,
          price: '29.90',
          imageLimit: 1,
        },
      });
      await prisma.user.create({
        data: { id: userId, phone: `+55${suffix.slice(-12)}` },
      });
      await prisma.subscription.create({
        data: {
          id: subscriptionId,
          userId,
          planId,
          amount: '29.90',
          status: SubscriptionStatus.PENDING_PAYMENT,
          provider: PaymentProvider.PAGBANK,
          externalSubscriptionId,
        },
      });
      const invoice = {
        id: `INVO_RECONCILIATION_${suffix}`,
        subscriptionId: externalSubscriptionId,
        cycleNumber: 1,
        amountInCents: 2990,
        currency: 'BRL',
        periodStart: new Date('2026-09-01T00:00:00.000Z'),
        periodEnd: new Date('2026-10-01T00:00:00.000Z'),
        dueAt: new Date('2026-09-01T00:00:00.000Z'),
      };
      const payment = {
        id: `PAY_RECONCILIATION_${suffix}`,
        invoiceId: invoice.id,
        subscriptionId: externalSubscriptionId,
        orderId: `ORDER_RECONCILIATION_${suffix}`,
        status: 'PENDING' as const,
        amountInCents: 2990,
        currency: 'BRL',
      };
      const gateway = {
        getSubscription: jest
          .fn()
          .mockResolvedValue({ id: externalSubscriptionId, status: 'ACTIVE' }),
        listSubscriptionInvoices: jest.fn().mockResolvedValue([invoice]),
        listInvoicePayments: jest.fn().mockResolvedValue([payment]),
      };
      const settlement = { settlePagBankPayment: jest.fn() };
      const service = new PagBankRecurringReconciliationService(
        prisma as unknown as PrismaService,
        gateway as unknown as PagBankRecurringGateway,
        settlement as unknown as PaymentSettlementService,
      );

      await Promise.all([
        service.reconcile(externalSubscriptionId),
        service.reconcile(externalSubscriptionId),
      ]);

      await expect(
        prisma.payment.count({
          where: {
            provider: PaymentProvider.PAGBANK,
            providerPaymentId: payment.id,
          },
        }),
      ).resolves.toBe(1);
      await expect(
        prisma.invoice.count({ where: { providerInvoiceId: invoice.id } }),
      ).resolves.toBe(1);
    });
  },
);
