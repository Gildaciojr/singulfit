import { Injectable } from '@nestjs/common';
import { MessageDirection, Prisma } from '@prisma/client';
import { AnalyticsDateService } from './analytics-date.service';
import { AnalyticsDatabaseClient } from './interfaces/analytics.interface';

@Injectable()
export class GrowthAnalyticsService {
  constructor(private readonly dates: AnalyticsDateService) {}

  async calculate(
    snapshotDate: Date,
    payingUsers: number,
    client: AnalyticsDatabaseClient,
  ) {
    const date = this.dates.utcDay(snapshotDate);
    const nextDate = this.dates.nextDay(date);
    const monthStart = this.dates.addDays(nextDate, -30);
    const previousMonthStart = this.dates.addDays(monthStart, -30);
    const quarterStart = this.dates.addDays(nextDate, -90);
    const previousQuarterStart = this.dates.addDays(quarterStart, -90);
    const [
      newUsers,
      newUsersMonthly,
      previousMonthUsers,
      newUsersQuarterly,
      previousQuarterUsers,
      activeMessages,
      activeMeals,
    ] = await Promise.all([
      this.countUsers(date, nextDate, client),
      this.countUsers(monthStart, nextDate, client),
      this.countUsers(previousMonthStart, monthStart, client),
      this.countUsers(quarterStart, nextDate, client),
      this.countUsers(previousQuarterStart, quarterStart, client),
      client.message.findMany({
        where: {
          direction: MessageDirection.INBOUND,
          timestamp: {
            gte: monthStart,
            lt: nextDate,
          },
        },
        select: {
          conversation: {
            select: {
              userId: true,
            },
          },
        },
      }),
      client.meal.findMany({
        where: {
          createdAt: {
            gte: monthStart,
            lt: nextDate,
          },
        },
        select: {
          userId: true,
        },
      }),
    ]);
    const activeUsers = new Set([
      ...activeMessages.map((message) => message.conversation.userId),
      ...activeMeals.map((meal) => meal.userId),
    ]).size;

    return {
      newUsers,
      newUsersMonthly,
      newUsersQuarterly,
      activeUsers,
      payingUsers,
      monthlyGrowthRate: this.growthRate(newUsersMonthly, previousMonthUsers),
      quarterlyGrowthRate: this.growthRate(
        newUsersQuarterly,
        previousQuarterUsers,
      ),
    };
  }

  private countUsers(
    from: Date,
    to: Date,
    client: AnalyticsDatabaseClient,
  ): Promise<number> {
    return client.user.count({
      where: {
        createdAt: {
          gte: from,
          lt: to,
        },
      },
    });
  }

  private growthRate(current: number, previous: number): Prisma.Decimal {
    if (previous === 0) {
      return current === 0 ? new Prisma.Decimal(0) : new Prisma.Decimal(100);
    }

    return new Prisma.Decimal(current)
      .sub(previous)
      .mul(100)
      .div(previous)
      .toDecimalPlaces(4);
  }
}
