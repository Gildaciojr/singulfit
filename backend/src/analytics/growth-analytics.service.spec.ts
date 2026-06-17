import { AnalyticsDateService } from './analytics-date.service';
import { GrowthAnalyticsService } from './growth-analytics.service';

describe('GrowthAnalyticsService', () => {
  it('calculates acquisition growth and distinct active users', async () => {
    const client = {
      user: {
        count: jest
          .fn()
          .mockResolvedValueOnce(2)
          .mockResolvedValueOnce(10)
          .mockResolvedValueOnce(5)
          .mockResolvedValueOnce(20)
          .mockResolvedValueOnce(10),
      },
      message: {
        findMany: jest.fn().mockResolvedValue([
          {
            conversation: {
              userId: 'active-a',
            },
          },
        ]),
      },
      meal: {
        findMany: jest.fn().mockResolvedValue([
          {
            userId: 'active-b',
          },
        ]),
      },
    };
    const service = new GrowthAnalyticsService(new AnalyticsDateService());

    const result = await service.calculate(
      new Date('2026-06-13T00:00:00.000Z'),
      8,
      client as never,
    );

    expect(result).toEqual(
      expect.objectContaining({
        newUsers: 2,
        newUsersMonthly: 10,
        newUsersQuarterly: 20,
        activeUsers: 2,
        payingUsers: 8,
      }),
    );
    expect(result.monthlyGrowthRate.toString()).toBe('100');
    expect(result.quarterlyGrowthRate.toString()).toBe('100');
  });
});
