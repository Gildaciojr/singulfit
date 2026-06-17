import { NutritionAdminController } from './nutrition-admin.controller';
import { NutritionIntelligenceService } from './nutrition-intelligence.service';

describe('NutritionAdminController', () => {
  it('delegates admin nutrition queries to the intelligence service', async () => {
    const intelligenceService = {
      listInsights: jest.fn().mockResolvedValue({ items: [] }),
      listTrends: jest.fn().mockResolvedValue({ items: [] }),
      listQuality: jest.fn().mockResolvedValue({ items: [] }),
    };
    const controller = new NutritionAdminController(
      intelligenceService as unknown as NutritionIntelligenceService,
    );
    const query = { limit: 25 };

    await controller.listInsights(query);
    await controller.listTrends(query);
    await controller.listQuality(query);

    expect(intelligenceService.listInsights).toHaveBeenCalledWith(query);
    expect(intelligenceService.listTrends).toHaveBeenCalledWith(query);
    expect(intelligenceService.listQuality).toHaveBeenCalledWith(query);
  });
});
