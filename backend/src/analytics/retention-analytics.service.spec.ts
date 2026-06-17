import { AnalyticsDateService } from './analytics-date.service';
import { RetentionAnalyticsService } from './retention-analytics.service';

describe('RetentionAnalyticsService', () => {
  it('calculates D1, D7, D30 and weighted retention', async () => {
    const client = {
      user: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([{ id: 'd1-a' }, { id: 'd1-b' }])
          .mockResolvedValueOnce([{ id: 'd7-a' }])
          .mockResolvedValueOnce([]),
      },
      message: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([{ conversation: { userId: 'd1-a' } }])
          .mockResolvedValueOnce([{ conversation: { userId: 'd7-a' } }]),
      },
      meal: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const service = new RetentionAnalyticsService(new AnalyticsDateService());

    const result = await service.calculate(
      new Date('2026-06-13T00:00:00.000Z'),
      client as never,
    );

    expect(result.d1.rate.toString()).toBe('50');
    expect(result.d7.rate.toString()).toBe('100');
    expect(result.d30.rate.toString()).toBe('0');
    expect(result.retentionRate.toString()).toBe('66.6667');
  });
});
