import { PlanType, Prisma } from '@prisma/client';
import { AnalyticsDateService } from './analytics-date.service';
import { RevenueMetricsService } from './revenue-metrics.service';
import { UserProfitabilityService } from './user-profitability.service';

describe('UserProfitabilityService', () => {
  it('subtracts operational costs from monthly user revenue', () => {
    const service = new UserProfitabilityService(
      new RevenueMetricsService(new AnalyticsDateService()),
    );
    const result = service.calculate(
      [
        {
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
        },
      ],
      [
        {
          userId: 'user-id',
          aiInputTokens: 0,
          aiOutputTokens: 0,
          aiTotalTokens: 0,
          aiCostUsd: new Prisma.Decimal(1),
          aiCostBrl: new Prisma.Decimal(5),
          whatsappSent: 0,
          whatsappReceived: 0,
          whatsappCostBrl: new Prisma.Decimal(10),
          storageImages: 0,
          storageUploads: 0,
          storageTotalBytes: 0n,
          storageCostBrl: new Prisma.Decimal(5),
        },
      ],
    );

    expect(result[0]?.estimatedProfit.toString()).toBe('80');
    expect(result[0]?.marginPercent.toString()).toBe('80');
  });
});
