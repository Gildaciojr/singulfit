import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AnalyticsSubscription,
  UserOperationalCost,
  UserProfitabilityMetric,
} from './interfaces/analytics.interface';
import { RevenueMetricsService } from './revenue-metrics.service';

@Injectable()
export class UserProfitabilityService {
  constructor(private readonly revenue: RevenueMetricsService) {}

  calculate(
    subscriptions: AnalyticsSubscription[],
    costs: UserOperationalCost[],
  ): UserProfitabilityMetric[] {
    const costsByUser = new Map(costs.map((cost) => [cost.userId, cost]));

    return subscriptions.map((subscription) => {
      const monthlyRevenue = this.revenue.monthlyAmount(subscription);
      const cost = costsByUser.get(subscription.userId);
      const aiCost = cost?.aiCostBrl ?? new Prisma.Decimal(0);
      const whatsappCost = cost?.whatsappCostBrl ?? new Prisma.Decimal(0);
      const storageCost = cost?.storageCostBrl ?? new Prisma.Decimal(0);
      const estimatedProfit = monthlyRevenue
        .sub(aiCost)
        .sub(whatsappCost)
        .sub(storageCost)
        .toDecimalPlaces(8);
      const marginPercent = monthlyRevenue.isZero()
        ? new Prisma.Decimal(0)
        : estimatedProfit.mul(100).div(monthlyRevenue).toDecimalPlaces(4);

      return {
        userId: subscription.userId,
        planType: subscription.plan.type,
        monthlyRevenue,
        aiCost,
        whatsappCost,
        storageCost,
        estimatedProfit,
        marginPercent,
      };
    });
  }
}
