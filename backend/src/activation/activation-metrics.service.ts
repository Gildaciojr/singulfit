import { Injectable } from '@nestjs/common';
import { ActivationRiskLevel, ActivationStage, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ACTIVATION_STAGE_ORDER } from './activation.constants';
import { ListActivationDto } from './dto/list-activation.dto';

@Injectable()
export class ActivationMetricsService {
  constructor(private readonly prisma: PrismaService) {}

  async listUsers(query: ListActivationDto) {
    const limit = query.limit ?? 50;
    const records = await this.prisma.userActivation.findMany({
      where: {
        userId: query.userId,
        currentStage: query.stage,
        riskLevel: query.risk,
        createdAt: this.dateRange(query.from, query.to),
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            phoneE164: true,
            createdAt: true,
          },
        },
        events: {
          orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
          take: 10,
        },
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      cursor: query.cursor ? { id: query.cursor } : undefined,
      skip: query.cursor ? 1 : undefined,
      take: limit + 1,
    });

    return this.page(records, limit);
  }

  async funnel() {
    const [
      total,
      paid,
      connected,
      firstMessage,
      firstMeal,
      firstAnalysis,
      firstRecommendation,
      firstCoachInteraction,
      activated,
      abandoned,
    ] = await Promise.all([
      this.prisma.userActivation.count(),
      this.prisma.userActivation.count({ where: { paidAt: { not: null } } }),
      this.prisma.userActivation.count({
        where: { whatsappConnectedAt: { not: null } },
      }),
      this.prisma.userActivation.count({
        where: { firstMessageSentAt: { not: null } },
      }),
      this.prisma.userActivation.count({
        where: { firstMealReceivedAt: { not: null } },
      }),
      this.prisma.userActivation.count({
        where: { firstAnalysisCompletedAt: { not: null } },
      }),
      this.prisma.userActivation.count({
        where: { firstRecommendationDeliveredAt: { not: null } },
      }),
      this.prisma.userActivation.count({
        where: { firstCoachInteractionAt: { not: null } },
      }),
      this.prisma.userActivation.count({
        where: { currentStage: ActivationStage.ACTIVATED },
      }),
      this.prisma.userActivation.count({
        where: { currentStage: ActivationStage.ABANDONED },
      }),
    ]);
    const values = [
      total,
      paid,
      connected,
      firstMessage,
      firstMeal,
      firstAnalysis,
      firstRecommendation,
      firstCoachInteraction,
      activated,
    ];

    return {
      stages: ACTIVATION_STAGE_ORDER.map((stage, index) => ({
        stage,
        users: values[index] ?? activated,
        conversionFromRegistered:
          total > 0
            ? Number((((values[index] ?? activated) / total) * 100).toFixed(2))
            : 0,
        conversionFromPrevious:
          index === 0 || (values[index - 1] ?? 0) === 0
            ? 100
            : Number(
                (
                  ((values[index] ?? activated) / (values[index - 1] ?? 1)) *
                  100
                ).toFixed(2),
              ),
      })),
      activated,
      abandoned,
      activationRate:
        total > 0 ? Number(((activated / total) * 100).toFixed(2)) : 0,
      abandonmentRate:
        total > 0 ? Number(((abandoned / total) * 100).toFixed(2)) : 0,
    };
  }

  async risk(query: ListActivationDto) {
    const limit = query.limit ?? 50;
    const where = {
      userId: query.userId,
      riskLevel: query.risk,
      currentStage: query.stage,
    } satisfies Prisma.UserActivationWhereInput;
    const [items, groups] = await Promise.all([
      this.prisma.userActivation.findMany({
        where,
        include: {
          user: {
            select: { id: true, name: true, email: true, phoneE164: true },
          },
        },
        orderBy: [{ riskLevel: 'desc' }, { lastProgressAt: 'asc' }],
        cursor: query.cursor ? { id: query.cursor } : undefined,
        skip: query.cursor ? 1 : undefined,
        take: limit + 1,
      }),
      this.prisma.userActivation.groupBy({
        by: ['riskLevel'],
        _count: { _all: true },
      }),
    ]);

    return {
      ...this.page(items, limit),
      totals: Object.fromEntries(
        Object.values(ActivationRiskLevel).map((risk) => [
          risk,
          groups.find((group) => group.riskLevel === risk)?._count._all ?? 0,
        ]),
      ),
    };
  }

  async snapshots(query: ListActivationDto) {
    const limit = query.limit ?? 50;
    const records = await this.prisma.activationSnapshot.findMany({
      where: {
        userId: query.userId,
        currentStage: query.stage,
        riskLevel: query.risk,
        snapshotDate: this.dateRange(query.from, query.to),
      },
      include: {
        user: {
          select: { id: true, name: true, email: true },
        },
      },
      orderBy: [{ snapshotDate: 'desc' }, { id: 'desc' }],
      cursor: query.cursor ? { id: query.cursor } : undefined,
      skip: query.cursor ? 1 : undefined,
      take: limit + 1,
    });

    return this.page(records, limit);
  }

  private dateRange(
    from?: string,
    to?: string,
  ): Prisma.DateTimeFilter | undefined {
    if (!from && !to) {
      return undefined;
    }

    return {
      gte: from ? new Date(from) : undefined,
      lte: to ? new Date(to) : undefined,
    };
  }

  private page<T extends { id: string }>(records: T[], limit: number) {
    const hasMore = records.length > limit;
    const items = hasMore ? records.slice(0, limit) : records;

    return {
      items,
      nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
    };
  }
}
