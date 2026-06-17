import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AnalyticsDateService } from './analytics-date.service';
import { AnalyticsSnapshotService } from './analytics-snapshot.service';
import { AnalyticsDashboardQueryDto } from './dto/analytics-dashboard-query.dto';

@Injectable()
export class AnalyticsQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dates: AnalyticsDateService,
    private readonly snapshots: AnalyticsSnapshotService,
  ) {}

  async revenue(query: AnalyticsDashboardQueryDto) {
    const range = await this.range(query);
    const history = await this.prisma.revenueSnapshot.findMany({
      where: {
        snapshotDate: range.filter,
      },
      orderBy: {
        snapshotDate: 'asc',
      },
    });

    return {
      current: history.at(-1) ?? null,
      history,
    };
  }

  async churn(query: AnalyticsDashboardQueryDto) {
    const range = await this.range(query);
    const history = await this.prisma.churnSnapshot.findMany({
      where: {
        snapshotDate: range.filter,
      },
      orderBy: {
        snapshotDate: 'asc',
      },
    });
    const current = history.at(-1);

    return {
      current: current
        ? {
            ...current,
            userChurn: current.monthlyUserChurnRate,
            revenueChurn: current.monthlyRevenueChurnRate,
            monthlyChurn: current.monthlyUserChurnRate,
            quarterlyChurn: current.quarterlyUserChurnRate,
          }
        : null,
      history,
    };
  }

  async retention(query: AnalyticsDashboardQueryDto) {
    const range = await this.range(query);
    const history = await this.prisma.retentionSnapshot.findMany({
      where: {
        snapshotDate: range.filter,
      },
      orderBy: {
        snapshotDate: 'asc',
      },
    });

    return {
      current: history.at(-1) ?? null,
      history,
    };
  }

  async costs(query: AnalyticsDashboardQueryDto) {
    const range = await this.range(query);
    const history = await this.prisma.costSnapshot.findMany({
      where: {
        snapshotDate: range.filter,
      },
      orderBy: {
        snapshotDate: 'asc',
      },
    });
    const serialized = history.map((snapshot) => ({
      ...snapshot,
      storageTotalBytes: snapshot.storageTotalBytes.toString(),
    }));

    return {
      current: serialized.at(-1) ?? null,
      history: serialized,
    };
  }

  async profitability(query: AnalyticsDashboardQueryDto) {
    const range = await this.range(query);
    const limit = query.limit ?? 50;
    const records = await this.prisma.userProfitabilitySnapshot.findMany({
      where: {
        snapshotDate: range.target,
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
      orderBy: [{ estimatedProfit: 'asc' }, { id: 'asc' }],
      cursor: query.cursor
        ? {
            id: query.cursor,
          }
        : undefined,
      skip: query.cursor ? 1 : undefined,
      take: limit + 1,
    });
    const hasMore = records.length > limit;
    const items = hasMore ? records.slice(0, limit) : records;
    const totals = await this.prisma.userProfitabilitySnapshot.aggregate({
      where: {
        snapshotDate: range.target,
      },
      _sum: {
        monthlyRevenue: true,
        aiCost: true,
        whatsappCost: true,
        storageCost: true,
        estimatedProfit: true,
      },
      _avg: {
        marginPercent: true,
      },
      _count: {
        _all: true,
      },
    });

    return {
      snapshotDate: range.target,
      summary: {
        users: totals._count._all,
        monthlyRevenue: totals._sum.monthlyRevenue ?? new Prisma.Decimal(0),
        aiCost: totals._sum.aiCost ?? new Prisma.Decimal(0),
        whatsappCost: totals._sum.whatsappCost ?? new Prisma.Decimal(0),
        storageCost: totals._sum.storageCost ?? new Prisma.Decimal(0),
        estimatedProfit: totals._sum.estimatedProfit ?? new Prisma.Decimal(0),
        averageMargin: totals._avg.marginPercent ?? new Prisma.Decimal(0),
      },
      items,
      nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
    };
  }

  async growth(query: AnalyticsDashboardQueryDto) {
    const range = await this.range(query);
    const history = await this.prisma.growthSnapshot.findMany({
      where: {
        snapshotDate: range.filter,
      },
      orderBy: {
        snapshotDate: 'asc',
      },
    });

    return {
      current: history.at(-1) ?? null,
      history,
    };
  }

  async plans(query: AnalyticsDashboardQueryDto) {
    const range = await this.range(query);
    const history = await this.prisma.planPerformanceSnapshot.findMany({
      where: {
        snapshotDate: range.filter,
      },
      orderBy: [{ snapshotDate: 'asc' }, { planType: 'asc' }],
    });

    return {
      current: history.filter(
        (snapshot) =>
          snapshot.snapshotDate.getTime() === range.target.getTime(),
      ),
      history,
    };
  }

  private async range(query: AnalyticsDashboardQueryDto) {
    const target = this.dates.parse(query.date);
    await this.snapshots.ensureDaily(target);
    const days = query.days ?? 30;
    const from = this.dates.addDays(target, -(days - 1));

    return {
      target,
      filter: {
        gte: from,
        lte: target,
      },
    };
  }
}
