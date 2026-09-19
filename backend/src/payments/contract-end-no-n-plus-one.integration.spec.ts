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
import { EventBusService } from '../event-bus/event-bus.service';
import { AuditService } from '../observability/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionAccessService } from '../subscriptions/subscription-access.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { PaymentSettlementService } from './payment-settlement.service';
import { PaymentsService } from './payments.service';

const databaseUrl = process.env.DATABASE_URL;
const safeDatabaseUrl =
  databaseUrl ?? 'postgresql://disabled:disabled@127.0.0.1:1/disabled';
const integrationDescribe = databaseUrl ? describe : describe.skip;
const prefix = 'contract-end-no-n-plus-one-';

integrationDescribe('Contract end prevents N+1 settlement', () => {
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
    await prisma.usageBucket.deleteMany({
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

  it('settles cycle 3 but blocks cycle 4 without reactivating EXPIRED or CANCELED subscriptions', async () => {
    const suffix = Date.now().toString();
    const planId = `${prefix}plan-${suffix}`;
    const userId = `${prefix}user-${suffix}`;
    const subscriptionId = `${prefix}subscription-${suffix}`;
    const canceledSubscriptionId = `${prefix}canceled-subscription-${suffix}`;
    const cycleTwoStart = new Date('2026-08-20T00:00:00.000Z');
    const cycleTwoEnd = new Date('2026-09-20T00:00:00.000Z');
    const cycleThreeStart = new Date('2026-09-20T00:00:00.000Z');
    const cycleThreeEnd = new Date('2026-10-20T00:00:00.000Z');
    const cycleFourStart = new Date('2026-10-20T00:00:00.000Z');
    const cycleFourEnd = new Date('2026-11-20T00:00:00.000Z');
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
      data: { id: userId, phone: `+55${suffix.slice(-12)}` },
    });
    await prisma.subscription.createMany({
      data: [
        {
          id: subscriptionId,
          userId,
          planId,
          amount: '29.90',
          billingCycles: 3,
          status: SubscriptionStatus.ACTIVE,
          provider: PaymentProvider.PAGBANK,
          externalSubscriptionId: `SUBS_CONTRACT_END_${suffix}`,
          currentPeriodStart: cycleTwoStart,
          currentPeriodEnd: cycleTwoEnd,
        },
        {
          id: canceledSubscriptionId,
          userId,
          planId,
          amount: '29.90',
          billingCycles: 3,
          status: SubscriptionStatus.CANCELED,
          provider: PaymentProvider.PAGBANK,
          externalSubscriptionId: `SUBS_CONTRACT_CANCELED_${suffix}`,
          currentPeriodStart: cycleThreeStart,
          currentPeriodEnd: cycleThreeEnd,
        },
      ],
    });
    await prisma.usageBucket.create({
      data: {
        userId,
        entitlementCode: 'NUTRITION_PLAN_GENERATION',
        periodStart: cycleThreeStart,
        periodEnd: cycleThreeEnd,
        used: 1,
      },
    });

    const createInvoiceAndPayment = async (
      id: string,
      targetSubscriptionId: string,
      cycleNumber: number,
      periodStart: Date,
      periodEnd: Date,
    ) => {
      await prisma.invoice.create({
        data: {
          id: `${id}-invoice`,
          subscriptionId: targetSubscriptionId,
          externalReference: `${id}-invoice-reference`,
          providerInvoiceId: `INVO_${id}`,
          cycleNumber,
          subtotal: '29.90',
          total: '29.90',
          periodStart,
          periodEnd,
          dueAt: periodStart,
        },
      });
      await prisma.payment.create({
        data: {
          invoiceId: `${id}-invoice`,
          provider: PaymentProvider.PAGBANK,
          method: PaymentMethod.CREDIT_CARD,
          status: PaymentStatus.PENDING,
          amount: '29.90',
          idempotencyKey: `${id}-idempotency`,
          externalReference: `${id}-payment-reference`,
          providerOrderId: `ORDER_${id}`,
          providerPaymentId: `PAY_${id}`,
        },
      });
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
    const settle = (id: string) =>
      settlement.settlePagBankPayment({
        providerOrderId: `ORDER_${id}`,
        providerPaymentId: `PAY_${id}`,
        externalReference: `${id}-payment-reference`,
        status: 'APPROVED',
        amountInCents: 2990,
        currency: 'BRL',
        approvedAt,
      });

    await createInvoiceAndPayment(
      `${prefix}cycle-three-${suffix}`,
      subscriptionId,
      3,
      cycleThreeStart,
      cycleThreeEnd,
    );
    await expect(settle(`${prefix}cycle-three-${suffix}`)).resolves.toBe(
      'APPROVED',
    );

    await createInvoiceAndPayment(
      `${prefix}cycle-four-${suffix}`,
      subscriptionId,
      4,
      cycleFourStart,
      cycleFourEnd,
    );
    await prisma.subscription.update({
      where: { id: subscriptionId },
      data: { status: SubscriptionStatus.EXPIRED },
    });
    await expect(settle(`${prefix}cycle-four-${suffix}`)).rejects.toThrow(
      'atingiu a quantidade contratada de ciclos',
    );
    await expect(settle(`${prefix}cycle-four-${suffix}`)).rejects.toThrow(
      'atingiu a quantidade contratada de ciclos',
    );

    await createInvoiceAndPayment(
      `${prefix}canceled-cycle-four-${suffix}`,
      canceledSubscriptionId,
      4,
      cycleFourStart,
      cycleFourEnd,
    );
    await expect(
      settle(`${prefix}canceled-cycle-four-${suffix}`),
    ).rejects.toThrow('atingiu a quantidade contratada de ciclos');

    const expiredSubscription = await prisma.subscription.findUniqueOrThrow({
      where: { id: subscriptionId },
    });
    const canceledSubscription = await prisma.subscription.findUniqueOrThrow({
      where: { id: canceledSubscriptionId },
    });
    const nPlusOneInvoice = await prisma.invoice.findFirstOrThrow({
      where: { providerInvoiceId: `INVO_${prefix}cycle-four-${suffix}` },
      include: { payments: true },
    });
    const oldUsage = await prisma.usageBucket.findUniqueOrThrow({
      where: {
        userId_entitlementCode_periodStart_periodEnd: {
          userId,
          entitlementCode: 'NUTRITION_PLAN_GENERATION',
          periodStart: cycleThreeStart,
          periodEnd: cycleThreeEnd,
        },
      },
    });

    expect(expiredSubscription).toMatchObject({
      status: SubscriptionStatus.EXPIRED,
      currentPeriodStart: cycleThreeStart,
      currentPeriodEnd: cycleThreeEnd,
    });
    expect(canceledSubscription).toMatchObject({
      status: SubscriptionStatus.CANCELED,
      currentPeriodStart: cycleThreeStart,
      currentPeriodEnd: cycleThreeEnd,
    });
    expect(nPlusOneInvoice).toMatchObject({ paidAt: null });
    expect(nPlusOneInvoice.payments).toEqual([
      expect.objectContaining({ status: PaymentStatus.PENDING }),
    ]);
    expect(oldUsage).toMatchObject({ used: 1 });
    await expect(
      prisma.usageBucket.count({
        where: { userId, periodStart: cycleFourStart, periodEnd: cycleFourEnd },
      }),
    ).resolves.toBe(0);
  });
});
