import { ConfigService } from '@nestjs/config';
import { AIJobType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AIUsageService } from './ai-usage.service';

describe('AIUsageService', () => {
  function createService(prisma: object = {}) {
    const rates: Record<string, string> = {
      OPENAI_TEXT_INPUT_COST_PER_1M_USD: '0.15',
      OPENAI_TEXT_OUTPUT_COST_PER_1M_USD: '0.60',
      OPENAI_VISION_INPUT_COST_PER_1M_USD: '2.50',
      OPENAI_VISION_OUTPUT_COST_PER_1M_USD: '10.00',
    };
    const configService = {
      get: jest.fn((key: string) => rates[key]),
    };

    return new AIUsageService(
      prisma as PrismaService,
      configService as unknown as ConfigService,
    );
  }

  it('calculates text cost using decimal rates per million tokens', () => {
    const service = createService();

    const estimatedCost = service.estimateCost(AIJobType.TEXT, 100, 50);

    expect(estimatedCost.toString()).toBe('0.000045');
  });

  it('charges diet jobs with text model rates', () => {
    const service = createService();

    const estimatedCost = service.estimateCost(AIJobType.DIET, 500, 300);

    expect(estimatedCost.toString()).toBe('0.000255');
  });

  it('persists token usage and the calculated cost', async () => {
    const createdUsage = {
      id: 'usage-id',
      createdAt: new Date('2026-06-10T14:30:00.000Z'),
    };
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([{ locked: true }]),
      aIUsage: {
        create: jest.fn().mockResolvedValue(createdUsage),
      },
      aIUsageSummary: {
        upsert: jest.fn().mockResolvedValue({
          id: 'summary-id',
        }),
      },
    };
    const service = createService();

    const result = await service.recordInTransaction(transaction as never, {
      userId: 'user-id',
      aiJobId: 'job-id',
      jobType: AIJobType.IMAGE,
      model: 'vision-model',
      promptTokens: 200,
      completionTokens: 20,
      totalTokens: 220,
    });

    expect(result).toBe(createdUsage);
    expect(transaction.aIUsage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        model: 'vision-model',
        totalTokens: 220,
        estimatedCost: expect.objectContaining({}),
        costCurrency: 'USD',
      }),
    });
    const createInput = transaction.aIUsage.create.mock.calls[0][0] as {
      data: {
        estimatedCost: {
          toString(): string;
        };
      };
    };

    expect(createInput.data.estimatedCost.toString()).toBe('0.0007');
    expect(transaction.$queryRaw).toHaveBeenCalled();
    expect(transaction.aIUsageSummary.upsert).toHaveBeenCalledWith({
      where: {
        userId_date: {
          userId: 'user-id',
          date: new Date('2026-06-10T00:00:00.000Z'),
        },
      },
      create: {
        userId: 'user-id',
        date: new Date('2026-06-10T00:00:00.000Z'),
        totalTokens: 220,
        totalCostUsd: expect.objectContaining({}),
      },
      update: {
        totalTokens: {
          increment: 220,
        },
        totalCostUsd: {
          increment: expect.objectContaining({}),
        },
      },
    });
  });
});
