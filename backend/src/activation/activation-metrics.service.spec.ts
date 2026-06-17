import { ActivationStage } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ActivationMetricsService } from './activation-metrics.service';

describe('ActivationMetricsService', () => {
  it('calculates cumulative funnel and exact activation rate', async () => {
    const counts = [100, 80, 75, 70, 60, 55, 50, 40, 35, 10];
    const prisma = {
      userActivation: {
        count: jest
          .fn()
          .mockImplementation(() => Promise.resolve(counts.shift() ?? 0)),
      },
    };
    const service = new ActivationMetricsService(
      prisma as unknown as PrismaService,
    );

    const result = await service.funnel();

    expect(result.stages).toHaveLength(9);
    expect(
      result.stages.find((item) => item.stage === ActivationStage.ACTIVATED),
    ).toEqual(
      expect.objectContaining({
        users: 35,
        conversionFromRegistered: 35,
      }),
    );
    expect(result.activationRate).toBe(35);
    expect(result.abandonmentRate).toBe(10);
  });
});
