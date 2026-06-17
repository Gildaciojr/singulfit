import { AIReviewStatus } from '@prisma/client';
import { AIQualityAdminController } from './ai-quality-admin.controller';
import { AIQualityAdminService } from './ai-quality-admin.service';

describe('AIQualityAdminController', () => {
  function createSubject() {
    const quality = {
      listEvaluations: jest
        .fn()
        .mockResolvedValue({ items: [], nextCursor: null }),
      listFlags: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
      listPrompts: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
      listReviewQueue: jest
        .fn()
        .mockResolvedValue({ items: [], nextCursor: null }),
      resolveReview: jest.fn().mockResolvedValue({
        id: 'review-id',
        status: AIReviewStatus.REVIEWED,
      }),
    };
    const controller = new AIQualityAdminController(
      quality as unknown as AIQualityAdminService,
    );

    return { controller, quality };
  }

  it.each([
    ['evaluations', 'listEvaluations'],
    ['flags', 'listFlags'],
    ['prompts', 'listPrompts'],
    ['reviewQueue', 'listReviewQueue'],
  ] as const)(
    'delegates %s reads to the admin service',
    async (method, serviceMethod) => {
      const subject = createSubject();
      const query = { limit: 20 };

      await expect(subject.controller[method](query)).resolves.toEqual({
        items: [],
        nextCursor: null,
      });
      expect(subject.quality[serviceMethod]).toHaveBeenCalledWith(query);
    },
  );

  it('resolves review queue items', async () => {
    const subject = createSubject();

    await subject.controller.resolveReview('review-id', {
      status: AIReviewStatus.REVIEWED,
    });

    expect(subject.quality.resolveReview).toHaveBeenCalledWith('review-id', {
      status: AIReviewStatus.REVIEWED,
    });
  });
});
