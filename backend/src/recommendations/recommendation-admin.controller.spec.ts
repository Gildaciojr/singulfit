import 'reflect-metadata';
import { ListRecommendationsDto } from './dto/list-recommendations.dto';
import { RecommendationAdminController } from './recommendation-admin.controller';
import { RecommendationService } from './recommendation.service';

describe('RecommendationAdminController', () => {
  it('delegates list, stats and lifecycle operations', async () => {
    const service = {
      list: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
      stats: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
      accept: jest.fn().mockResolvedValue({ id: 'recommendation-id' }),
      dismiss: jest.fn().mockResolvedValue({ id: 'recommendation-id' }),
    };
    const controller = new RecommendationAdminController(
      service as unknown as RecommendationService,
    );
    const query = new ListRecommendationsDto();

    await controller.list(query);
    await controller.stats(query);
    await controller.accept('recommendation-id');
    await controller.dismiss('recommendation-id');

    expect(service.list).toHaveBeenCalledWith(query);
    expect(service.stats).toHaveBeenCalledWith(query);
    expect(service.accept).toHaveBeenCalledWith('recommendation-id');
    expect(service.dismiss).toHaveBeenCalledWith('recommendation-id');
  });
});
