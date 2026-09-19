import {
  PaymentMethod,
  PaymentProvider,
  PaymentStatus,
  PlanType,
  PrismaClient,
  SubscriptionStatus,
} from '@prisma/client';
import { BillingService } from '../billing/billing.service';
import { InvoicesService } from '../billing/invoices.service';
import { AuditService } from '../observability/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionAccessService } from '../subscriptions/subscription-access.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { EventBusService } from '../event-bus/event-bus.service';
import { PaymentsService } from './payments.service';
import { PaymentSettlementService } from './payment-settlement.service';

const databaseUrl = process.env.DATABASE_URL;
const safeDatabaseUrl =
  databaseUrl ?? 'postgresql://disabled:disabled@127.0.0.1:1/disabled';
const integrationDescribe = databaseUrl ? describe : describe.skip;
const prefix = 'payment-settlement-same-payment-';

integrationDescribe('PaymentSettlementService same payment concurrency', () => {
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

  beforeEach(async () => {
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
    await prisma.subscription.deleteMany({
      where: { id: { startsWith: prefix } },
    });
    await prisma.user.deleteMany({ where: { id: { startsWith: prefix } } });
    await prisma.plan.deleteMany({ where: { id: { startsWith: prefix } } });
  });

  afterAll(async () => {
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
    await prisma.subscription.deleteMany({
      where: { id: { startsWith: prefix } },
    });
    await prisma.user.deleteMany({ where: { id: { startsWith: prefix } } });
    await prisma.plan.deleteMany({ where: { id: { startsWith: prefix } } });
    await prisma.$disconnect();
  });

  it('settles one concurrent provider payment once and makes replay a no-op', async () => {
    const key = Date.now().toString();
    const planId = `${prefix}plan-${key}`;
    const userId = `${prefix}user-${key}`;
    const subscriptionId = `${prefix}subscription-${key}`;
    const invoiceId = `${prefix}invoice-${key}`;
    const providerInvoiceId = `INVO_SETTLEMENT_${key}`;
    const providerPaymentId = `PAY_SETTLEMENT_${key}`;
    const periodStart = new Date('2026-09-20T00:00:00.000Z');
    const periodEnd = new Date('2026-10-20T00:00:00.000Z');
    const approvedAt = new Date('2026-09-20T01:00:00.000Z');
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
      data: { id: userId, phone: `+55${key.slice(-12)}` },
    });
    await prisma.subscription.create({
      data: {
        id: subscriptionId,
        userId,
        planId,
        amount: '29.90',
        status: SubscriptionStatus.PENDING_PAYMENT,
        provider: PaymentProvider.PAGBANK,
        externalSubscriptionId: `SUBS_SETTLEMENT_${key}`,
      },
    });
    await prisma.invoice.create({
      data: {
        id: invoiceId,
        subscriptionId,
        externalReference: `invoice-${key}`,
        providerInvoiceId,
        cycleNumber: 1,
        subtotal: '29.90',
        total: '29.90',
        periodStart,
        periodEnd,
        dueAt: periodStart,
      },
    });
    await prisma.payment.create({
      data: {
        invoiceId,
        provider: PaymentProvider.PAGBANK,
        method: PaymentMethod.CREDIT_CARD,
        status: PaymentStatus.PENDING,
        amount: '29.90',
        idempotencyKey: `idempotency-${key}`,
        externalReference: `payment-${key}`,
        providerOrderId: `ORDER_${key}`,
        providerPaymentId,
      },
    });

    const service = new PaymentSettlementService(
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
    const canonical = {
      providerOrderId: `ORDER_${key}`,
      providerPaymentId,
      externalReference: `payment-${key}`,
      status: 'APPROVED' as const,
      amountInCents: 2990,
      currency: 'BRL',
      approvedAt,
    };
    const results = await Promise.all([
      service.settlePagBankPayment(canonical),
      service.settlePagBankPayment(canonical),
    ]);
    const replay = await service.settlePagBankPayment(canonical);
    const payment = await prisma.payment.findFirstOrThrow({
      where: { providerPaymentId },
    });
    const subscription = await prisma.subscription.findUniqueOrThrow({
      where: { id: subscriptionId },
    });
    expect(results.sort()).toEqual(['ALREADY_PROCESSED', 'APPROVED']);
    expect(replay).toBe('ALREADY_PROCESSED');
    expect(payment.status).toBe(PaymentStatus.APPROVED);
    expect(subscription).toMatchObject({
      status: SubscriptionStatus.ACTIVE,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      version: 2,
    });
    await expect(
      prisma.payment.count({ where: { providerPaymentId } }),
    ).resolves.toBe(1);
  });
});
