import {
  AIJobType,
  BillingInterval,
  Currency,
  PlanType,
  Prisma,
  PrismaClient,
  SubscriptionStatus,
  UsageEventStatus,
} from '@prisma/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  IMAGE_ANALYSIS,
  NUTRITION_PLAN_GENERATION,
  WORKOUT_PLAN_GENERATION,
} from './entitlement.constants';

const databaseUrl =
  process.env.COMMERCIAL_ENTITLEMENT_CLEANUP_INTEGRATION_DATABASE_URL;
const safeDatabaseUrl =
  databaseUrl ?? 'postgresql://disabled:disabled@127.0.0.1:1/disabled';
const describeIntegration = databaseUrl ? describe : describe.skip;
const integrationMode =
  process.env.COMMERCIAL_ENTITLEMENT_CLEANUP_INTEGRATION_MODE ?? 'EXECUTE';
const commercialCodes = [
  NUTRITION_PLAN_GENERATION,
  WORKOUT_PLAN_GENERATION,
  IMAGE_ANALYSIS,
] as const;
const cleanupMigrationSql = readFileSync(
  join(
    __dirname,
    '../../prisma/migrations/20260902213000_cleanup_unlimited_commercial_usage/migration.sql',
  ),
  'utf8',
);
const cleanupMigrationStatements = cleanupMigrationSql
  .split(';')
  .map((statement) => statement.trim())
  .filter((statement) => statement.length > 0);

