import { Injectable } from '@nestjs/common';
import { MealAnalysisStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CoachProactiveSchedulePolicy } from '../automation/coach-proactive-schedule.policy';

export type ConsumptionPeriod = 'TODAY' | 'THIS_WEEK';
export interface NutritionConsumptionSummary {
  readonly calories: number | null;
  readonly protein: number | null;
  readonly carbs: number | null;
  readonly fat: number | null;
  readonly mealCount: number;
  readonly periodStart: Date;
  readonly periodEnd: Date;
}

@Injectable()
export class NutritionConsumptionSummaryService {
  private readonly clock = new CoachProactiveSchedulePolicy();
  constructor(private readonly prisma: PrismaService) {}

  async summarize(input: {
    userId: string;
    period: ConsumptionPeriod;
    referenceDate: Date;
    timezone: string | null;
  }): Promise<NutritionConsumptionSummary> {
    if (!input.userId.trim() || !Number.isFinite(input.referenceDate.getTime()))
      throw new Error('INVALID_CONSUMPTION_QUERY');
    const timezone = this.clock.timezone(input.timezone);
    const range =
      input.period === 'TODAY'
        ? this.clock.localDayRange(input.referenceDate, timezone)
        : this.clock.localWeekRange(input.referenceDate, timezone);
    const records = await this.prisma.mealAnalysis.findMany({
      where: {
        status: MealAnalysisStatus.COMPLETED,
        meal: {
          userId: input.userId,
          createdAt: {
            gte: range.start,
            lt: range.end,
            lte: input.referenceDate,
          },
        },
      },
      select: {
        id: true,
        status: true,
        totalCalories: true,
        totalProtein: true,
        totalCarbs: true,
        totalFat: true,
        meal: { select: { userId: true, createdAt: true } },
      },
    });
    const seen = new Set<string>();
    const meals = records.filter((record) => {
      if (
        seen.has(record.id) ||
        record.status !== MealAnalysisStatus.COMPLETED ||
        record.meal.userId !== input.userId ||
        record.meal.createdAt < range.start ||
        record.meal.createdAt >= range.end ||
        record.meal.createdAt > input.referenceDate
      )
        return false;
      seen.add(record.id);
      return true;
    });
    const sum = (
      field: 'totalCalories' | 'totalProtein' | 'totalCarbs' | 'totalFat',
    ) => {
      if (meals.some((meal) => meal[field] === null)) return null;
      return meals.reduce(
        (total, meal) => total + (meal[field]?.toNumber() ?? 0),
        0,
      );
    };
    return Object.freeze({
      calories: sum('totalCalories'),
      protein: sum('totalProtein'),
      carbs: sum('totalCarbs'),
      fat: sum('totalFat'),
      mealCount: meals.length,
      periodStart: range.start,
      periodEnd: range.end,
    });
  }
}
