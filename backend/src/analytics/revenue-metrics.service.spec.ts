import { PlanType, Prisma } from '@prisma/client';
import { AnalyticsDateService } from './analytics-date.service';
import { RevenueMetricsService } from './revenue-metrics.service';

describe('RevenueMetricsService', () => {
  it('calculates MRR, ARR, ARPU and users by plan', async () => {
    const service = new RevenueMetricsService(new AnalyticsDateService());
    const client = {
      subscription: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'basic-subscription',
            userId: 'basic-user',
            amount: new Prisma.Decimal(49),
            startedAt: new Date('2026-05-01T00:00:00.000Z'),
            canceledAt: null,
            endedAt: null,
            cancelAtPeriodEnd: false,
            currentPeriodEnd: new Date('2026-07-01T00:00:00.000Z'),
            billingPeriodEnd: new Date('2026-07-01T00:00:00.000Z'),
            plan: {
              type: PlanType.BASIC,
              billingIntervalCount: 1,
            },
          },
          {
            id: 'premium-subscription',
            userId: 'premium-user',
            amount: new Prisma.Decimal(297),
            startedAt: new Date('2026-05-01T00:00:00.000Z'),
            canceledAt: null,
            endedAt: null,
            cancelAtPeriodEnd: false,
            currentPeriodEnd: new Date('2026-08-01T00:00:00.000Z'),
            billingPeriodEnd: new Date('2026-08-01T00:00:00.000Z'),
            plan: {
              type: PlanType.PREMIUM,
              billingIntervalCount: 3,
            },
          },
        ]),
      },
      invoice: {
        aggregate: jest.fn().mockResolvedValue({
          _sum: {
            total: new Prisma.Decimal(148),
          },
        }),
      },
    };

    const result = await service.calculate(
      new Date('2026-06-13T00:00:00.000Z'),
      client as never,
    );

    expect(result.mrr.toString()).toBe('148');
    expect(result.arr.toString()).toBe('1776');
    expect(result.arpu.toString()).toBe('74');
    expect(result.recognizedRevenue.toString()).toBe('148');
    expect(result).toEqual(
      expect.objectContaining({
        payingUsers: 2,
        activeSubscriptions: 2,
        basicUsers: 1,
        premiumUsers: 1,
      }),
    );
  });
});
