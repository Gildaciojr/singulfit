import { AnalyticsAdminController } from './analytics-admin.controller';
import { AnalyticsQueryService } from './analytics-query.service';

describe('AnalyticsAdminController', () => {
  it('delegates all executive dashboard endpoints', async () => {
    const analytics = {
      revenue: jest.fn(),
      churn: jest.fn(),
      retention: jest.fn(),
      costs: jest.fn(),
      profitability: jest.fn(),
      growth: jest.fn(),
      plans: jest.fn(),
    };
    const controller = new AnalyticsAdminController(
      analytics as unknown as AnalyticsQueryService,
    );
    const query = {
      days: 30,
      limit: 50,
    };

    await controller.revenue(query);
    await controller.churn(query);
    await controller.retention(query);
    await controller.costs(query);
    await controller.profitability(query);
    await controller.growth(query);
    await controller.plans(query);

    for (const method of Object.values(analytics)) {
      expect(method).toHaveBeenCalledWith(query);
    }
  });
});
