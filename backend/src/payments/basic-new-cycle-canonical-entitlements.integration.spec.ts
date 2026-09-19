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
import {
  IMAGE_ANALYSIS,
  NUTRITION_PLAN_GENERATION,
  WORKOUT_PLAN_GENERATION,
} from '../entitlements/entitlement.constants';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { PaymentSettlementService } from './payment-settlement.service';
import { PaymentsService } from './payments.service';

const databaseUrl = process.env.DATABASE_URL;
const safeDatabaseUrl =
  databaseUrl ?? 'postgresql://disabled:disabled@127.0.0.1:1/disabled';
const integrationDescribe = databaseUrl ? describe : describe.skip;
const prefix = 'basic-new-cycle-entitlements-';
const commercialCodes = [
  NUTRITION_PLAN_GENERATION,
  WORKOUT_PLAN_GENERATION,
  IMAGE_ANALYSIS,
] as const;

integrationDescribe('BASIC new cycle canonical entitlements', () => {
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

  it('opens a BASIC N+1 cycle from canonical plan entitlements without resetting N', async () => {
    const suffix = Date.now().toString();
    const planId = `${prefix}plan-${suffix}`;
    const userId = `${prefix}user-${suffix}`;
    const subscriptionId = `${prefix}subscription-${suffix}`;
    const invoiceId = `${prefix}invoice-${suffix}`;
    const providerPaymentId = `PAY_BASIC_NEW_CYCLE_${suffix}`;
    const oldPeriodStart = new Date('2026-08-20T00:00:00.000Z');
    const oldPeriodEnd = new Date('2026-09-20T00:00:00.000Z');
    const newPeriodStart = new Date('2026-09-20T00:00:00.000Z');
    const newPeriodEnd = new Date('2026-10-20T00:00:00.000Z');
    const approvedAt = new Date('2026-09-20T01:00:00.000Z');
    const definitions = await prisma.entitlementDefinition.findMany({
      where: { code: { in: [...commercialCodes] } },
    });
    expect(definitions).toHaveLength(3);

    await prisma.plan.create({
      data: {
        id: planId,
        type: PlanType.BASIC,
        name: planId,
        price: '29.90',
        imageLimit: 1,
        entitlements: {
          create: definitions.map((definition) => ({
            entitlementId: definition.id,
            value: definition.code === IMAGE_ANALYSIS ? 5 : 1,
            unlimited: false,
          })),
        },
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
        externalSubscriptionId: `SUBS_BASIC_NEW_CYCLE_${suffix}`,
        currentPeriodStart: oldPeriodStart,
        currentPeriodEnd: oldPeriodEnd,
      },
    });
    await prisma.usageBucket.createMany({
      data: definitions.map((definition) => ({
        userId,
        entitlementCode: definition.code,
        periodStart: oldPeriodStart,
        periodEnd: oldPeriodEnd,
        used: definition.code === IMAGE_ANALYSIS ? 5 : 1,
        reserved: 0,
      })),
    });
    await prisma.invoice.create({
      data: {
        id: invoiceId,
        subscriptionId,
        externalReference: `invoice-${suffix}`,
        providerInvoiceId: `INVO_BASIC_NEW_CYCLE_${suffix}`,
        cycleNumber: 2,
        subtotal: '29.90',
        total: '29.90',
        periodStart: newPeriodStart,
        periodEnd: newPeriodEnd,
        dueAt: newPeriodStart,
      },
    });
    await prisma.payment.create({
      data: {
        invoiceId,
        provider: PaymentProvider.PAGBANK,
        method: PaymentMethod.CREDIT_CARD,
        status: PaymentStatus.PENDING,
        amount: '29.90',
        idempotencyKey: `idempotency-${suffix}`,
        externalReference: `payment-${suffix}`,
        providerOrderId: `ORDER_BASIC_NEW_CYCLE_${suffix}`,
        providerPaymentId,
      },
    });

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
    await expect(
      settlement.settlePagBankPayment({
        providerOrderId: `ORDER_BASIC_NEW_CYCLE_${suffix}`,
        providerPaymentId,
        externalReference: `payment-${suffix}`,
        status: 'APPROVED',
        amountInCents: 2990,
        currency: 'BRL',
        approvedAt,
      }),
    ).resolves.toBe('APPROVED');

    const entitlements = new EntitlementsService(
      prisma as unknown as PrismaService,
      new SubscriptionAccessService(prisma as unknown as PrismaService),
    );
    const grants = await Promise.all(
      commercialCodes.map((code) =>
        entitlements.resolveCommercialGrant(userId, code, approvedAt),
      ),
    );
    const subscription = await prisma.subscription.findUniqueOrThrow({
      where: { id: subscriptionId },
    });
    const oldBuckets = await prisma.usageBucket.findMany({
      where: { userId, periodStart: oldPeriodStart, periodEnd: oldPeriodEnd },
      orderBy: { entitlementCode: 'asc' },
    });
    const newBuckets = await prisma.usageBucket.count({
      where: { userId, periodStart: newPeriodStart, periodEnd: newPeriodEnd },
    });

    expect(subscription).toMatchObject({
      currentPeriodStart: newPeriodStart,
      currentPeriodEnd: newPeriodEnd,
    });
    expect(grants).toEqual([
      expect.objectContaining({
        code: NUTRITION_PLAN_GENERATION,
        limit: 1,
        unlimited: false,
        periodStart: newPeriodStart,
        periodEnd: newPeriodEnd,
      }),
      expect.objectContaining({
        code: WORKOUT_PLAN_GENERATION,
        limit: 1,
        unlimited: false,
      }),
      expect.objectContaining({
        code: IMAGE_ANALYSIS,
        limit: 5,
        unlimited: false,
      }),
    ]);
    expect(oldBuckets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entitlementCode: NUTRITION_PLAN_GENERATION,
          used: 1,
        }),
        expect.objectContaining({
          entitlementCode: WORKOUT_PLAN_GENERATION,
          used: 1,
        }),
        expect.objectContaining({ entitlementCode: IMAGE_ANALYSIS, used: 5 }),
      ]),
    );
    expect(oldBuckets).toHaveLength(3);
    expect(newBuckets).toBe(0);
  });
});
