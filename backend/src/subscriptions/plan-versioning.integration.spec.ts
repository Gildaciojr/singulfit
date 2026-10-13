import { randomUUID } from 'node:crypto';
import { UsersService } from '../users/users.service';
import { ConfigService } from '@nestjs/config';
import {
  PlanType,
  Prisma,
  PrismaClient,
  SubscriptionStatus,
} from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../observability/audit.service';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionAccessService } from './subscription-access.service';
import {
  assertDisposableCommercialSeed,
  BASIC_V2_GRANTS,
} from './commercial-plan.policy';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { ReservationService } from '../entitlements/reservation.service';
import { BillingService } from '../billing/billing.service';
import { InvoicesService } from '../billing/invoices.service';
import { PaymentsService } from '../payments/payments.service';
import { PaymentSettlementService } from '../payments/payment-settlement.service';
import { EventBusService } from '../event-bus/event-bus.service';

const url = process.env.PLAN_VERSIONING_INTEGRATION_DATABASE_URL;
(url ? describe : describe.skip)('Plan versioning: isolated PostgreSQL', () => {
  const db = new PrismaClient({
    datasourceUrl: url ?? 'postgresql://unused:unused@127.0.0.1:1/unused',
  });
  const prisma = db as unknown as PrismaService;
  const access = new SubscriptionAccessService(prisma);
  const subscriptions = new SubscriptionsService(
    prisma,
    new ConfigService(),
    access,
    new AuditService(prisma),
  );
  const entitlements = new EntitlementsService(prisma, access);
  const reservations = new ReservationService(prisma, entitlements);
  const billing = new BillingService(prisma, new InvoicesService(prisma));
  let legacyId: string;
  let v2Id: string;
  let premiumId: string;
  const at = new Date();
  const userIds: string[] = [];
  async function user() {
    const id = randomUUID();
    userIds.push(id);
    return db.user.create({
      data: { id, phone: 'synthetic-versioning-' + id },
    });
  }
  async function activateV2() {
    await db.$transaction(async (tx) => {
      await tx.plan.update({
        where: { id: legacyId },
        data: { isCurrentOffer: false },
      });
      await tx.plan.update({
        where: { id: v2Id },
        data: { isCurrentOffer: true },
      });
      await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
    });
  }
  beforeAll(async () => {
    const target = new URL(url!);
    if (
      !['127.0.0.1', 'localhost'].includes(target.hostname) ||
      !target.pathname.includes('versioning')
    )
      throw new Error('Dedicated local versioning database required');
    if (await db.plan.count())
      throw new Error('Versioning proof requires an empty commercial fixture');
    legacyId = (
      await db.plan.create({
        data: {
          type: 'BASIC',
          name: 'Synthetic legacy',
          price: '29.90',
          imageLimit: 5,
          isCurrentOffer: true,
        },
      })
    ).id;
    v2Id = (
      await db.plan.create({
        data: {
          type: 'BASIC',
          contractVersion: 'basic-v2',
          name: 'Synthetic V2',
          price: '29.90',
          imageLimit: 30,
        },
      })
    ).id;
    premiumId = (
      await db.plan.create({
        data: {
          type: 'PREMIUM',
          name: 'Synthetic Premium',
          price: '69.90',
          imageLimit: 150,
          imageUnlimited: true,
          isCurrentOffer: true,
        },
      })
    ).id;
    for (const [code, value] of Object.entries(BASIC_V2_GRANTS)) {
      const definition = await db.entitlementDefinition.upsert({
        where: { code },
        create: { code, name: code },
        update: {},
      });
      await db.planEntitlement.create({
        data: { planId: v2Id, entitlementId: definition.id, value },
      });
      await db.planEntitlement.create({
        data: {
          planId: legacyId,
          entitlementId: definition.id,
          value: code === 'IMAGE_ANALYSIS' ? 5 : 1,
        },
      });
      await db.planEntitlement.create({
        data: {
          planId: premiumId,
          entitlementId: definition.id,
          value: 0,
          unlimited: true,
        },
      });
    }
  });
  beforeEach(async () => {
    await db.$transaction(async (tx) => {
      await tx.plan.update({
        where: { id: v2Id },
        data: { isCurrentOffer: false },
      });
      await tx.plan.update({
        where: { id: legacyId },
        data: { isCurrentOffer: true },
      });
      await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
    });
  });
  afterAll(async () => {
    try {
      await db.$transaction(async (tx) => {
        await tx.subscription.updateMany({
          where: { userId: { in: userIds } },
          data: { activationInvoiceId: null },
        });
        await tx.payment.deleteMany({
          where: { invoice: { subscription: { userId: { in: userIds } } } },
        });
        await tx.invoice.deleteMany({
          where: { subscription: { userId: { in: userIds } } },
        });
        await tx.user.deleteMany({ where: { id: { in: userIds } } });
        const ids = [legacyId, v2Id, premiumId].filter((id): id is string =>
          Boolean(id),
        );
        await tx.plan.deleteMany({ where: { id: { in: ids } } });
        await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
      });
    } finally {
      await db.$disconnect();
    }
  });
  it.each([
    SubscriptionStatus.PENDING_PAYMENT,
    SubscriptionStatus.EXPIRED,
    SubscriptionStatus.ACTIVE,
  ])('preserves the %s historical contract during reentry', async (status) => {
    const owner = await user();
    const existing = await db.subscription.create({
      data: { userId: owner.id, planId: legacyId, amount: '19.90', status },
    });
    await activateV2();
    const replay = await subscriptions.createPendingSubscription(
      owner.id,
      PlanType.BASIC,
    );
    expect(replay.id).toBe(existing.id);
    expect(replay.planId).toBe(legacyId);
    expect(replay.amount.equals('19.90')).toBe(true);
  });
  it('selects V2 for a new customer and serializes concurrent checkout', async () => {
    const owner = await user();
    await activateV2();
    const results = await Promise.all([
      subscriptions.createPendingSubscription(owner.id, PlanType.BASIC, v2Id),
      subscriptions.createPendingSubscription(owner.id, PlanType.BASIC, v2Id),
    ]);
    expect(results[0].id).toBe(results[1].id);
    expect(results[0].planId).toBe(v2Id);
    expect(await db.subscription.count({ where: { userId: owner.id } })).toBe(
      1,
    );
  });
  it('rejects a stale offer identity without creating a contract', async () => {
    const owner = await user();
    await activateV2();
    await expect(
      subscriptions.createPendingSubscription(
        owner.id,
        PlanType.BASIC,
        legacyId,
      ),
    ).rejects.toThrow();
    expect(await db.subscription.count({ where: { userId: owner.id } })).toBe(
      0,
    );
  });
  it('rejects an absent public offer', async () => {
    const owner = await user();
    await db.plan.update({
      where: { id: legacyId },
      data: { isCurrentOffer: false },
    });
    await expect(
      subscriptions.createPendingSubscription(owner.id, PlanType.BASIC),
    ).rejects.toThrow();
  });
  it('enforces a single current offer in PostgreSQL', async () => {
    await expect(
      db.plan.update({ where: { id: v2Id }, data: { isCurrentOffer: true } }),
    ).rejects.toThrow();
  });
  it('rejects incomplete grants and rolls back the offer switch', async () => {
    await expect(
      db.$transaction(async (tx) => {
        await tx.plan.update({
          where: { id: legacyId },
          data: { isCurrentOffer: false },
        });
        await tx.plan.update({
          where: { id: v2Id },
          data: { isCurrentOffer: true },
        });
        await tx.planEntitlement.deleteMany({ where: { planId: v2Id } });
        await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
      }),
    ).rejects.toThrow();
    expect(
      (await db.plan.findUniqueOrThrow({ where: { id: legacyId } }))
        .isCurrentOffer,
    ).toBe(true);
    expect(await db.planEntitlement.count({ where: { planId: v2Id } })).toBe(4);
  });
  it('protects current grants against definition renaming', async () => {
    await activateV2();
    await expect(
      db.$transaction(async (tx) => {
        await tx.entitlementDefinition.update({
          where: { code: 'AUDIO_TRANSCRIPTION' },
          data: { code: 'INVALID_RENAMED_AUDIO' },
        });
        await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
      }),
    ).rejects.toThrow();
  });
  it('uses the contractual price for invoices and reuses the existing invoice', async () => {
    const owner = await user();
    await db.subscription.create({
      data: { userId: owner.id, planId: legacyId, amount: '19.90' },
    });
    await activateV2();
    const first = await billing.getOrCreateInitialInvoice(owner.id);
    const second = await billing.getOrCreateInitialInvoice(owner.id);
    expect(first.invoice.total.equals('19.90')).toBe(true);
    expect(first.invoice.id).toBe(second.invoice.id);
  });
  it('does not charge an active subscriber or change Premium test rights', async () => {
    const owner = await user();
    const before = await db.plan.findUniqueOrThrow({
      where: { id: premiumId },
      include: { entitlements: true },
    });
    await db.subscription.create({
      data: {
        userId: owner.id,
        planId: premiumId,
        amount: 0,
        status: 'ACTIVE',
      },
    });
    await expect(billing.getOrCreateInitialInvoice(owner.id)).rejects.toThrow();
    expect(
      await db.invoice.count({ where: { subscription: { userId: owner.id } } }),
    ).toBe(0);
    expect(
      await db.plan.findUniqueOrThrow({
        where: { id: premiumId },
        include: { entitlements: true },
      }),
    ).toEqual(before);
  });
  it('does not bill an expired contract when another contract is active', async () => {
    const owner = await user();
    await db.subscription.create({
      data: {
        userId: owner.id,
        planId: legacyId,
        amount: '19.90',
        status: 'ACTIVE',
        createdAt: new Date(at.getTime() - 86400000),
      },
    });
    await db.subscription.create({
      data: {
        userId: owner.id,
        planId: v2Id,
        amount: '29.90',
        status: 'EXPIRED',
      },
    });
    await expect(billing.getOrCreateInitialInvoice(owner.id)).rejects.toThrow();
    expect(
      await db.invoice.count({ where: { subscription: { userId: owner.id } } }),
    ).toBe(0);
  });
  it('blocks ambiguous simultaneous live contracts rather than choosing a version', async () => {
    const owner = await user();
    await db.subscription.create({
      data: {
        userId: owner.id,
        planId: legacyId,
        amount: '19.90',
        status: 'ACTIVE',
      },
    });
    await expect(
      db.subscription.create({
        data: {
          userId: owner.id,
          planId: v2Id,
          amount: '29.90',
          status: 'ACTIVE',
        },
      }),
    ).rejects.toThrow();
    expect(
      (await subscriptions.createPendingSubscription(owner.id, PlanType.BASIC))
        .planId,
    ).toBe(legacyId);
    await expect(billing.getOrCreateInitialInvoice(owner.id)).rejects.toThrow();
    expect(
      await db.invoice.count({ where: { subscription: { userId: owner.id } } }),
    ).toBe(0);
  });
  it('blocks implicit upgrade/downgrade of a historical subscription', async () => {
    const owner = await user();
    await db.subscription.create({
      data: { userId: owner.id, planId: legacyId, amount: '19.90' },
    });
    await expect(
      subscriptions.createPendingSubscription(owner.id, PlanType.PREMIUM),
    ).rejects.toThrow();
  });
  it('preserves distinct canonical rights and serializes the last image unit', async () => {
    const owner = await user();
    await activateV2();
    const start = new Date(at.getTime() - 86400000),
      end = new Date(at.getTime() + 86400000);
    await db.subscription.create({
      data: {
        userId: owner.id,
        planId: v2Id,
        amount: '29.90',
        status: 'ACTIVE',
        currentPeriodStart: start,
        currentPeriodEnd: end,
      },
    });
    await db.usageBucket.create({
      data: {
        userId: owner.id,
        entitlementCode: 'IMAGE_ANALYSIS',
        periodStart: start,
        periodEnd: end,
        used: 29,
      },
    });
    const prompt = await db.promptVersion.create({
      data: {
        name: 'synthetic-versioning-' + randomUUID(),
        version: 1,
        prompt: 'Synthetic',
        model: 'VISION',
      },
    });
    const conversation = await db.conversation.create({
      data: { userId: owner.id, phoneNumber: '+5500000000011' },
    });
    const jobs = await Promise.all(
      [0, 1].map(async () => {
        const message = await db.message.create({
          data: {
            conversationId: conversation.id,
            direction: 'INBOUND',
            type: 'IMAGE',
            content: 'Synthetic image',
            timestamp: at,
            externalMessageId: randomUUID(),
            instanceName: 'SYNTHETIC',
          },
        });
        return db.aIJob.create({
          data: {
            userId: owner.id,
            conversationId: conversation.id,
            messageId: message.id,
            type: 'IMAGE',
            operationKey: randomUUID(),
            promptVersionId: prompt.id,
          },
        });
      }),
    );
    const results = await Promise.allSettled(
      jobs.map((job) =>
        reservations.reserveImageAnalysis({
          userId: owner.id,
          aiJobId: job.id,
        }),
      ),
    );
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
    const accepted =
      jobs[results.findIndex((result) => result.status === 'fulfilled')];
    await reservations.reserveImageAnalysis({
      userId: owner.id,
      aiJobId: accepted.id,
    });
    const bucket = await db.usageBucket.findFirstOrThrow({
      where: { userId: owner.id, entitlementCode: 'IMAGE_ANALYSIS' },
    });
    expect(bucket.used).toBe(29);
    expect(bucket.reserved).toBe(1);
    expect(
      (await entitlements.resolveCommercialGrant(owner.id, 'IMAGE_ANALYSIS'))
        .limit,
    ).toBe(30);
  });

  it.each(['PIX', 'CREDIT_CARD'] as const)(
    'settles and renews a historical %s contract after V2 activation without duplication',
    async (method) => {
      const owner = await user();
      const old = await db.subscription.create({
        data: { userId: owner.id, planId: legacyId, amount: '19.90' },
      });
      const initial = await billing.getOrCreateInitialInvoice(owner.id);
      const payments = new PaymentsService(prisma);
      const payment = await payments.create({
        invoiceId: initial.invoice.id,
        provider: 'PAGBANK',
        method,
        amount: '19.90',
        idempotencyKey: randomUUID(),
      });
      await activateV2();
      const settlement = new PaymentSettlementService(
        prisma,
        billing,
        payments,
        new InvoicesService(prisma),
        subscriptions,
        new AuditService(prisma),
        new EventBusService(prisma),
      );
      const canonical = {
        providerOrderId: randomUUID(),
        providerPaymentId: randomUUID(),
        externalReference: payment.externalReference,
        status: 'APPROVED' as const,
        amountInCents: 1990,
        currency: 'BRL',
        approvedAt: new Date(),
      };
      expect(await settlement.settlePagBankPayment(canonical)).toBe('APPROVED');
      expect(await settlement.settlePagBankPayment(canonical)).toBe(
        'ALREADY_PROCESSED',
      );
      const contracted = await db.subscription.findUniqueOrThrow({
        where: { id: old.id },
      });
      expect(contracted.planId).toBe(legacyId);
      expect(contracted.amount.toFixed(2)).toBe('19.90');
      expect(contracted.status).toBe('ACTIVE');
      expect(
        await db.payment.count({ where: { invoiceId: initial.invoice.id } }),
      ).toBe(1);
      expect(
        await db.invoice.count({ where: { subscriptionId: old.id } }),
      ).toBe(1);
      const renewal = await billing.getOrCreatePayableInvoice(owner.id);
      expect(renewal.invoice.cycleNumber).toBe(2);
      expect(renewal.invoice.total.toFixed(2)).toBe('19.90');
      expect(renewal.subscription.planId).toBe(legacyId);
      const other = await user();
      await expect(
        billing.getOrCreateInitialInvoice(other.id),
      ).rejects.toThrow();
      expect(
        await db.invoice.count({
          where: { subscription: { userId: other.id } },
        }),
      ).toBe(0);
    },
  );
  it('blocks generic seeds against existing commercial contracts', async () => {
    await expect(
      db.$transaction((tx: Prisma.TransactionClient) =>
        assertDisposableCommercialSeed(tx, true),
      ),
    ).rejects.toThrow();
  });

  it('requires the presented offer identity for a new BASIC V2 contract', async () => {
    await activateV2();
    const customer = await user();
    await expect(
      subscriptions.createPendingSubscription(customer.id, PlanType.BASIC),
    ).rejects.toThrow('identidade');
    expect(
      await db.subscription.count({ where: { userId: customer.id } }),
    ).toBe(0);
    expect(
      await db.invoice.count({
        where: { subscription: { userId: customer.id } },
      }),
    ).toBe(0);
  });

  it.each(['PENDING_PAYMENT', 'EXPIRED', 'PAST_DUE', 'ACTIVE'] as const)(
    'preserves %s legacy reentry without a new offer identity',
    async (status) => {
      const customer = await user();
      const original = await db.subscription.create({
        data: {
          userId: customer.id,
          planId: legacyId,
          amount: '19.90',
          status,
        },
      });
      await activateV2();
      const replay = await subscriptions.createPendingSubscription(
        customer.id,
        PlanType.BASIC,
      );
      expect(replay.id).toBe(original.id);
      expect(replay.planId).toBe(legacyId);
      expect(replay.amount.toString()).toBe('19.9');
      expect(
        await db.subscription.count({ where: { userId: customer.id } }),
      ).toBe(1);
      expect(
        await db.invoice.count({
          where: { subscription: { userId: customer.id } },
        }),
      ).toBe(0);
    },
  );

  it('rolls back user creation when the new offer identity is missing', async () => {
    await activateV2();
    const email = randomUUID() + '@synthetic.invalid';
    const users = new UsersService(prisma);
    try {
      await expect(
        users.createUserWith(
          { name: 'Synthetic', phone: randomUUID(), email },
          (transaction, userId) =>
            subscriptions.createPendingSubscriptionInTransaction(
              transaction,
              userId,
              PlanType.BASIC,
            ),
        ),
      ).rejects.toThrow('identidade');
      expect(await db.user.findUnique({ where: { email } })).toBeNull();
    } finally {
      const leaked = await db.user.findUnique({ where: { email } });
      if (leaked) userIds.push(leaked.id);
    }
  });
  it('keeps legacy registration compatible before V2 activation', async () => {
    const customer = await user();
    const contract = await subscriptions.createPendingSubscription(
      customer.id,
      PlanType.BASIC,
    );
    expect(contract.planId).toBe(legacyId);
    expect(contract.amount.equals('29.90')).toBe(true);
  });
});
