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
  readonly incompleteMealCount?: number;
  readonly knownCalories?: number;
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
    confirmedOnly?: boolean;
    knownAt?: Date;
  }): Promise<NutritionConsumptionSummary> {
    if (!input.userId.trim() || !Number.isFinite(input.referenceDate.getTime()))
      throw new Error('INVALID_CONSUMPTION_QUERY');
    const knownAt = input.knownAt ?? input.referenceDate;
    if (!Number.isFinite(knownAt.getTime()) || knownAt < input.referenceDate)
      throw new Error('INVALID_CONSUMPTION_KNOWLEDGE_CUTOFF');
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
          OR: [
            {
              intakeRecords: {
                some: {
                  kind: 'MEAL',
                  OR: [{ voidedAt: null }, { voidedAt: { gt: knownAt } }],
                  reportedAt: { lte: knownAt },
                  occurredAt: {
                    gte: range.start,
                    lt: range.end,
                    lte: input.referenceDate,
                  },
                },
              },
            },
            ...(input.confirmedOnly
              ? []
              : [
                  {
                    intakeRecords: { none: {} },
                    createdAt: {
                      gte: range.start,
                      lt: range.end,
                      lte: input.referenceDate,
                    },
                  },
                ]),
          ],
        },
      },
      select: {
        id: true,
        status: true,
        totalCalories: true,
        totalProtein: true,
        totalCarbs: true,
        totalFat: true,
        meal: {
          select: {
            userId: true,
            createdAt: true,
            intakeRecords: {
              where: {
                kind: 'MEAL',
                OR: [{ voidedAt: null }, { voidedAt: { gt: knownAt } }],
                reportedAt: { lte: knownAt },
              },
              orderBy: { reportedAt: 'asc' },
              select: { occurredAt: true },
              take: 1,
            },
          },
        },
      },
    });
    const seen = new Set<string>();
    const reports = await this.prisma.nutritionIntakeRecord.findMany({
      where: {
        userId: input.userId,
        kind: 'MEAL',
        OR: [{ voidedAt: null }, { voidedAt: { gt: knownAt } }],
        reportedAt: { lte: knownAt },
        occurredAt: {
          gte: range.start,
          lt: range.end,
          lte: input.referenceDate,
        },
        meal: { is: { userId: input.userId, analysis: { is: null } } },
      },
      include: { meal: true },
    });
    const metric = (evidence: unknown, field: string) => {
      if (
        typeof evidence !== 'object' ||
        evidence === null ||
        Array.isArray(evidence)
      )
        return null;
      const nutrition = (evidence as Record<string, unknown>).nutrition;
      if (
        typeof nutrition !== 'object' ||
        nutrition === null ||
        Array.isArray(nutrition)
      )
        return null;
      const value = (nutrition as Record<string, unknown>)[field];
      return typeof value === 'number' && Number.isFinite(value) && value >= 0
        ? { toNumber: () => value }
        : null;
    };
    const unestimated = reports.flatMap((report) =>
      report.meal
        ? [
            {
              id: `reported:${report.meal.id}`,
              status: 'REPORTED' as const,
              totalCalories: metric(report.evidence, 'calories'),
              totalProtein: metric(report.evidence, 'protein'),
              totalCarbs: metric(report.evidence, 'carbs'),
              totalFat: metric(report.evidence, 'fat'),
              meal: {
                userId: report.meal.userId,
                createdAt: report.meal.createdAt,
                intakeRecords: [{ occurredAt: report.occurredAt }],
              },
            },
          ]
        : [],
    );
    const meals = [...records, ...unestimated].filter((record) => {
      const occurredAt =
        record.meal.intakeRecords?.[0]?.occurredAt ?? record.meal.createdAt;
      if (
        seen.has(record.id) ||
        (record.status !== MealAnalysisStatus.COMPLETED &&
          record.status !== 'REPORTED') ||
        record.meal.userId !== input.userId ||
        occurredAt < range.start ||
        occurredAt >= range.end ||
        occurredAt > input.referenceDate
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
      incompleteMealCount: meals.filter((meal) =>
        ['totalCalories', 'totalProtein', 'totalCarbs', 'totalFat'].some(
          (field) => meal[field as 'totalCalories'] === null,
        ),
      ).length,
      knownCalories: meals.reduce(
        (total, meal) => total + (meal.totalCalories?.toNumber() ?? 0),
        0,
      ),
      periodStart: range.start,
      periodEnd: range.end,
    });
  }
}
