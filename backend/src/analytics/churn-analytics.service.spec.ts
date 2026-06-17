import { PlanType, Prisma } from '@prisma/client';
import { AnalyticsDateService } from './analytics-date.service';
import { ChurnAnalyticsService } from './churn-analytics.service';
import { RevenueMetricsService } from './revenue-metrics.service';

describe('ChurnAnalyticsService', () => {
  it('calculates user and revenue churn without treating active users as churn', () => {
    const dates = new AnalyticsDateService();
    const revenue = new RevenueMetricsService(dates);
    const service = new ChurnAnalyticsService(dates, revenue);
    const subscriptions = [
      {
        id: 'churned',
        userId: 'churned-user',
        amount: new Prisma.Decimal(100),
        startedAt: new Date('2026-01-01T00:00:00.000Z'),
        canceledAt: new Date('2026-06-05T00:00:00.000Z'),
        endedAt: new Date('2026-06-05T00:00:00.000Z'),
        cancelAtPeriodEnd: false,
        currentPeriodEnd: null,
        billingPeriodEnd: null,
        plan: {
          type: PlanType.PREMIUM,
          billingIntervalCount: 1,
        },
      },
      {
        id: 'retained',
        userId: 'retained-user',
        amount: new Prisma.Decimal(100),
        startedAt: new Date('2026-01-01T00:00:00.000Z'),
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

    const result = service.calculateWindow(
      subscriptions,
      new Date('2026-06-13T00:00:00.000Z'),
      30,
    );

    expect(result.startingUsers).toBe(2);
    expect(result.churnedUsers).toBe(1);
    expect(result.userChurnRate.toString()).toBe('50');
    expect(result.revenueChurnRate.toString()).toBe('50');
  });
});
