import { PlanType, Prisma } from '@prisma/client';
import { AnalyticsDateService } from './analytics-date.service';
import { PlanPerformanceService } from './plan-performance.service';
import { RevenueMetricsService } from './revenue-metrics.service';

describe('PlanPerformanceService', () => {
  it('compares BASIC and PREMIUM revenue, retention, churn and usage', async () => {
    const dates = new AnalyticsDateService();
    const revenue = new RevenueMetricsService(dates);
    const service = new PlanPerformanceService(dates, revenue);
    const subscriptions = [
      {
        id: 'basic-sub',
        userId: 'basic-user',
        amount: new Prisma.Decimal(50),
        startedAt: new Date('2026-05-01T00:00:00.000Z'),
        canceledAt: null,
        endedAt: null,
        cancelAtPeriodEnd: false,
        currentPeriodEnd: null,
        billingPeriodEnd: null,
        plan: {
          type: PlanType.BASIC,
          billingIntervalCount: 1,
        },
      },
      {
        id: 'premium-sub',
        userId: 'premium-user',
        amount: new Prisma.Decimal(100),
        startedAt: new Date('2026-05-01T00:00:00.000Z'),
        canceledAt: null,
        endedAt: null,
        cancelAtPeriodEnd: false,
        currentPeriodEnd: null,
        billingPeriodEnd: null,
        plan: {
          type: PlanType.PREMIUM,
          billingIntervalCount: 1,
        },
      },
    ];
    const client = {
      subscription: {
        findMany: jest.fn().mockResolvedValue(subscriptions),
      },
      message: {
        findMany: jest.fn().mockResolvedValue([
          {
            conversation: {
              userId: 'basic-user',
            },
          },
        ]),
      },
      meal: {
        findMany: jest.fn().mockResolvedValue([
          {
            userId: 'premium-user',
          },
        ]),
      },
    };
    const costs = subscriptions.map((subscription, index) => ({
      userId: subscription.userId,
      aiInputTokens: 50,
      aiOutputTokens: 50,
      aiTotalTokens: 100,
      aiCostUsd: new Prisma.Decimal(1),
      aiCostBrl: new Prisma.Decimal(index + 1),
      whatsappSent: 2,
      whatsappReceived: 3,
      whatsappCostBrl: new Prisma.Decimal(1),
      storageImages: 0,
      storageUploads: 0,
      storageTotalBytes: 0n,
      storageCostBrl: new Prisma.Decimal(0),
    }));
    const profitability = subscriptions.map((subscription) => ({
      userId: subscription.userId,
      planType: subscription.plan.type,
      monthlyRevenue: subscription.amount,
      aiCost: new Prisma.Decimal(1),
      whatsappCost: new Prisma.Decimal(1),
      storageCost: new Prisma.Decimal(0),
      estimatedProfit: subscription.amount.sub(2),
      marginPercent: new Prisma.Decimal(90),
    }));

    const result = await service.calculate(
      new Date('2026-06-13T00:00:00.000Z'),
      subscriptions,
      costs,
      profitability,
      client as never,
    );

    expect(result).toEqual([
      expect.objectContaining({
        planType: PlanType.BASIC,
        payingUsers: 1,
        aiTokens: 100,
        whatsappMessages: 5,
      }),
      expect.objectContaining({
        planType: PlanType.PREMIUM,
        payingUsers: 1,
        aiTokens: 100,
        whatsappMessages: 5,
      }),
    ]);
    expect(result[0]?.retentionRate.toString()).toBe('100');
    expect(result[1]?.retentionRate.toString()).toBe('100');
    expect(result[0]?.churnRate.toString()).toBe('0');
  });
});
