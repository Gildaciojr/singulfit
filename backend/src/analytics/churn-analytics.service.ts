import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AnalyticsDateService } from './analytics-date.service';
import {
  AnalyticsDatabaseClient,
  AnalyticsSubscription,
  ChurnWindowResult,
} from './interfaces/analytics.interface';
import { RevenueMetricsService } from './revenue-metrics.service';

@Injectable()
export class ChurnAnalyticsService {
  constructor(
    private readonly dates: AnalyticsDateService,
    private readonly revenue: RevenueMetricsService,
  ) {}

  async calculate(snapshotDate: Date, client: AnalyticsDatabaseClient) {
    const date = this.dates.utcDay(snapshotDate);
    const subscriptions = await this.revenue.loadSubscriptions(
      this.dates.nextDay(date),
      client,
    );

    return {
      monthly: this.calculateWindow(subscriptions, date, 30),
      quarterly: this.calculateWindow(subscriptions, date, 90),
    };
  }

  calculateWindow(
    subscriptions: AnalyticsSubscription[],
    snapshotDate: Date,
    days: number,
  ): ChurnWindowResult {
    const startDate = this.dates.addDays(snapshotDate, -days);
    const starting = this.revenue.activeByUserAt(subscriptions, startDate);
    const endingUserIds = new Set(
      this.revenue
        .activeByUserAt(subscriptions, snapshotDate)
        .map((subscription) => subscription.userId),
    );
    const churned = starting.filter(
      (subscription) => !endingUserIds.has(subscription.userId),
    );
    const startingMrr = this.revenue.sumMonthlyRevenue(starting);
    const churnedMrr = this.revenue.sumMonthlyRevenue(churned);

    return {
      startingUsers: starting.length,
      churnedUsers: churned.length,
      userChurnRate: this.percentage(churned.length, starting.length),
      startingMrr,
      churnedMrr,
      revenueChurnRate: this.decimalPercentage(churnedMrr, startingMrr),
    };
  }

  private percentage(value: number, total: number): Prisma.Decimal {
    return total === 0
      ? new Prisma.Decimal(0)
      : new Prisma.Decimal(value).mul(100).div(total).toDecimalPlaces(4);
  }

  private decimalPercentage(
    value: Prisma.Decimal,
    total: Prisma.Decimal,
  ): Prisma.Decimal {
    return total.isZero()
      ? new Prisma.Decimal(0)
      : value.mul(100).div(total).toDecimalPlaces(4);
  }
}
