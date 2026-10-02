import { MealAnalysisStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NutritionConsumptionSummaryService } from './nutrition-consumption-summary.service';

describe('NutritionConsumptionSummaryService', () => {
  const at = new Date('2026-08-24T03:30:00Z'); // Monday, 00:30 in São Paulo
  function record(
    id: string,
    calories: number | null,
    status: MealAnalysisStatus = 'COMPLETED',
    userId = 'user',
  ) {
    return {
      id,
      status,
      meal: { userId, createdAt: new Date('2026-08-24T03:15:00Z') },
      totalCalories: calories === null ? null : new Prisma.Decimal(calories),
      totalProtein: new Prisma.Decimal(20),
      totalCarbs: new Prisma.Decimal(30),
      totalFat: new Prisma.Decimal(10),
    };
  }
  function subject(records: ReturnType<typeof record>[]) {
    const prisma = {
      mealAnalysis: { findMany: jest.fn().mockResolvedValue(records) },
    };
    return {
      prisma,
      service: new NutritionConsumptionSummaryService(
        prisma as unknown as PrismaService,
      ),
    };
  }
  it('sums each owned completed analysis once and excludes failed, pending, foreign and future meals', async () => {
    const future = {
      ...record('future', 500),
      meal: { userId: 'user', createdAt: new Date('2026-08-24T04:00:00Z') },
    };
    const s = subject([
      record('a', 100),
      record('a', 100),
      record('b', 200),
      record('failed', 800, 'FAILED'),
      record('pending', 900, 'PENDING'),
      record('foreign', 700, 'COMPLETED', 'other'),
      future,
    ]);
    const result = await s.service.summarize({
      userId: 'user',
      period: 'TODAY',
      referenceDate: at,
      timezone: 'America/Sao_Paulo',
    });
    expect(result).toMatchObject({
      calories: 300,
      protein: 40,
      carbs: 60,
      fat: 20,
      mealCount: 2,
      periodStart: new Date('2026-08-24T03:00:00Z'),
      periodEnd: new Date('2026-08-25T03:00:00Z'),
    });
    expect(s.prisma.mealAnalysis.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: 'COMPLETED',
          meal: {
            userId: 'user',
            createdAt: {
              gte: result.periodStart,
              lt: result.periodEnd,
              lte: at,
            },
          },
        },
      }),
    );
  });
  it('does not turn missing values into a fabricated complete total', async () => {
    const s = subject([record('a', null), record('b', 200)]);
    expect(
      await s.service.summarize({
        userId: 'user',
        period: 'TODAY',
        referenceDate: at,
        timezone: null,
      }),
    ).toMatchObject({ calories: null, protein: 40, mealCount: 2 });
  });
  it.each([
    [
      '2026-08-24T02:30:00Z',
      'TODAY',
      '2026-08-23T03:00:00Z',
      '2026-08-24T03:00:00Z',
    ],
    [
      '2026-08-24T03:30:00Z',
      'TODAY',
      '2026-08-24T03:00:00Z',
      '2026-08-25T03:00:00Z',
    ],
    [
      '2026-08-24T02:30:00Z',
      'THIS_WEEK',
      '2026-08-17T03:00:00Z',
      '2026-08-24T03:00:00Z',
    ],
    [
      '2026-08-24T03:30:00Z',
      'THIS_WEEK',
      '2026-08-24T03:00:00Z',
      '2026-08-31T03:00:00Z',
    ],
  ] as const)(
    'uses local boundaries at %s for %s',
    async (date, period, start, end) => {
      const s = subject([]);
      expect(
        await s.service.summarize({
          userId: 'user',
          period,
          referenceDate: new Date(date),
          timezone: 'America/Sao_Paulo',
        }),
      ).toMatchObject({
        calories: 0,
        mealCount: 0,
        periodStart: new Date(start),
        periodEnd: new Date(end),
      });
    },
  );
});
