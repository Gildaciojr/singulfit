import {
  AIJobType,
  BillingInterval,
  Currency,
  PlanType,
  Prisma,
  PrismaClient,
  SubscriptionStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionAccessService } from '../subscriptions/subscription-access.service';
import {
  IMAGE_ANALYSIS,
  NUTRITION_PLAN_GENERATION,
  WORKOUT_PLAN_GENERATION,
} from './entitlement.constants';
import { EntitlementsService } from './entitlements.service';
import { ReservationService } from './reservation.service';
import { UsageLimitExceededException } from './usage-limit.exception';

const databaseUrl =
  process.env.COMMERCIAL_ENTITLEMENTS_INTEGRATION_DATABASE_URL;
const safeDatabaseUrl =
  databaseUrl ?? 'postgresql://disabled:disabled@127.0.0.1:1/disabled';
const describeIntegration = databaseUrl ? describe : describe.skip;

describeIntegration('Commercial entitlement reservation integration', () => {
  const prisma = new PrismaClient({
    datasources: { db: { url: safeDatabaseUrl } },
  });
  const access = new SubscriptionAccessService(
    prisma as unknown as PrismaService,
  );
  const entitlements = new EntitlementsService(
    prisma as unknown as PrismaService,
    access,
  );
  const reservations = new ReservationService(
    prisma as unknown as PrismaService,
    entitlements,
  );
  const at = new Date('2026-09-02T12:00:00.000Z');
  const firstPeriodStart = new Date('2026-08-17T15:00:00.000Z');
  const firstPeriodEnd = new Date('2026-09-17T15:00:00.000Z');
  const userIds = [
    'commercial-concurrency-user',
    'commercial-exhausted-user',
    'commercial-isolated-user',
    'commercial-premium-user',
  ] as const;
  let basicPlanId: string;
  let premiumPlanId: string;
  let promptVersionId: string;

  beforeAll(async () => {
    await prisma.$connect();
    const commercialEntitlements = await prisma.entitlementDefinition.findMany({
      where: {
        code: {
          in: [
            NUTRITION_PLAN_GENERATION,
            WORKOUT_PLAN_GENERATION,
            IMAGE_ANALYSIS,
          ],
        },
      },
    });
    const basic = await prisma.plan.upsert({
      where: { type: PlanType.BASIC },
      update: {},
      create: {
        type: PlanType.BASIC,
        name: 'Basic integration',
        price: new Prisma.Decimal('29.90'),
        currency: Currency.BRL,
        billingInterval: BillingInterval.MONTH,
        billingIntervalCount: 1,
        imageLimit: 5,
      },
    });
    const premium = await prisma.plan.upsert({
      where: { type: PlanType.PREMIUM },
      update: {},
      create: {
        type: PlanType.PREMIUM,
        name: 'Premium integration',
        price: new Prisma.Decimal('69.90'),
        currency: Currency.BRL,
        billingInterval: BillingInterval.MONTH,
        billingIntervalCount: 1,
        imageLimit: 0,
        imageUnlimited: true,
      },
    });
    basicPlanId = basic.id;
    premiumPlanId = premium.id;
    for (const entitlement of commercialEntitlements) {
      await prisma.planEntitlement.upsert({
        where: {
          planId_entitlementId: {
            planId: basic.id,
            entitlementId: entitlement.id,
          },
        },
        update: {
          value: entitlement.code === IMAGE_ANALYSIS ? 5 : 1,
          unlimited: false,
        },
        create: {
          planId: basic.id,
          entitlementId: entitlement.id,
          value: entitlement.code === IMAGE_ANALYSIS ? 5 : 1,
        },
      });
      await prisma.planEntitlement.upsert({
        where: {
          planId_entitlementId: {
            planId: premium.id,
            entitlementId: entitlement.id,
          },
        },
        update: { value: 0, unlimited: true },
        create: {
          planId: premium.id,
          entitlementId: entitlement.id,
          value: 0,
          unlimited: true,
        },
      });
    }
    const prompt = await prisma.promptVersion.upsert({
      where: { name_version: { name: 'commercial-test', version: 1 } },
      update: {},
      create: { name: 'commercial-test', version: 1, prompt: 'test' },
    });
    promptVersionId = prompt.id;
  });

  beforeEach(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [...userIds] } } });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [...userIds] } } });
    await prisma.$disconnect();
  });

  it('serializes the last slot, keeps retries idempotent and resets only on the next persisted cycle', async () => {
    const userId = userIds[0];
    await createSubscriber(userId, basicPlanId);
    await prisma.usageBucket.create({
      data: {
        userId,
        entitlementCode: IMAGE_ANALYSIS,
        periodStart: firstPeriodStart,
        periodEnd: firstPeriodEnd,
        used: 4,
      },
    });
    const [firstJob, secondJob] = await Promise.all([
      createJob(userId),
      createJob(userId),
    ]);
    const outcomes = await Promise.allSettled([
      reserve(userId, firstJob.id),
      reserve(userId, secondJob.id),
    ]);

    expect(
      outcomes.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    const rejected = outcomes.find((result) => result.status === 'rejected');
    expect(rejected).toMatchObject({
      status: 'rejected',
      reason: expect.any(UsageLimitExceededException),
    });
    const event = await prisma.usageEvent.findFirstOrThrow({
      where: { userId },
    });
    await Promise.all([
      reserve(userId, event.aiJobId),
      reserve(userId, event.aiJobId),
    ]);
    await expect(
      prisma.usageBucket.findUniqueOrThrow({
        where: {
          userId_entitlementCode_periodStart_periodEnd: {
            userId,
            entitlementCode: IMAGE_ANALYSIS,
            periodStart: firstPeriodStart,
            periodEnd: firstPeriodEnd,
          },
        },
      }),
    ).resolves.toMatchObject({ used: 4, reserved: 1 });

    const nextPeriodStart = firstPeriodEnd;
    const nextPeriodEnd = new Date('2026-10-17T15:00:00.000Z');
    await prisma.subscription.updateMany({
      where: { userId },
      data: {
        currentPeriodStart: nextPeriodStart,
        currentPeriodEnd: nextPeriodEnd,
      },
    });
    const nextJob = await createJob(userId);
    await expect(
      reserve(userId, nextJob.id, new Date('2026-09-18T12:00:00.000Z')),
    ).resolves.toHaveLength(1);
  });

  it('isolates exhausted BASIC usage by user and keeps PREMIUM explicitly counter-free', async () => {
    const exhaustedUser = userIds[1];
    const isolatedUser = userIds[2];
    const premiumUser = userIds[3];
    await Promise.all([
      createSubscriber(exhaustedUser, basicPlanId),
      createSubscriber(isolatedUser, basicPlanId),
      createSubscriber(premiumUser, premiumPlanId),
    ]);
    await prisma.usageBucket.create({
      data: {
        userId: exhaustedUser,
        entitlementCode: IMAGE_ANALYSIS,
        periodStart: firstPeriodStart,
        periodEnd: firstPeriodEnd,
        used: 5,
      },
    });
    const [exhaustedJob, isolatedJob] = await Promise.all([
      createJob(exhaustedUser),
      createJob(isolatedUser),
    ]);
    const [exhausted, isolated] = await Promise.allSettled([
      reserve(exhaustedUser, exhaustedJob.id),
      reserve(isolatedUser, isolatedJob.id),
    ]);
    expect(exhausted).toMatchObject({ status: 'rejected' });
    expect(isolated).toMatchObject({ status: 'fulfilled' });

    for (const entitlementCode of [
      NUTRITION_PLAN_GENERATION,
      WORKOUT_PLAN_GENERATION,
      IMAGE_ANALYSIS,
    ]) {
      const premiumJobs = await Promise.all(
        Array.from({ length: 6 }, () => createJob(premiumUser)),
      );
      for (const job of premiumJobs) {
        await expect(
          reserve(premiumUser, job.id, at, entitlementCode),
        ).resolves.toEqual([]);
      }
    }
    await expect(
      prisma.usageEvent.count({ where: { userId: premiumUser } }),
    ).resolves.toBe(0);
    await expect(
      prisma.usageBucket.count({ where: { userId: premiumUser } }),
    ).resolves.toBe(0);
  });

  async function createSubscriber(userId: string, planId: string) {
    await prisma.user.create({ data: { id: userId, phone: userId } });
    await prisma.subscription.create({
      data: {
        userId,
        planId,
        status: SubscriptionStatus.ACTIVE,
        amount: new Prisma.Decimal('29.90'),
        currentPeriodStart: firstPeriodStart,
        currentPeriodEnd: firstPeriodEnd,
      },
    });
  }

  function createJob(userId: string) {
    return prisma.aIJob.create({
      data: { userId, type: AIJobType.WORKOUT, promptVersionId },
    });
  }

  function reserve(
    userId: string,
    aiJobId: string,
    referenceDate = at,
    entitlementCode = IMAGE_ANALYSIS,
  ) {
    return reservations.reserveCommercialUsage({
      userId,
      aiJobId,
      entitlementCode,
      at: referenceDate,
    });
  }
});
