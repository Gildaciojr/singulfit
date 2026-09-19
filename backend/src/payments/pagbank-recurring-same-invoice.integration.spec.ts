import {
  PaymentProvider,
  PlanType,
  PrismaClient,
  SubscriptionStatus,
} from '@prisma/client';
import { BillingService } from '../billing/billing.service';
import { InvoicesService } from '../billing/invoices.service';
import { EventBusService } from '../event-bus/event-bus.service';
import { AuditService } from '../observability/audit.service';
import { PagBankRecurringGateway } from '../pagbank/pagbank-recurring.gateway';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionAccessService } from '../subscriptions/subscription-access.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { PaymentSettlementService } from './payment-settlement.service';
import { PaymentsService } from './payments.service';
import { PagBankRecurringReconciliationService } from './pagbank-recurring-reconciliation.service';

const databaseUrl = process.env.DATABASE_URL;
const safeDatabaseUrl =
  databaseUrl ?? 'postgresql://disabled:disabled@127.0.0.1:1/disabled';
const integrationDescribe = databaseUrl ? describe : describe.skip;
const prefix = 'pagbank-same-invoice-';

integrationDescribe('PagBank same invoice concurrency', () => {
  const prisma = new PrismaClient({
    datasources: { db: { url: safeDatabaseUrl } },
  });

  const cleanFixtures = async () => {
    await prisma.payment.deleteMany({
      where: { invoice: { subscriptionId: { startsWith: prefix } } },
    });
    await prisma.subscription.updateMany({
      where: { id: { startsWith: prefix } },
      data: { activationInvoiceId: null },
    });
    await prisma.invoice.deleteMany({
      where: { subscriptionId: { startsWith: prefix } },
    });
    await prisma.usageDaily.deleteMany({
      where: { userId: { startsWith: prefix } },
    });
    await prisma.subscription.deleteMany({
      where: { id: { startsWith: prefix } },
    });
    await prisma.user.deleteMany({ where: { id: { startsWith: prefix } } });
    await prisma.plan.deleteMany({ where: { id: { startsWith: prefix } } });
  };

  beforeAll(async () => {
    const parsed = new URL(safeDatabaseUrl);
    expect(parsed.hostname).toBe('127.0.0.1');
    expect(parsed.port).toBe('55433');
    expect(parsed.pathname).toBe('/singulfit_recurring_test');
    await prisma.$connect();
  });

  beforeEach(cleanFixtures);

  afterAll(async () => {
    await cleanFixtures();
    await prisma.$disconnect();
  });

  it('converges concurrent reconciliation of one approved invoice without changing prior usage', async () => {
    const suffix = Date.now().toString();
    const planId = `${prefix}plan-${suffix}`;
    const userId = `${prefix}user-${suffix}`;
    const subscriptionId = `${prefix}subscription-${suffix}`;
    const externalSubscriptionId = `SUBS_SAME_INVOICE_${suffix}`;
    const providerInvoiceId = `INVO_SAME_INVOICE_${suffix}`;
    const providerPaymentId = `PAY_SAME_INVOICE_${suffix}`;
    const oldPeriodStart = new Date('2026-08-20T00:00:00.000Z');
    const oldPeriodEnd = new Date('2026-09-20T00:00:00.000Z');
    const periodStart = new Date('2026-09-20T00:00:00.000Z');
    const periodEnd = new Date('2026-10-20T00:00:00.000Z');
    const approvedAt = new Date('2026-09-20T01:00:00.000Z');
    const usageDate = new Date('2026-09-19T00:00:00.000Z');

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
        billingCycles: 12,
        status: SubscriptionStatus.ACTIVE,
        provider: PaymentProvider.PAGBANK,
        externalSubscriptionId,
        currentPeriodStart: oldPeriodStart,
        currentPeriodEnd: oldPeriodEnd,
      },
    });
    await prisma.usageDaily.create({
      data: { userId, date: usageDate, imagesUsed: 4 },
    });

    const invoice = {
      id: providerInvoiceId,
      subscriptionId: externalSubscriptionId,
      cycleNumber: 2,
      amountInCents: 2990,
      currency: 'BRL',
      periodStart,
      periodEnd,
      dueAt: periodStart,
    };
    const providerPayment = {
      id: providerPaymentId,
      invoiceId: providerInvoiceId,
      subscriptionId: externalSubscriptionId,
      orderId: `ORDER_SAME_INVOICE_${suffix}`,
      status: 'APPROVED' as const,
      amountInCents: 2990,
      currency: 'BRL',
      approvedAt,
    };
    const gateway = {
      getSubscription: jest
        .fn()
        .mockResolvedValue({ id: externalSubscriptionId, status: 'ACTIVE' }),
      listSubscriptionInvoices: jest.fn().mockResolvedValue([invoice]),
      listInvoicePayments: jest.fn().mockResolvedValue([providerPayment]),
    };
    const settlement = new PaymentSettlementService(
      prisma as unknown as PrismaService,
      { assertCanonicalSettlement: jest.fn() } as unknown as BillingService,
      new PaymentsService(prisma as unknown as PrismaService),
      new InvoicesService(prisma as unknown as PrismaService),
      new SubscriptionsService(
        prisma as unknown as PrismaService,
        { get: jest.fn().mockReturnValue('3') } as never,
        {} as SubscriptionAccessService,
        {} as AuditService,
      ),
      {
        recordInTransaction: jest.fn().mockResolvedValue({}),
      } as unknown as AuditService,
      {
        publish: jest.fn().mockResolvedValue({}),
      } as unknown as EventBusService,
    );
    const service = new PagBankRecurringReconciliationService(
      prisma as unknown as PrismaService,
      gateway as unknown as PagBankRecurringGateway,
      settlement,
    );

    const outcomes = await Promise.all([
      service.reconcile(externalSubscriptionId),
      service.reconcile(externalSubscriptionId),
    ]);
    const replay = await service.reconcile(externalSubscriptionId);
    const localInvoice = await prisma.invoice.findUniqueOrThrow({
      where: { providerInvoiceId },
    });
    const subscription = await prisma.subscription.findUniqueOrThrow({
      where: { id: subscriptionId },
    });
    const priorUsage = await prisma.usageDaily.findUniqueOrThrow({
      where: { userId_date: { userId, date: usageDate } },
    });

    expect(outcomes.flatMap((outcome) => outcome.outcomes).sort()).toEqual([
      'ALREADY_PROCESSED',
      'APPROVED',
    ]);
    expect(replay.outcomes).toEqual([]);
    expect(localInvoice).toMatchObject({ subscriptionId, cycleNumber: 2 });
    expect(subscription).toMatchObject({
      status: SubscriptionStatus.ACTIVE,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      version: 2,
    });
    expect(priorUsage).toMatchObject({ imagesUsed: 4, date: usageDate });
    await expect(
      prisma.invoice.count({ where: { providerInvoiceId } }),
    ).resolves.toBe(1);
    await expect(
      prisma.payment.count({
        where: {
          provider: PaymentProvider.PAGBANK,
          providerPaymentId,
        },
      }),
    ).resolves.toBe(1);
    await expect(
      prisma.invoice.count({ where: { subscriptionId } }),
    ).resolves.toBe(1);
  });
});
