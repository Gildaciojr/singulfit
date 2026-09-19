import { BadRequestException } from '@nestjs/common';
import {
  PaymentProvider,
  PlanType,
  Prisma,
  SubscriptionStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PagBankRecurringGateway } from './pagbank-recurring.gateway';
import { PagBankRecurringProvisioningService } from './pagbank-recurring-provisioning.service';

describe('PagBankRecurringProvisioningService plan provisioning', () => {
  function subject() {
    const prisma = {
      providerPlanMapping: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
      },
      providerCustomer: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
      },
      subscription: {
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        updateMany: jest.fn(),
      },
      plan: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'basic',
          type: PlanType.BASIC,
          name: 'Basic',
          isActive: true,
          price: { mul: () => ({ toNumber: () => 2990 }) },
        }),
      },
    };
    const gateway = {
      createPlan: jest.fn().mockResolvedValue('PLAN_BASIC'),
      createCustomer: jest.fn().mockResolvedValue('CUST_NEW'),
      createSubscription: jest.fn().mockResolvedValue('SUBS_NEW'),
    };
    const service = new PagBankRecurringProvisioningService(
      prisma as unknown as PrismaService,
      gateway as unknown as PagBankRecurringGateway,
    );
    return { prisma, gateway, service };
  }

  it.each([1, 3, 6, 12] as const)(
    'provisions BASIC with %i cycle(s) at 2990 cents',
    async (billingCycles) => {
      const { prisma, gateway, service } = subject();
      prisma.providerPlanMapping.create.mockResolvedValue({
        billingCycles,
        providerPlanId: 'PLAN_BASIC',
      });
      await expect(
        service.provisionPlan('basic', billingCycles),
      ).resolves.toMatchObject({ billingCycles, providerPlanId: 'PLAN_BASIC' });
      expect(gateway.createPlan).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 2990, billingCycles }),
      );
    },
  );

  it('rejects an invalid cycle before calling the provider', async () => {
    const { gateway, service } = subject();
    await expect(
      service.provisionPlan('basic', 2 as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(gateway.createPlan).not.toHaveBeenCalled();
  });

  it.each([1, 3, 6, 12] as const)(
    'provisions PREMIUM with %i cycle(s) at 6990 cents',
    async (billingCycles) => {
      const { prisma, gateway, service } = subject();
      prisma.plan.findUnique.mockResolvedValue({
        id: 'premium',
        type: PlanType.PREMIUM,
        name: 'Premium',
        isActive: true,
        price: { mul: () => ({ toNumber: () => 6990 }) },
      });
      prisma.providerPlanMapping.create.mockResolvedValue({
        billingCycles,
        providerPlanId: 'PLAN_PREMIUM',
      });
      await expect(
        service.provisionPlan('premium', billingCycles),
      ).resolves.toMatchObject({
        billingCycles,
        providerPlanId: 'PLAN_PREMIUM',
      });
      expect(gateway.createPlan).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 6990, billingCycles }),
      );
    },
  );

  it('reuses an existing provider plan mapping without a provider call', async () => {
    const { prisma, gateway, service } = subject();
    const mapping = { id: 'mapping-id', providerPlanId: 'PLAN_EXISTING' };
    prisma.providerPlanMapping.findUnique.mockResolvedValue(mapping);
    await expect(service.provisionPlan('basic', 3)).resolves.toBe(mapping);
    expect(gateway.createPlan).not.toHaveBeenCalled();
  });

  const card = {
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    taxId: '12345678901',
    phone: {
      country: '55',
      area: '11',
      number: '999999999',
      type: 'MOBILE' as const,
    },
    encryptedCard: 'encrypted-card',
  };

  it('reuses an existing provider customer without a provider call', async () => {
    const { prisma, gateway, service } = subject();
    const customer = { id: 'customer-id', providerCustomerId: 'CUST_EXISTING' };
    prisma.providerCustomer.findUnique.mockResolvedValue(customer);

    await expect(service.provisionCustomer('user-id', card)).resolves.toBe(
      customer,
    );
    expect(gateway.createCustomer).not.toHaveBeenCalled();
  });

  it('creates a provider customer for the requested user', async () => {
    const { prisma, gateway, service } = subject();
    prisma.providerCustomer.create.mockResolvedValue({
      userId: 'user-id',
      provider: PaymentProvider.PAGBANK,
      providerCustomerId: 'CUST_NEW',
    });

    await expect(
      service.provisionCustomer('user-id', card),
    ).resolves.toMatchObject({
      userId: 'user-id',
      provider: PaymentProvider.PAGBANK,
      providerCustomerId: 'CUST_NEW',
    });
    expect(gateway.createCustomer).toHaveBeenCalledWith(
      expect.objectContaining({ ...card, referenceId: 'singulfituseruserid' }),
    );
    expect(prisma.providerCustomer.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-id',
        provider: PaymentProvider.PAGBANK,
        providerCustomerId: 'CUST_NEW',
      },
    });
  });

  it('uses the same deterministic customer reference on a retry', async () => {
    const first = subject();
    const retry = subject();
    first.prisma.providerCustomer.create.mockResolvedValue({
      providerCustomerId: 'CUST_FIRST',
    });
    retry.prisma.providerCustomer.create.mockResolvedValue({
      providerCustomerId: 'CUST_RETRY',
    });

    await first.service.provisionCustomer('retry-user-id', card);
    await retry.service.provisionCustomer('retry-user-id', card);

    expect(first.gateway.createCustomer.mock.calls[0][0].referenceId).toBe(
      retry.gateway.createCustomer.mock.calls[0][0].referenceId,
    );
  });

  it('propagates a customer provider failure without persisting a customer', async () => {
    const { prisma, gateway, service } = subject();
    const failure = new Error('provider unavailable');
    gateway.createCustomer.mockRejectedValue(failure);

    await expect(service.provisionCustomer('user-id', card)).rejects.toBe(
      failure,
    );
    expect(prisma.providerCustomer.create).not.toHaveBeenCalled();
  });

  it('returns the canonical customer after a unique conflict during persistence', async () => {
    const { prisma, gateway, service } = subject();
    const canonical = {
      id: 'canonical-id',
      providerCustomerId: 'CUST_CANONICAL',
    };
    prisma.providerCustomer.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(canonical);
    prisma.providerCustomer.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('unique conflict', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    await expect(service.provisionCustomer('user-id', card)).resolves.toBe(
      canonical,
    );
    expect(gateway.createCustomer).toHaveBeenCalledTimes(1);
    expect(prisma.providerCustomer.create).toHaveBeenCalledTimes(1);
    expect(prisma.providerCustomer.findUnique).toHaveBeenCalledTimes(2);
  });

  function subscriptionSubject(
    overrides: Partial<{
      externalSubscriptionId: string | null;
      status: SubscriptionStatus;
      currentPeriodStart: Date | null;
      currentPeriodEnd: Date | null;
    }> = {},
  ) {
    const test = subject();
    const subscription = {
      id: 'subscription-id',
      userId: 'user-id',
      planId: 'basic',
      status: SubscriptionStatus.PENDING_PAYMENT,
      externalSubscriptionId: null,
      currentPeriodStart: new Date('2026-09-01T00:00:00.000Z'),
      currentPeriodEnd: new Date('2026-10-01T00:00:00.000Z'),
      ...overrides,
    };
    test.prisma.subscription.findUnique.mockResolvedValue(subscription);
    test.prisma.providerPlanMapping.findUnique.mockResolvedValue({
      providerPlanId: 'PLAN_BASIC',
    });
    test.prisma.providerCustomer.findUnique.mockResolvedValue({
      providerCustomerId: 'CUST_EXISTING',
    });
    test.prisma.subscription.updateMany.mockResolvedValue({ count: 1 });
    test.prisma.subscription.findUniqueOrThrow.mockResolvedValue({
      ...subscription,
      provider: PaymentProvider.PAGBANK,
      externalSubscriptionId: 'SUBS_NEW',
      billingCycles: 3,
    });
    return { ...test, subscription };
  }

  const subscriptionInput = {
    subscriptionId: 'subscription-id',
    userId: 'user-id',
    planId: 'basic',
    billingCycles: 3 as const,
    card,
  };

  it('creates a recurring subscription with the provider subscription id and cycle', async () => {
    const { prisma, gateway, service } = subscriptionSubject();

    await service.createSubscription(subscriptionInput);

    expect(gateway.createSubscription).toHaveBeenCalledWith({
      referenceId: 'singulfitsubsubscriptionid',
      planId: 'PLAN_BASIC',
      customerId: 'CUST_EXISTING',
      encryptedCard: card.encryptedCard,
    });
    expect(prisma.subscription.updateMany).toHaveBeenCalledWith({
      where: { id: 'subscription-id', externalSubscriptionId: null },
      data: {
        provider: PaymentProvider.PAGBANK,
        externalSubscriptionId: 'SUBS_NEW',
        billingCycles: 3,
      },
    });
  });

  it('returns an existing external subscription without another provider call', async () => {
    const { gateway, service, subscription } = subscriptionSubject({
      externalSubscriptionId: 'SUBS_EXISTING',
    });

    await expect(service.createSubscription(subscriptionInput)).resolves.toBe(
      subscription,
    );
    expect(gateway.createSubscription).not.toHaveBeenCalled();
  });

  it('uses the same deterministic subscription reference on a retry', async () => {
    const first = subscriptionSubject();
    const retry = subscriptionSubject();

    await first.service.createSubscription(subscriptionInput);
    await retry.service.createSubscription(subscriptionInput);

    expect(first.gateway.createSubscription.mock.calls[0][0].referenceId).toBe(
      retry.gateway.createSubscription.mock.calls[0][0].referenceId,
    );
  });

  it('propagates a subscription provider failure without local subscription persistence', async () => {
    const { prisma, gateway, service } = subscriptionSubject();
    const failure = new Error('subscription provider unavailable');
    gateway.createSubscription.mockRejectedValue(failure);

    await expect(service.createSubscription(subscriptionInput)).rejects.toBe(
      failure,
    );
    expect(prisma.subscription.updateMany).not.toHaveBeenCalled();
  });

  it('returns the canonical subscription after a simulated persistence race', async () => {
    const { prisma, gateway, service } = subscriptionSubject();
    const canonical = {
      id: 'subscription-id',
      externalSubscriptionId: 'SUBS_CANONICAL',
      billingCycles: 6,
    };
    prisma.subscription.updateMany.mockResolvedValue({ count: 0 });
    prisma.subscription.findUniqueOrThrow.mockResolvedValue(canonical);

    await expect(service.createSubscription(subscriptionInput)).resolves.toBe(
      canonical,
    );
    expect(gateway.createSubscription).toHaveBeenCalledTimes(1);
    expect(prisma.subscription.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'subscription-id', externalSubscriptionId: null },
        data: expect.objectContaining({ externalSubscriptionId: 'SUBS_NEW' }),
      }),
    );
    expect(prisma.subscription.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { id: 'subscription-id' },
    });
  });

  it('does not activate a subscription during recurring creation', async () => {
    const { prisma, service } = subscriptionSubject();

    await service.createSubscription(subscriptionInput);

    expect(
      prisma.subscription.updateMany.mock.calls[0][0].data.status,
    ).toBeUndefined();
  });

  it('does not advance subscription periods during recurring creation', async () => {
    const { prisma, service } = subscriptionSubject();

    await service.createSubscription(subscriptionInput);

    const data = prisma.subscription.updateMany.mock.calls[0][0].data;
    expect(data.currentPeriodStart).toBeUndefined();
    expect(data.currentPeriodEnd).toBeUndefined();
  });

  it('does not touch entitlements during recurring creation', async () => {
    const { prisma, service } = subscriptionSubject();

    await service.createSubscription(subscriptionInput);

    expect(prisma.entitlement).toBeUndefined();
    expect(
      prisma.subscription.updateMany.mock.calls[0][0].data,
    ).not.toHaveProperty('entitlement');
  });

  it('keeps encrypted card data out of prisma persistence calls', async () => {
    const { prisma, service } = subscriptionSubject();

    await service.createSubscription(subscriptionInput);

    const persistenceCalls = JSON.stringify([
      prisma.providerPlanMapping.create.mock.calls,
      prisma.providerCustomer.create.mock.calls,
      prisma.subscription.updateMany.mock.calls,
    ]);
    expect(persistenceCalls).not.toContain(card.encryptedCard);
  });

  it('keeps PAN, CVV, and security code out of persistence and logs', async () => {
    const { prisma, service } = subscriptionSubject();
    const sensitiveCard = {
      ...card,
      pan: '4111111111111111',
      cvv: '123',
      security_code: '456',
    };
    const consoleError = jest.spyOn(console, 'error').mockImplementation();

    await service.createSubscription({
      ...subscriptionInput,
      card: sensitiveCard,
    });

    const persistenceCalls = JSON.stringify([
      prisma.providerPlanMapping.create.mock.calls,
      prisma.providerCustomer.create.mock.calls,
      prisma.subscription.updateMany.mock.calls,
    ]);
    expect(persistenceCalls).not.toContain(sensitiveCard.pan);
    expect(persistenceCalls).not.toContain(sensitiveCard.cvv);
    expect(persistenceCalls).not.toContain(sensitiveCard.security_code);
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
