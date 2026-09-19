import {
  PaymentProvider,
  PaymentStatus,
  PlanType,
  PrismaClient,
  SubscriptionStatus,
} from '@prisma/client';
import { PagBankRecurringGateway } from '../pagbank/pagbank-recurring.gateway';
import { PagBankRecurringReconciliationService } from '../payments/pagbank-recurring-reconciliation.service';
import { PaymentSettlementService } from '../payments/payment-settlement.service';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { PagBankRecurringWebhookService } from './pagbank-recurring-webhook.service';

const databaseUrl = process.env.DATABASE_URL;
const safeDatabaseUrl =
  databaseUrl ?? 'postgresql://disabled:disabled@127.0.0.1:1/disabled';
const integrationDescribe = databaseUrl ? describe : describe.skip;
const prefix = 'pagbank-webhook-3b-integration-';
let fixture = 0;

integrationDescribe('PagBank recurring webhook PostgreSQL evidence', () => {
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

  async function cleanFixtures() {
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
  }

  afterEach(cleanFixtures);
  afterAll(async () => {
    await cleanFixtures();
    await prisma.$disconnect();
  });

  async function subject(
    providerStatus: string,
    paymentStatus: 'APPROVED' | 'PENDING' = 'APPROVED',
    subscriptionStatus = SubscriptionStatus.PENDING_PAYMENT,
    gracePeriodEnd: Date | null = null,
  ) {
    fixture += 1;
    const key = `${Date.now()}-${fixture}`;
    const planId = `${prefix}plan-${key}`;
    const userId = `${prefix}user-${key}`;
    const subscriptionId = `${prefix}subscription-${key}`;
    const externalSubscriptionId = `SUBS_3B_${key}`;
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
      data: { id: userId, phone: `+55${key.replace(/\D/g, '').slice(-12)}` },
    });
    await prisma.subscription.create({
      data: {
        id: subscriptionId,
        userId,
        planId,
        amount: '29.90',
        provider: PaymentProvider.PAGBANK,
        externalSubscriptionId,
        status: subscriptionStatus,
        currentPeriodEnd: new Date('2026-10-01T00:00:00.000Z'),
        gracePeriodEnd,
      },
    });
    const invoice = {
      id: `INVO_3B_${key}`,
      subscriptionId: externalSubscriptionId,
      cycleNumber: 1,
      amountInCents: 2990,
      currency: 'BRL',
      periodStart: new Date('2026-09-01T00:00:00.000Z'),
      periodEnd: new Date('2026-10-01T00:00:00.000Z'),
      dueAt: new Date('2026-09-01T00:00:00.000Z'),
    };
    const providerPayment = {
      id: `PAY_3B_${key}`,
      invoiceId: invoice.id,
      subscriptionId: externalSubscriptionId,
      orderId: `ORDER_3B_${key}`,
      status: paymentStatus,
      amountInCents: 2990,
      currency: 'BRL',
      approvedAt: new Date('2026-09-01T01:00:00.000Z'),
    };
    let failProvider = false;
    const gateway = {
      getSubscription: jest.fn(() => {
        if (failProvider) throw new Error('provider unavailable');
        return Promise.resolve({
          id: externalSubscriptionId,
          status: providerStatus,
        });
      }),
      listSubscriptionInvoices: jest.fn(() => {
        if (failProvider) throw new Error('provider unavailable');
        return Promise.resolve(
          paymentStatus === 'APPROVED' || paymentStatus === 'PENDING'
            ? [invoice]
            : [],
        );
      }),
      listInvoicePayments: jest.fn(() => {
        if (failProvider) throw new Error('provider unavailable');
        return Promise.resolve([providerPayment]);
      }),
    };
    let settlementEffects = 0;
    const settlement = {
      settlePagBankPayment: jest.fn(async () => {
        const changed = await prisma.payment.updateMany({
          where: {
            provider: PaymentProvider.PAGBANK,
            providerPaymentId: providerPayment.id,
            status: { not: PaymentStatus.APPROVED },
          },
          data: {
            status: PaymentStatus.APPROVED,
            approvedAt: providerPayment.approvedAt,
          },
        });
        if (changed.count === 1) {
          settlementEffects += 1;
          await prisma.subscription.update({
            where: { id: subscriptionId },
            data: { status: SubscriptionStatus.ACTIVE, gracePeriodEnd: null },
          });
        }
        return changed.count === 1 ? 'APPROVED' : 'ALREADY_PROCESSED';
      }),
    };
    const reconciliation = new PagBankRecurringReconciliationService(
      prisma as unknown as PrismaService,
      gateway as unknown as PagBankRecurringGateway,
      settlement as unknown as PaymentSettlementService,
    );
    const subscriptions = {
      calculateGracePeriodEnd: jest.fn(
        () => new Date('2026-10-04T00:00:00.000Z'),
      ),
    };
    return {
      subscriptionId,
      externalSubscriptionId,
      providerPayment,
      gateway,
      setProviderFailure: (value: boolean) => (failProvider = value),
      settlementEffects: () => settlementEffects,
      service: new PagBankRecurringWebhookService(
        prisma as unknown as PrismaService,
        gateway as unknown as PagBankRecurringGateway,
        reconciliation,
        subscriptions as unknown as SubscriptionsService,
      ),
    };
  }

  it('converges concurrent recurrence and its replay to one canonical payment effect', async () => {
    const test = await subject('ACTIVE');
    await Promise.all([
      test.service.process(
        test.externalSubscriptionId,
        'subscription.recurrence',
      ),
      test.service.process(
        test.externalSubscriptionId,
        'subscription.recurrence',
      ),
    ]);
    await test.service.process(
      test.externalSubscriptionId,
      'subscription.recurrence',
    );
    await expect(
      prisma.payment.count({
        where: { providerPaymentId: test.providerPayment.id },
      }),
    ).resolves.toBe(1);
    expect(test.settlementEffects()).toBe(1);
    await expect(
      prisma.subscription.findUniqueOrThrow({
        where: { id: test.subscriptionId },
      }),
    ).resolves.toMatchObject({ status: SubscriptionStatus.ACTIVE });
  });

  it('leaves no financial mutation on provider failure and succeeds on retry', async () => {
    const test = await subject('ACTIVE');
    test.setProviderFailure(true);
    await expect(
      test.service.process(
        test.externalSubscriptionId,
        'subscription.recurrence',
      ),
    ).rejects.toThrow('provider unavailable');
    await expect(
      prisma.payment.count({
        where: { providerPaymentId: test.providerPayment.id },
      }),
    ).resolves.toBe(0);
    test.setProviderFailure(false);
    await test.service.process(
      test.externalSubscriptionId,
      'subscription.recurrence',
    );
    await expect(
      prisma.payment.count({
        where: { providerPaymentId: test.providerPayment.id },
      }),
    ).resolves.toBe(1);
    expect(test.settlementEffects()).toBe(1);
  });

  it('converges concurrent OVERDUE without extending canonical grace or creating payment', async () => {
    const test = await subject('OVERDUE', 'PENDING');
    await Promise.all([
      test.service.process(test.externalSubscriptionId, 'subscription.updated'),
      test.service.process(test.externalSubscriptionId, 'subscription.updated'),
    ]);
    const first = await prisma.subscription.findUniqueOrThrow({
      where: { id: test.subscriptionId },
    });
    await test.service.process(
      test.externalSubscriptionId,
      'subscription.updated',
    );
    const replay = await prisma.subscription.findUniqueOrThrow({
      where: { id: test.subscriptionId },
    });
    expect(first).toMatchObject({
      status: SubscriptionStatus.PAST_DUE,
      gracePeriodEnd: new Date('2026-10-04T00:00:00.000Z'),
    });
    expect(replay.gracePeriodEnd).toEqual(first.gracePeriodEnd);
    await expect(
      prisma.payment.count({
        where: { providerPaymentId: test.providerPayment.id },
      }),
    ).resolves.toBe(1);
  });

  it('converges concurrent recovery to one payment effect and cleared grace', async () => {
    const test = await subject(
      'ACTIVE',
      'APPROVED',
      SubscriptionStatus.PAST_DUE,
      new Date('2026-10-04T00:00:00.000Z'),
    );
    await Promise.all([
      test.service.process(
        test.externalSubscriptionId,
        'subscription.recurrence',
      ),
      test.service.process(
        test.externalSubscriptionId,
        'subscription.recurrence',
      ),
    ]);
    const subscription = await prisma.subscription.findUniqueOrThrow({
      where: { id: test.subscriptionId },
    });
    expect(subscription).toMatchObject({
      status: SubscriptionStatus.ACTIVE,
      gracePeriodEnd: null,
    });
    expect(test.settlementEffects()).toBe(1);
    await expect(
      prisma.payment.count({
        where: { providerPaymentId: test.providerPayment.id },
      }),
    ).resolves.toBe(1);
  });

  it('keeps EXPIRED and CANCELED terminal across replay and forged update', async () => {
    for (const status of ['EXPIRED', 'CANCELED'] as const) {
      const test = await subject(status, 'PENDING', SubscriptionStatus.ACTIVE);
      const action =
        status === 'EXPIRED' ? 'subscription.expired' : 'subscription.canceled';
      await test.service.process(test.externalSubscriptionId, action);
      await test.service.process(test.externalSubscriptionId, action);
      await test.service.process(
        test.externalSubscriptionId,
        'subscription.updated',
      );
      await expect(
        prisma.subscription.findUniqueOrThrow({
          where: { id: test.subscriptionId },
        }),
      ).resolves.toMatchObject({
        status:
          status === 'EXPIRED'
            ? SubscriptionStatus.EXPIRED
            : SubscriptionStatus.CANCELED,
      });
      await expect(
        prisma.invoice.count({
          where: { subscriptionId: test.subscriptionId },
        }),
      ).resolves.toBe(0);
      await expect(
        prisma.payment.count({
          where: { invoice: { subscriptionId: test.subscriptionId } },
        }),
      ).resolves.toBe(0);
      await cleanFixtures();
    }
  });
});
