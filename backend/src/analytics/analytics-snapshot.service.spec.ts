import { PlanType, Prisma } from '@prisma/client';
import { EventService } from '../observability/event.service';
import { PrismaService } from '../prisma/prisma.service';
import { AnalyticsDateService } from './analytics-date.service';
import { AnalyticsSnapshotService } from './analytics-snapshot.service';
import { ChurnAnalyticsService } from './churn-analytics.service';
import { CostAnalyticsService } from './cost-analytics.service';
import { GrowthAnalyticsService } from './growth-analytics.service';
import { PlanPerformanceService } from './plan-performance.service';
import { RetentionAnalyticsService } from './retention-analytics.service';
import { RevenueMetricsService } from './revenue-metrics.service';
import { UserProfitabilityService } from './user-profitability.service';

describe('AnalyticsSnapshotService', () => {
  it('persists a daily snapshot and all observability events atomically', async () => {
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([{ locked: true }]),
      revenueSnapshot: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
      },
      churnSnapshot: {
        create: jest.fn(),
      },
      retentionSnapshot: {
        create: jest.fn(),
      },
      costSnapshot: {
        create: jest.fn(),
      },
      whatsAppCostSnapshot: {
        createMany: jest.fn(),
      },
      storageCostSnapshot: {
        createMany: jest.fn(),
      },
      userProfitabilitySnapshot: {
        createMany: jest.fn(),
      },
      planPerformanceSnapshot: {
        createMany: jest.fn(),
      },
      growthSnapshot: {
        create: jest.fn(),
      },
      systemEvent: {
        create: jest.fn().mockResolvedValue({ id: 'event-id' }),
      },
    };
    const prisma = {
      revenueSnapshot: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      $transaction: jest.fn(
        (operation: (client: typeof transaction) => unknown) =>
          operation(transaction),
      ),
    };
    const subscription = {
      id: 'subscription-id',
      userId: 'user-id',
      amount: new Prisma.Decimal(100),
      startedAt: new Date(),
      canceledAt: null,
      endedAt: null,
      cancelAtPeriodEnd: false,
      currentPeriodEnd: null,
      billingPeriodEnd: null,
      plan: {
        type: PlanType.PREMIUM,
        billingIntervalCount: 1,
      },
    };
    const revenue = {
      calculate: jest.fn().mockResolvedValue({
        mrr: new Prisma.Decimal(100),
        arr: new Prisma.Decimal(1200),
        arpu: new Prisma.Decimal(100),
        recognizedRevenue: new Prisma.Decimal(100),
        payingUsers: 1,
        activeSubscriptions: 1,
        premiumUsers: 1,
        basicUsers: 0,
        subscriptions: [subscription],
      }),
    };
    const churn = {
      calculate: jest.fn().mockResolvedValue({
        monthly: {
          startingUsers: 1,
          churnedUsers: 0,
          userChurnRate: new Prisma.Decimal(0),
          startingMrr: new Prisma.Decimal(100),
          churnedMrr: new Prisma.Decimal(0),
          revenueChurnRate: new Prisma.Decimal(0),
        },
        quarterly: {
          startingUsers: 1,
          churnedUsers: 0,
          userChurnRate: new Prisma.Decimal(0),
          startingMrr: new Prisma.Decimal(100),
          churnedMrr: new Prisma.Decimal(0),
          revenueChurnRate: new Prisma.Decimal(0),
        },
      }),
    };
    const retention = {
      calculate: jest.fn().mockResolvedValue({
        d1: { cohortSize: 1, retained: 1, rate: new Prisma.Decimal(100) },
        d7: { cohortSize: 1, retained: 1, rate: new Prisma.Decimal(100) },
        d30: { cohortSize: 1, retained: 1, rate: new Prisma.Decimal(100) },
        retentionRate: new Prisma.Decimal(100),
      }),
    };
    const costs = {
      calculateDaily: jest.fn().mockResolvedValue({
        users: [],
        whatsappRows: [],
        storageRows: [],
        aiByProvider: {},
        aiByModel: {},
        totals: {
          aiInputTokens: 0,
          aiOutputTokens: 0,
          aiTotalTokens: 0,
          aiCostUsd: new Prisma.Decimal(0),
          aiCostBrl: new Prisma.Decimal(0),
          whatsappSent: 0,
          whatsappReceived: 0,
          whatsappCostBrl: new Prisma.Decimal(0),
          storageImages: 0,
          storageUploads: 0,
          storageTotalBytes: 0n,
          storageCostBrl: new Prisma.Decimal(0),
        },
      }),
      calculateMonthlyByUser: jest.fn().mockResolvedValue({
        users: [],
      }),
    };
    const profitabilityMetric = {
      userId: 'user-id',
      planType: PlanType.PREMIUM,
      monthlyRevenue: new Prisma.Decimal(100),
      aiCost: new Prisma.Decimal(0),
      whatsappCost: new Prisma.Decimal(0),
      storageCost: new Prisma.Decimal(0),
      estimatedProfit: new Prisma.Decimal(100),
      marginPercent: new Prisma.Decimal(100),
    };
    const profitability = {
      calculate: jest.fn().mockReturnValue([profitabilityMetric]),
    };
    const plans = {
      calculate: jest.fn().mockResolvedValue([
        {
          planType: PlanType.BASIC,
          payingUsers: 0,
          retentionRate: new Prisma.Decimal(0),
          churnRate: new Prisma.Decimal(0),
          monthlyRevenue: new Prisma.Decimal(0),
          estimatedProfit: new Prisma.Decimal(0),
          marginPercent: new Prisma.Decimal(0),
          aiTokens: 0,
          aiCost: new Prisma.Decimal(0),
          whatsappMessages: 0,
          whatsappCost: new Prisma.Decimal(0),
        },
        {
          ...profitabilityMetric,
          payingUsers: 1,
          retentionRate: new Prisma.Decimal(100),
          churnRate: new Prisma.Decimal(0),
          aiTokens: 0,
          whatsappMessages: 0,
        },
      ]),
    };
    const growth = {
      calculate: jest.fn().mockResolvedValue({
        newUsers: 1,
        newUsersMonthly: 1,
        newUsersQuarterly: 1,
        activeUsers: 1,
        payingUsers: 1,
        monthlyGrowthRate: new Prisma.Decimal(100),
        quarterlyGrowthRate: new Prisma.Decimal(100),
      }),
    };
    const service = new AnalyticsSnapshotService(
      prisma as unknown as PrismaService,
      new AnalyticsDateService(),
      revenue as unknown as RevenueMetricsService,
      churn as unknown as ChurnAnalyticsService,
      retention as unknown as RetentionAnalyticsService,
      costs as unknown as CostAnalyticsService,
      profitability as unknown as UserProfitabilityService,
      plans as unknown as PlanPerformanceService,
      growth as unknown as GrowthAnalyticsService,
      new EventService({} as PrismaService),
    );

    await expect(
      service.ensureDaily(new Date('2026-06-13T00:00:00.000Z')),
    ).resolves.toEqual({
      snapshotDate: new Date('2026-06-13T00:00:00.000Z'),
      generated: true,
    });
    expect(transaction.revenueSnapshot.create).toHaveBeenCalled();
    expect(transaction.userProfitabilitySnapshot.createMany).toHaveBeenCalled();
    expect(transaction.planPerformanceSnapshot.createMany).toHaveBeenCalled();
    expect(transaction.systemEvent.create).toHaveBeenCalledTimes(5);
  });
});