describeIntegration('Unlimited commercial backfill cleanup integration', () => {
  const prisma = new PrismaClient({
    datasources: { db: { url: safeDatabaseUrl } },
  });
  const basicUserId = 'commercial-cleanup-basic-user';
  const premiumUserId = 'commercial-cleanup-premium-user';
  const transitionedUserId = 'commercial-cleanup-transitioned-user';
  const userIds = [basicUserId, premiumUserId, transitionedUserId];
  const basicPeriodStart = new Date('2026-07-17T15:00:00.000Z');
  const basicPeriodEnd = new Date('2026-08-17T15:00:00.000Z');
  const premiumPeriodStart = new Date('2026-08-17T15:00:00.000Z');
  const premiumPeriodEnd = new Date('2026-09-17T15:00:00.000Z');
  const basicOccurredAt = new Date('2026-08-01T12:00:00.000Z');
  const premiumOccurredAt = new Date('2026-09-01T12:00:00.000Z');
  let basicPlanId: string;
  let premiumPlanId: string;
  let promptVersionId: string;

  beforeAll(async () => {
    await prisma.$connect();
    const [basic, premium] = await Promise.all([
      upsertPlan(PlanType.BASIC, '29.90', false),
      upsertPlan(PlanType.PREMIUM, '69.90', true),
    ]);
    basicPlanId = basic.id;
    premiumPlanId = premium.id;
    const entitlements = await prisma.entitlementDefinition.findMany({
      where: { code: { in: [...commercialCodes] } },
    });
    for (const entitlement of entitlements) {
      await Promise.all([
        upsertPlanEntitlement(
          basic.id,
          entitlement.id,
          entitlement.code === IMAGE_ANALYSIS ? 5 : 1,
          false,
        ),
        upsertPlanEntitlement(premium.id, entitlement.id, 0, true),
      ]);
    }
    const prompt = await prisma.promptVersion.upsert({
      where: { name_version: { name: 'commercial-cleanup-test', version: 1 } },
      update: {},
      create: {
        name: 'commercial-cleanup-test',
        version: 1,
        prompt: 'integration',
      },
    });
    promptVersionId = prompt.id;
  });

  beforeEach(async () => {
    if (integrationMode !== 'VERIFY') {
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
  });

  afterAll(async () => {
    if (integrationMode !== 'PREPARE') {
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await prisma.$disconnect();
  });

  it('removes only exact unlimited cycles and preserves legitimate BASIC history', async () => {
    if (integrationMode === 'VERIFY') {
      await expectPostCleanupState();
      return;
    }

    await Promise.all(
      userIds.map((id) => prisma.user.create({ data: { id, phone: id } })),
    );
    await Promise.all([
      createSubscription(
        basicUserId,
        basicPlanId,
        basicPeriodStart,
        basicPeriodEnd,
        SubscriptionStatus.ACTIVE,
      ),
      createSubscription(
        premiumUserId,
        premiumPlanId,
        premiumPeriodStart,
        premiumPeriodEnd,
        SubscriptionStatus.ACTIVE,
      ),
      createSubscription(
        transitionedUserId,
        basicPlanId,
        basicPeriodStart,
        basicPeriodEnd,
        SubscriptionStatus.CANCELED,
      ),
      createSubscription(
        transitionedUserId,
        premiumPlanId,
        premiumPeriodStart,
        premiumPeriodEnd,
        SubscriptionStatus.ACTIVE,
      ),
    ]);
    await Promise.all([
      seedBackfilledUsage(
        basicUserId,
        basicPeriodStart,
        basicPeriodEnd,
        basicOccurredAt,
      ),
      seedBackfilledUsage(
        premiumUserId,
        premiumPeriodStart,
        premiumPeriodEnd,
        premiumOccurredAt,
      ),
      seedBackfilledUsage(
        transitionedUserId,
        basicPeriodStart,
        basicPeriodEnd,
        basicOccurredAt,
      ),
      seedBackfilledUsage(
        transitionedUserId,
        premiumPeriodStart,
        premiumPeriodEnd,
        premiumOccurredAt,
      ),
    ]);

    if (integrationMode === 'PREPARE') {
      await expect(commercialCounts(basicUserId)).resolves.toEqual({
        buckets: 3,
        events: 3,
      });
      await expect(commercialCounts(premiumUserId)).resolves.toEqual({
        buckets: 3,
        events: 3,
      });
      await expect(commercialCounts(transitionedUserId)).resolves.toEqual({
        buckets: 6,
        events: 6,
      });
      return;
    }

    await prisma.$transaction(
      cleanupMigrationStatements.map((statement) =>
        prisma.$executeRawUnsafe(statement),
      ),
    );

    await expectPostCleanupState();
  });

  async function expectPostCleanupState() {
    await expect(commercialCounts(basicUserId)).resolves.toEqual({
      buckets: 3,
      events: 3,
    });
    await expect(commercialCounts(premiumUserId)).resolves.toEqual({
      buckets: 0,
      events: 0,
    });
    await expect(
      commercialCounts(transitionedUserId, basicPeriodStart, basicPeriodEnd),
    ).resolves.toEqual({ buckets: 3, events: 3 });
    await expect(
      commercialCounts(
        transitionedUserId,
        premiumPeriodStart,
        premiumPeriodEnd,
      ),
    ).resolves.toEqual({ buckets: 0, events: 0 });
  }

  function upsertPlan(type: PlanType, price: string, imageUnlimited: boolean) {
    return prisma.plan.upsert({
      where: { type },
      update: {},
      create: {
        type,
        name: `${type} cleanup integration`,
        price: new Prisma.Decimal(price),
        currency: Currency.BRL,
        billingInterval: BillingInterval.MONTH,
        billingIntervalCount: 1,
        imageLimit: imageUnlimited ? 0 : 5,
        imageUnlimited,
      },
    });
  }

  function createSubscription(
    userId: string,
    planId: string,
    currentPeriodStart: Date,
    currentPeriodEnd: Date,
    status: SubscriptionStatus,
  ) {
    return prisma.subscription.create({
      data: {
        userId,
        planId,
        status,
        amount: new Prisma.Decimal(
          planId === premiumPlanId ? '69.90' : '29.90',
        ),
        currentPeriodStart,
        currentPeriodEnd,
      },
    });
  }

  function upsertPlanEntitlement(
    planId: string,
    entitlementId: string,
    value: number,
    unlimited: boolean,
  ) {
    return prisma.planEntitlement.upsert({
      where: { planId_entitlementId: { planId, entitlementId } },
      update: { value, unlimited },
      create: { planId, entitlementId, value, unlimited },
    });
  }

  async function seedBackfilledUsage(
    userId: string,
    periodStart: Date,
    periodEnd: Date,
    occurredAt: Date,
  ) {
    for (const entitlementCode of commercialCodes) {
      const aiJob = await prisma.aIJob.create({
        data: {
          userId,
          type: AIJobType.WORKOUT,
          promptVersionId,
          status: 'COMPLETED',
          startedAt: occurredAt,
          completedAt: occurredAt,
        },
      });
      await prisma.usageBucket.create({
        data: {
          userId,
          entitlementCode,
          periodStart,
          periodEnd,
          used: entitlementCode === IMAGE_ANALYSIS ? 5 : 1,
        },
      });
      await prisma.usageEvent.create({
        data: {
          userId,
          aiJobId: aiJob.id,
          entitlementCode,
          quantity: 1,
          status: UsageEventStatus.CONFIRMED,
          createdAt: occurredAt,
        },
      });
    }
  }

  async function commercialCounts(
    userId: string,
    periodStart?: Date,
    periodEnd?: Date,
  ) {
    const periodFilter =
      periodStart && periodEnd ? { periodStart, periodEnd } : undefined;
    const eventTimeFilter =
      periodStart && periodEnd
        ? { createdAt: { gte: periodStart, lt: periodEnd } }
        : undefined;
    const [buckets, events] = await Promise.all([
      prisma.usageBucket.count({
        where: {
          userId,
          entitlementCode: { in: [...commercialCodes] },
          ...periodFilter,
        },
      }),
      prisma.usageEvent.count({
        where: {
          userId,
          entitlementCode: { in: [...commercialCodes] },
          ...eventTimeFilter,
        },
      }),
    ]);
    return { buckets, events };
  }
});
