import { Injectable } from '@nestjs/common';
import { MessageDirection, PlanType, Prisma } from '@prisma/client';
import { AnalyticsDateService } from './analytics-date.service';
import {
  AnalyticsDatabaseClient,
  AnalyticsSubscription,
  PlanPerformanceMetric,
  UserOperationalCost,
  UserProfitabilityMetric,
} from './interfaces/analytics.interface';
import { RevenueMetricsService } from './revenue-metrics.service';

@Injectable()
export class PlanPerformanceService {
  constructor(
    private readonly dates: AnalyticsDateService,
    private readonly revenue: RevenueMetricsService,
  ) {}

  async calculate(
    snapshotDate: Date,
    activeSubscriptions: AnalyticsSubscription[],
    costs: UserOperationalCost[],
    profitability: UserProfitabilityMetric[],
    client: AnalyticsDatabaseClient,
  ): Promise<PlanPerformanceMetric[]> {
    const date = this.dates.utcDay(snapshotDate);
    const nextDate = this.dates.nextDay(date);
    const monthStart = this.dates.addDays(nextDate, -30);
    const allSubscriptions = await this.revenue.loadSubscriptions(
      nextDate,
      client,
    );
    const startingSubscriptions = this.revenue.activeByUserAt(
      allSubscriptions,
      monthStart,
    );
    const endingUserIds = new Set(
      activeSubscriptions.map((subscription) => subscription.userId),
    );
    const activeUserIds = [...endingUserIds];
    const [messages, meals] =
      activeUserIds.length === 0
        ? [[], []]
        : await Promise.all([
            client.message.findMany({
              where: {
                direction: MessageDirection.INBOUND,
                timestamp: {
                  gte: monthStart,
                  lt: nextDate,
                },
                conversation: {
                  userId: {
                    in: activeUserIds,
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
                  in: activeUserIds,
                },
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
    const retainedUserIds = new Set([
      ...messages.map((message) => message.conversation.userId),
      ...meals.map((meal) => meal.userId),
    ]);
    const costsByUser = new Map(costs.map((cost) => [cost.userId, cost]));
    const profitByUser = new Map(
      profitability.map((item) => [item.userId, item]),
    );

    return [PlanType.BASIC, PlanType.PREMIUM].map((planType) => {
      const activePlan = activeSubscriptions.filter(
        (subscription) => subscription.plan.type === planType,
      );
      const startingPlan = startingSubscriptions.filter(
        (subscription) => subscription.plan.type === planType,
      );
      const churned = startingPlan.filter(
        (subscription) => !endingUserIds.has(subscription.userId),
      );
      const planCosts = activePlan
        .map((subscription) => costsByUser.get(subscription.userId))
        .filter((cost): cost is UserOperationalCost => cost !== undefined);
      const planProfits = activePlan
        .map((subscription) => profitByUser.get(subscription.userId))
        .filter(
          (profit): profit is UserProfitabilityMetric => profit !== undefined,
        );
      const monthlyRevenue = this.revenue.sumMonthlyRevenue(activePlan);
      const estimatedProfit = planProfits
        .reduce(
          (total, profit) => total.add(profit.estimatedProfit),
          new Prisma.Decimal(0),
        )
        .toDecimalPlaces(8);
      const aiCost = planCosts
        .reduce(
          (total, cost) => total.add(cost.aiCostBrl),
          new Prisma.Decimal(0),
        )
        .toDecimalPlaces(8);
      const whatsappCost = planCosts
        .reduce(
          (total, cost) => total.add(cost.whatsappCostBrl),
          new Prisma.Decimal(0),
        )
        .toDecimalPlaces(8);

      return {
        planType,
        payingUsers: activePlan.length,
        retentionRate: this.percentage(
          activePlan.filter((subscription) =>
            retainedUserIds.has(subscription.userId),
          ).length,
          activePlan.length,
        ),
        churnRate: this.percentage(churned.length, startingPlan.length),
        monthlyRevenue,
        estimatedProfit,
        marginPercent: monthlyRevenue.isZero()
          ? new Prisma.Decimal(0)
          : estimatedProfit.mul(100).div(monthlyRevenue).toDecimalPlaces(4),
        aiTokens: planCosts.reduce(
          (total, cost) => total + cost.aiTotalTokens,
          0,
        ),
        aiCost,
        whatsappMessages: planCosts.reduce(
          (total, cost) => total + cost.whatsappSent + cost.whatsappReceived,
          0,
        ),
        whatsappCost,
      };
    });
  }

  private percentage(value: number, total: number): Prisma.Decimal {
    return total === 0
      ? new Prisma.Decimal(0)
      : new Prisma.Decimal(value).mul(100).div(total).toDecimalPlaces(4);
  }
}
