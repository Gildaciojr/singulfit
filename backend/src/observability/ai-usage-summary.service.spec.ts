import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AIUsageSummaryService } from './ai-usage-summary.service';

describe('AIUsageSummaryService', () => {
  it('rebuilds a UTC daily summary under an advisory lock', async () => {
    const summaries = [
      {
        id: 'summary-id',
        userId: 'user-id',
        date: new Date('2026-06-10T00:00:00.000Z'),
        totalTokens: 450,
        totalCostUsd: new Prisma.Decimal('0.01450000'),
      },
    ];
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([{ locked: true }]),
      aIUsage: {
        groupBy: jest.fn().mockResolvedValue([
          {
            userId: 'user-id',
            _sum: {
              totalTokens: 450,
              estimatedCost: new Prisma.Decimal('0.01450000'),
            },
          },
        ]),
      },
      aIUsageSummary: {
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest.fn().mockResolvedValue(summaries),
      },
    };
    const prisma = {
      $transaction: jest.fn(
        (operation: (client: typeof transaction) => unknown) =>
          operation(transaction),
      ),
    };
    const service = new AIUsageSummaryService(
      prisma as unknown as PrismaService,
    );

    await expect(
      service.consolidateDate(new Date('2026-06-10T18:30:00.000Z')),
    ).resolves.toBe(summaries);
    expect(transaction.aIUsage.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          createdAt: {
            gte: new Date('2026-06-10T00:00:00.000Z'),
            lt: new Date('2026-06-11T00:00:00.000Z'),
          },
        },
      }),
    );
    expect(transaction.aIUsageSummary.createMany).toHaveBeenCalledWith({
      data: [
        {
          userId: 'user-id',
          date: new Date('2026-06-10T00:00:00.000Z'),
          totalTokens: 450,
          totalCostUsd: new Prisma.Decimal('0.01450000'),
        },
      ],
    });
  });

  it('removes stale summaries when a day has no usage', async () => {
    const transaction = {
      $queryRaw: jest.fn(),
      aIUsage: {
        groupBy: jest.fn().mockResolvedValue([]),
      },
      aIUsageSummary: {
        deleteMany: jest.fn(),
        createMany: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const prisma = {
      $transaction: jest.fn(
        (operation: (client: typeof transaction) => unknown) =>
          operation(transaction),
      ),
    };
    const service = new AIUsageSummaryService(
      prisma as unknown as PrismaService,
    );

    await service.consolidateDate(new Date('2026-06-10T00:00:00.000Z'));

    expect(transaction.aIUsageSummary.deleteMany).toHaveBeenCalled();
    expect(transaction.aIUsageSummary.createMany).not.toHaveBeenCalled();
  });
});
