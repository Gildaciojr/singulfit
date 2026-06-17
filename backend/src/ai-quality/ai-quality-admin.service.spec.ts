import { AIReviewStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AIQualityAdminService } from './ai-quality-admin.service';

describe('AIQualityAdminService', () => {
  it('returns weighted prompt quality metrics from snapshots', async () => {
    const prisma = {
      promptVersion: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'prompt-id',
            name: 'nutrition-vision',
            version: 2,
            isActive: true,
            createdAt: new Date(),
            qualitySnapshots: [
              {
                evaluationCount: 2,
                averageQualityScore: new Prisma.Decimal(80),
                averageSafetyScore: new Prisma.Decimal(100),
                averageCost: new Prisma.Decimal('0.004'),
                flaggedCount: 0,
                blockedCount: 0,
                fallbackCount: 0,
              },
              {
                evaluationCount: 1,
                averageQualityScore: new Prisma.Decimal(50),
                averageSafetyScore: new Prisma.Decimal(60),
                averageCost: new Prisma.Decimal('0.01'),
                flaggedCount: 1,
                blockedCount: 1,
                fallbackCount: 1,
              },
            ],
          },
        ]),
      },
    };
    const service = new AIQualityAdminService(
      prisma as unknown as PrismaService,
    );

    const result = await service.listPrompts({ limit: 50 });

    expect(result.items[0]?.metrics).toEqual(
      expect.objectContaining({
        evaluationCount: 3,
        averageQualityScore: new Prisma.Decimal(70),
        flaggedCount: 1,
        blockedCount: 1,
        fallbackCount: 1,
      }),
    );
  });

  it('resolves an open human review item idempotently', async () => {
    const transaction = {
      aIReviewQueue: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'review-id',
          status: AIReviewStatus.OPEN,
        }),
        update: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            id: 'review-id',
            ...data,
          }),
        ),
      },
    };
    const prisma = {
      $transaction: jest.fn(
        (callback: (client: typeof transaction) => unknown) =>
          callback(transaction),
      ),
    };
    const service = new AIQualityAdminService(
      prisma as unknown as PrismaService,
    );

    const result = await service.resolveReview('review-id', {
      status: AIReviewStatus.REVIEWED,
    });

    expect(result).toEqual(
      expect.objectContaining({
        id: 'review-id',
        status: AIReviewStatus.REVIEWED,
        reviewedAt: expect.any(Date),
      }),
    );
  });
});
