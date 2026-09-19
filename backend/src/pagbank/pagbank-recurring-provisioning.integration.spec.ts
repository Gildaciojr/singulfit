import {
  PaymentMethod,
  PaymentProvider,
  PlanType,
  PrismaClient,
  SubscriptionStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PagBankRecurringGateway } from './pagbank-recurring.gateway';
import { PagBankRecurringProvisioningService } from './pagbank-recurring-provisioning.service';

const databaseUrl = process.env.DATABASE_URL;
const safeDatabaseUrl =
  databaseUrl ?? 'postgresql://disabled:disabled@127.0.0.1:1/disabled';
const integrationDescribe = databaseUrl ? describe : describe.skip;
const fixturePrefix = 'pagbank-recurring-integration-';
let fixtureCounter = 0;

function fixtureId(kind: string) {
  fixtureCounter += 1;
  return `${fixturePrefix}${kind}-${Date.now()}-${fixtureCounter}`;
}

integrationDescribe(
  'PagBank recurring provisioning PostgreSQL integration',
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

    async function cleanFixtures() {
      await prisma.payment.deleteMany({
        where: { id: { startsWith: fixturePrefix } },
      });
      await prisma.invoice.deleteMany({
        where: { id: { startsWith: fixturePrefix } },
      });
      await prisma.subscription.deleteMany({
        where: { id: { startsWith: fixturePrefix } },
      });
      await prisma.providerCustomer.deleteMany({
        where: { userId: { startsWith: fixturePrefix } },
      });
      await prisma.providerPlanMapping.deleteMany({
        where: { planId: { startsWith: fixturePrefix } },
      });
      await prisma.user.deleteMany({
        where: { id: { startsWith: fixturePrefix } },
      });
      await prisma.plan.deleteMany({
        where: { id: { startsWith: fixturePrefix } },
      });
    }

    afterEach(async () => {
      await cleanFixtures();
    });

    afterAll(async () => {
      await cleanFixtures();
      await prisma.$disconnect();
    });

    async function createPlanFixture() {
      const id = fixtureId('plan');
      return prisma.plan.create({
        data: {
          id,
          type: PlanType.BASIC,
          name: `Integration ${id}`,
          price: '29.90',
          imageLimit: 1,
        },
      });
    }

    async function createUserFixture() {
      const id = fixtureId('user');
      return prisma.user.create({
        data: {
          id,
          phone: `+55${fixtureCounter.toString().padStart(12, '0')}`,
        },
      });
    }

    async function createSubscriptionFixture(userId: string, planId: string) {
      const id = fixtureId('subscription');
      return prisma.subscription.create({
        data: {
          id,
          userId,
          planId,
          amount: '29.90',
          status: SubscriptionStatus.PENDING_PAYMENT,
          currentPeriodStart: new Date('2026-09-01T00:00:00.000Z'),
          currentPeriodEnd: new Date('2026-10-01T00:00:00.000Z'),
        },
      });
    }

    function serviceWithGateway(gateway: {
      createPlan: jest.Mock;
      createCustomer: jest.Mock;
      createSubscription: jest.Mock;
    }) {
      return new PagBankRecurringProvisioningService(
        prisma as unknown as PrismaService,
        gateway as unknown as PagBankRecurringGateway,
      );
    }

    const card = {
      name: 'Integration User',
      email: 'integration@example.com',
      taxId: '12345678901',
      phone: {
        country: '55',
        area: '11',
        number: '999999999',
        type: 'MOBILE' as const,
      },
      encryptedCard: 'integration-encrypted-card',
    };

    it('serializes concurrent ProviderPlanMapping provisioning to one canonical mapping', async () => {
      const plan = await createPlanFixture();
      const gateway = {
        createPlan: jest.fn().mockResolvedValue('PLAN_CONCURRENCY_CANONICAL'),
        createCustomer: jest.fn(),
        createSubscription: jest.fn(),
      };
      const service = serviceWithGateway(gateway);

      const results = await Promise.all([
        service.provisionPlan(plan.id, 3),
        service.provisionPlan(plan.id, 3),
      ]);

      expect(gateway.createPlan).toHaveBeenCalledTimes(2);
      const planReferences = gateway.createPlan.mock.calls.map(
        (call) => (call[0] as { referenceId: string }).referenceId,
      );
      expect(planReferences).toEqual([
        gateway.createPlan.mock.calls[0][0].referenceId,
        gateway.createPlan.mock.calls[0][0].referenceId,
      ]);
      expect(results.map((result) => result.providerPlanId)).toEqual([
        'PLAN_CONCURRENCY_CANONICAL',
        'PLAN_CONCURRENCY_CANONICAL',
      ]);
      await expect(
        prisma.providerPlanMapping.count({
          where: {
            planId: plan.id,
            provider: PaymentProvider.PAGBANK,
            billingCycles: 3,
          },
        }),
      ).resolves.toBe(1);
    });

    it('serializes concurrent ProviderCustomer provisioning to one canonical customer', async () => {
      const user = await createUserFixture();
      const gateway = {
        createPlan: jest.fn(),
        createCustomer: jest
          .fn()
          .mockResolvedValue('CUST_CONCURRENCY_CANONICAL'),
        createSubscription: jest.fn(),
      };
      const service = serviceWithGateway(gateway);

      const results = await Promise.all([
        service.provisionCustomer(user.id, card),
        service.provisionCustomer(user.id, card),
      ]);

      expect(gateway.createCustomer).toHaveBeenCalledTimes(2);
      const customerReferences = gateway.createCustomer.mock.calls.map(
        (call) => (call[0] as { referenceId: string }).referenceId,
      );
      expect(customerReferences).toEqual([
        gateway.createCustomer.mock.calls[0][0].referenceId,
        gateway.createCustomer.mock.calls[0][0].referenceId,
      ]);
      expect(results.map((result) => result.providerCustomerId)).toEqual([
        'CUST_CONCURRENCY_CANONICAL',
        'CUST_CONCURRENCY_CANONICAL',
      ]);
      await expect(
        prisma.providerCustomer.count({
          where: { userId: user.id, provider: PaymentProvider.PAGBANK },
        }),
      ).resolves.toBe(1);
    });

    it('keeps concurrent subscription provisioning canonical and pending', async () => {
      const plan = await createPlanFixture();
      const user = await createUserFixture();
      const subscription = await createSubscriptionFixture(user.id, plan.id);
      await prisma.providerPlanMapping.create({
        data: {
          planId: plan.id,
          provider: PaymentProvider.PAGBANK,
          billingCycles: 6,
          providerPlanId: 'PLAN_SUBSCRIPTION_CONCURRENCY',
          referenceId: `subscription-plan-${subscription.id}`,
        },
      });
      await prisma.providerCustomer.create({
        data: {
          userId: user.id,
          provider: PaymentProvider.PAGBANK,
          providerCustomerId: 'CUST_SUBSCRIPTION_CONCURRENCY',
        },
      });
      const gateway = {
        createPlan: jest.fn(),
        createCustomer: jest.fn(),
        createSubscription: jest
          .fn()
          .mockResolvedValue('SUBS_CONCURRENCY_CANONICAL'),
      };
      const service = serviceWithGateway(gateway);
      const input = {
        subscriptionId: subscription.id,
        userId: user.id,
        planId: plan.id,
        billingCycles: 6 as const,
        card,
      };

      const results = await Promise.all([
        service.createSubscription(input),
        service.createSubscription(input),
      ]);
      const finalSubscription = await prisma.subscription.findUniqueOrThrow({
        where: { id: subscription.id },
      });

      expect(gateway.createSubscription).toHaveBeenCalledTimes(2);
      const subscriptionReferences = gateway.createSubscription.mock.calls.map(
        (call) => (call[0] as { referenceId: string }).referenceId,
      );
      expect(subscriptionReferences).toEqual([
        gateway.createSubscription.mock.calls[0][0].referenceId,
        gateway.createSubscription.mock.calls[0][0].referenceId,
      ]);
      expect(results.map((result) => result.externalSubscriptionId)).toEqual([
        'SUBS_CONCURRENCY_CANONICAL',
        'SUBS_CONCURRENCY_CANONICAL',
      ]);
      expect(finalSubscription).toMatchObject({
        provider: PaymentProvider.PAGBANK,
        externalSubscriptionId: 'SUBS_CONCURRENCY_CANONICAL',
        billingCycles: 6,
        status: SubscriptionStatus.PENDING_PAYMENT,
        currentPeriodStart: subscription.currentPeriodStart,
        currentPeriodEnd: subscription.currentPeriodEnd,
      });
      await expect(
        prisma.usageBucket.count({ where: { userId: user.id } }),
      ).resolves.toBe(0);
    });

    it('enforces the provider-scoped external subscription id unique fence', async () => {
      const plan = await createPlanFixture();
      const firstUser = await createUserFixture();
      const secondUser = await createUserFixture();
      const first = await createSubscriptionFixture(firstUser.id, plan.id);
      const second = await createSubscriptionFixture(secondUser.id, plan.id);
      await prisma.subscription.update({
        where: { id: first.id },
        data: {
          provider: PaymentProvider.PAGBANK,
          externalSubscriptionId: 'SUBS_UNIQUE_FENCE',
        },
      });

      await expect(
        prisma.subscription.update({
          where: { id: second.id },
          data: {
            provider: PaymentProvider.PAGBANK,
            externalSubscriptionId: 'SUBS_UNIQUE_FENCE',
          },
        }),
      ).rejects.toMatchObject({ code: 'P2002' });
    });

    it('enforces the provider-scoped provider payment id unique fence', async () => {
      const plan = await createPlanFixture();
      const firstUser = await createUserFixture();
      const secondUser = await createUserFixture();
      const firstSubscription = await createSubscriptionFixture(
        firstUser.id,
        plan.id,
      );
      const secondSubscription = await createSubscriptionFixture(
        secondUser.id,
        plan.id,
      );
      const firstInvoiceId = fixtureId('invoice');
      const secondInvoiceId = fixtureId('invoice');
      await prisma.invoice.createMany({
        data: [
          {
            id: firstInvoiceId,
            subscriptionId: firstSubscription.id,
            externalReference: fixtureId('invoice-reference'),
            cycleNumber: 1,
            subtotal: '29.90',
            total: '29.90',
            periodStart: new Date('2026-09-01T00:00:00.000Z'),
            periodEnd: new Date('2026-10-01T00:00:00.000Z'),
            dueAt: new Date('2026-09-01T00:00:00.000Z'),
          },
          {
            id: secondInvoiceId,
            subscriptionId: secondSubscription.id,
            externalReference: fixtureId('invoice-reference'),
            cycleNumber: 1,
            subtotal: '29.90',
            total: '29.90',
            periodStart: new Date('2026-09-01T00:00:00.000Z'),
            periodEnd: new Date('2026-10-01T00:00:00.000Z'),
            dueAt: new Date('2026-09-01T00:00:00.000Z'),
          },
        ],
      });
      await prisma.payment.create({
        data: {
          id: fixtureId('payment'),
          invoiceId: firstInvoiceId,
          provider: PaymentProvider.PAGBANK,
          method: PaymentMethod.CREDIT_CARD,
          amount: '29.90',
          idempotencyKey: fixtureId('payment-idempotency'),
          externalReference: fixtureId('payment-reference'),
          providerPaymentId: 'PAYMENT_UNIQUE_FENCE',
        },
      });

      await expect(
        prisma.payment.create({
          data: {
            id: fixtureId('payment'),
            invoiceId: secondInvoiceId,
            provider: PaymentProvider.PAGBANK,
            method: PaymentMethod.CREDIT_CARD,
            amount: '29.90',
            idempotencyKey: fixtureId('payment-idempotency'),
            externalReference: fixtureId('payment-reference'),
            providerPaymentId: 'PAYMENT_UNIQUE_FENCE',
          },
        }),
      ).rejects.toMatchObject({ code: 'P2002' });
    });
  },
);
