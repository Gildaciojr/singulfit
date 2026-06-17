import {
  AdaptiveCoachAdminController,
  AdaptiveNutritionAdminController,
  EarlyChurnAdminController,
} from './adaptive-intelligence-admin.controller';
import { AdaptiveIntelligenceService } from './adaptive-intelligence.service';

describe('Adaptive intelligence admin controllers', () => {
  it('delegates all protected admin queries', async () => {
    const adaptive = {
      listEvidence: jest.fn().mockResolvedValue({ items: [] }),
      listPatterns: jest.fn().mockResolvedValue({ items: [] }),
      listLearning: jest.fn().mockResolvedValue({ items: [] }),
      listCommunication: jest.fn().mockResolvedValue({ items: [] }),
      listEarlyChurn: jest.fn().mockResolvedValue({ items: [] }),
    };
    const service = adaptive as unknown as AdaptiveIntelligenceService;
    const nutrition = new AdaptiveNutritionAdminController(service);
    const coach = new AdaptiveCoachAdminController(service);
    const churn = new EarlyChurnAdminController(service);
    const query = { limit: 25 };

    await nutrition.evidence(query);
    await nutrition.patterns(query);
    await coach.learning(query);
    await coach.communication(query);
    await churn.early(query);

    expect(adaptive.listEvidence).toHaveBeenCalledWith(query);
    expect(adaptive.listPatterns).toHaveBeenCalledWith(query);
    expect(adaptive.listLearning).toHaveBeenCalledWith(query);
    expect(adaptive.listCommunication).toHaveBeenCalledWith(query);
    expect(adaptive.listEarlyChurn).toHaveBeenCalledWith(query);
  });
});
