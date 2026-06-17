import { BehavioralIntelligenceService } from './behavioral-intelligence.service';
import { BehaviorAdminController } from './behavior-admin.controller';

describe('BehaviorAdminController', () => {
  const query = {
    limit: 20,
  };

  function createSubject() {
    const behavior = {
      listUsers: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
      listInsights: jest
        .fn()
        .mockResolvedValue({ items: [], nextCursor: null }),
      listAdherence: jest
        .fn()
        .mockResolvedValue({ items: [], nextCursor: null }),
      listStages: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
    };
    const controller = new BehaviorAdminController(
      behavior as unknown as BehavioralIntelligenceService,
    );

    return { controller, behavior };
  }

  it.each([
    ['users', 'listUsers'],
    ['insights', 'listInsights'],
    ['adherence', 'listAdherence'],
    ['stages', 'listStages'],
  ] as const)(
    'delegates %s admin reads to the behavior service',
    async (method, serviceMethod) => {
      const subject = createSubject();

      await expect(subject.controller[method](query)).resolves.toEqual({
        items: [],
        nextCursor: null,
      });
      expect(subject.behavior[serviceMethod]).toHaveBeenCalledWith(query);
    },
  );
});
