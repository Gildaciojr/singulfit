import { Injectable } from '@nestjs/common';
import { MessageDirection, Prisma } from '@prisma/client';
import { AnalyticsDateService } from './analytics-date.service';
import {
  AnalyticsDatabaseClient,
  RetentionMetric,
} from './interfaces/analytics.interface';

@Injectable()
export class RetentionAnalyticsService {
  constructor(private readonly dates: AnalyticsDateService) {}

  async calculate(snapshotDate: Date, client: AnalyticsDatabaseClient) {
    const date = this.dates.utcDay(snapshotDate);
    const [d1, d7, d30] = await Promise.all([
      this.calculateCohort(date, 1, client),
      this.calculateCohort(date, 7, client),
      this.calculateCohort(date, 30, client),
    ]);
    const totalCohort = d1.cohortSize + d7.cohortSize + d30.cohortSize;
    const totalRetained = d1.retained + d7.retained + d30.retained;

    return {
      d1,
      d7,
      d30,
      retentionRate: this.percentage(totalRetained, totalCohort),
    };
  }

  private async calculateCohort(
    snapshotDate: Date,
    days: number,
    client: AnalyticsDatabaseClient,
  ): Promise<RetentionMetric> {
    const cohortDate = this.dates.addDays(snapshotDate, -days);
    const cohort = await client.user.findMany({
      where: {
        createdAt: {
          gte: cohortDate,
          lt: this.dates.nextDay(cohortDate),
        },
      },
      select: {
        id: true,
      },
    });
    const userIds = cohort.map((user) => user.id);

    if (userIds.length === 0) {
      return {
        cohortSize: 0,
        retained: 0,
        rate: new Prisma.Decimal(0),
      };
    }

    const nextDate = this.dates.nextDay(snapshotDate);
    const [messages, meals] = await Promise.all([
      client.message.findMany({
        where: {
          direction: MessageDirection.INBOUND,
          timestamp: {
            gte: snapshotDate,
            lt: nextDate,
          },
          conversation: {
            userId: {
              in: userIds,
            },
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
          userId: {
            in: userIds,
          },
          createdAt: {
            gte: snapshotDate,
            lt: nextDate,
          },
        },
        select: {
          userId: true,
        },
      }),
    ]);
    const retainedUserIds = new Set([
      ...messages.map((message) => message.conversation.userId),
      ...meals.map((meal) => meal.userId),
    ]);

    return {
      cohortSize: userIds.length,
      retained: retainedUserIds.size,
      rate: this.percentage(retainedUserIds.size, userIds.length),
    };
  }

  private percentage(value: number, total: number): Prisma.Decimal {
    return total === 0
      ? new Prisma.Decimal(0)
      : new Prisma.Decimal(value).mul(100).div(total).toDecimalPlaces(4);
  }
}
