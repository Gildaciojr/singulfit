import { Injectable } from '@nestjs/common';
import { InvoiceStatus, PlanType, Prisma } from '@prisma/client';
import { AnalyticsDateService } from './analytics-date.service';
import {
  AnalyticsDatabaseClient,
  AnalyticsSubscription,
  RevenueMetricResult,
} from './interfaces/analytics.interface';

@Injectable()
export class RevenueMetricsService {
  constructor(private readonly dates: AnalyticsDateService) {}

  async calculate(
    snapshotDate: Date,
    client: AnalyticsDatabaseClient,
  ): Promise<RevenueMetricResult> {
    const date = this.dates.utcDay(snapshotDate);
    const nextDate = this.dates.nextDay(date);
    const [subscriptions, revenue] = await Promise.all([
      this.loadSubscriptions(nextDate, client),
      client.invoice.aggregate({
        where: {
          status: InvoiceStatus.PAID,
          paidAt: {
            gte: date,
            lt: nextDate,
          },
        },
        _sum: {
          total: true,
        },
      }),
    ]);
    const activeSubscriptions = this.activeByUserAt(subscriptions, date);
    const mrr = this.sumMonthlyRevenue(activeSubscriptions);
    const payingUsers = activeSubscriptions.length;
    const premiumUsers = activeSubscriptions.filter(
      (subscription) => subscription.plan.type === PlanType.PREMIUM,
    ).length;
    const basicUsers = activeSubscriptions.filter(
      (subscription) => subscription.plan.type === PlanType.BASIC,
    ).length;

    return {
      mrr,
      arr: mrr.mul(12).toDecimalPlaces(2),
      arpu:
        payingUsers === 0
          ? new Prisma.Decimal(0)
          : mrr.div(payingUsers).toDecimalPlaces(2),
      recognizedRevenue:
        revenue._sum.total?.toDecimalPlaces(2) ?? new Prisma.Decimal(0),
      payingUsers,
      activeSubscriptions: activeSubscriptions.length,
      premiumUsers,
      basicUsers,
      subscriptions: activeSubscriptions,
    };
  }

  loadSubscriptions(
    before: Date,
    client: AnalyticsDatabaseClient,
  ): Promise<AnalyticsSubscription[]> {
    return client.subscription.findMany({
      where: {
        startedAt: {
          not: null,
          lt: before,
        },
      },
      select: {
        id: true,
        userId: true,
        amount: true,
        startedAt: true,
        canceledAt: true,
        endedAt: true,
        cancelAtPeriodEnd: true,
        currentPeriodEnd: true,
        billingPeriodEnd: true,
        plan: {
          select: {
            type: true,
            billingIntervalCount: true,
          },
        },
      },
      orderBy: [{ startedAt: 'asc' }, { id: 'asc' }],
    });
  }

  activeByUserAt(
    subscriptions: AnalyticsSubscription[],
    date: Date,
  ): AnalyticsSubscription[] {
    const at = this.dates.endOfDay(date);
    const active = subscriptions.filter((subscription) =>
      this.isActiveAt(subscription, at),
    );
    const latestByUser = new Map<string, AnalyticsSubscription>();

    for (const subscription of active) {
      const current = latestByUser.get(subscription.userId);
      const currentStart = current?.startedAt?.getTime() ?? 0;
      const candidateStart = subscription.startedAt?.getTime() ?? 0;

      if (
        !current ||
        candidateStart > currentStart ||
        (candidateStart === currentStart && subscription.id > current.id)
      ) {
        latestByUser.set(subscription.userId, subscription);
      }
    }

    return [...latestByUser.values()];
  }

  monthlyAmount(subscription: AnalyticsSubscription): Prisma.Decimal {
    const intervalCount = Math.max(1, subscription.plan.billingIntervalCount);

    return subscription.amount.div(intervalCount).toDecimalPlaces(2);
  }

  sumMonthlyRevenue(subscriptions: AnalyticsSubscription[]): Prisma.Decimal {
    return subscriptions
      .reduce(
        (total, subscription) => total.add(this.monthlyAmount(subscription)),
        new Prisma.Decimal(0),
      )
      .toDecimalPlaces(2);
  }

  private isActiveAt(subscription: AnalyticsSubscription, at: Date): boolean {
    if (!subscription.startedAt || subscription.startedAt > at) {
      return false;
    }

    const scheduledEnd = subscription.cancelAtPeriodEnd
      ? (subscription.currentPeriodEnd ?? subscription.billingPeriodEnd)
      : null;
    const effectiveEnd =
      subscription.endedAt ??
      scheduledEnd ??
      (!subscription.cancelAtPeriodEnd ? subscription.canceledAt : null);

    return !effectiveEnd || effectiveEnd > at;
  }
}
