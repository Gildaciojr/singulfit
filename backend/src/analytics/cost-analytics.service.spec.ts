import { ConfigService } from '@nestjs/config';
import { MediaType, Prisma } from '@prisma/client';
import { AnalyticsDateService } from './analytics-date.service';
import { CostAnalyticsService } from './cost-analytics.service';

describe('CostAnalyticsService', () => {
  it('aggregates AI, WhatsApp and storage costs by user', async () => {
    const usage = [
      {
        userId: 'user-id',
        provider: 'OPENAI',
        model: 'gpt-test',
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        estimatedCost: new Prisma.Decimal('0.01'),
      },
    ];
    const client = {
      aIUsage: {
        findMany: jest.fn().mockResolvedValue(usage),
      },
      message: {
        findMany: jest.fn().mockResolvedValue([
          {
            conversation: {
              userId: 'user-id',
            },
          },
        ]),
      },
      outboundMessage: {
        findMany: jest.fn().mockResolvedValue([{ userId: 'user-id' }]),
      },
      scheduledMessage: {
        findMany: jest.fn().mockResolvedValue([{ userId: 'user-id' }]),
      },
      mediaFile: {
        findMany: jest.fn().mockResolvedValue([
          {
            userId: 'user-id',
            mediaType: MediaType.IMAGE,
            fileSize: 1024 ** 3,
          },
        ]),
      },
    };
    const config = {
      get: jest.fn((_key: string, fallback: string) => fallback),
    };
    const service = new CostAnalyticsService(
      config as unknown as ConfigService,
      new AnalyticsDateService(),
    );

    const result = await service.calculateDaily(
      new Date('2026-06-13T00:00:00.000Z'),
      client as never,
    );

    expect(result.users[0]).toEqual(
      expect.objectContaining({
        aiInputTokens: 100,
        aiOutputTokens: 50,
        aiTotalTokens: 150,
        whatsappSent: 2,
        whatsappReceived: 1,
        storageImages: 1,
        storageUploads: 1,
        storageTotalBytes: 1073741824n,
      }),
    );
    expect(result.users[0]?.aiCostBrl.toString()).toBe('0.05');
    expect(result.users[0]?.whatsappCostBrl.toString()).toBe('0.13');
    expect(result.users[0]?.storageCostBrl.toString()).toBe('0.004');
    expect(result.aiByProvider).toEqual({
      OPENAI: {
        tokens: 150,
        costUsd: '0.01000000',
      },
    });
    expect(result.aiByModel).toEqual({
      'gpt-test': {
        tokens: 150,
        costUsd: '0.01000000',
      },
    });
    expect(result.whatsappRows).toHaveLength(3);
  });
});
