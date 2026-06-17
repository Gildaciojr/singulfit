import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ListUsageSummaryDto } from './dto/list-usage-summary.dto';

@Injectable()
export class AIUsageSummaryService {
  constructor(private readonly prisma: PrismaService) {}

  async consolidateDate(value: Date = new Date()) {
    const date = this.utcDay(value);
    const nextDate = new Date(date);
    nextDate.setUTCDate(nextDate.getUTCDate() + 1);

    return this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        WITH advisory_lock AS (
          SELECT pg_advisory_xact_lock(
            hashtext(${`ai-usage-summary:${date.toISOString().slice(0, 10)}`})
          )
        )
        SELECT true AS "locked"
        FROM advisory_lock
      `;

      const totals = await transaction.aIUsage.groupBy({
        by: ['userId'],
        where: {
          createdAt: {
            gte: date,
            lt: nextDate,
          },
        },
        _sum: {
          totalTokens: true,
          estimatedCost: true,
        },
      });

      await transaction.aIUsageSummary.deleteMany({
        where: {
          date,
        },
      });

      if (totals.length > 0) {
        await transaction.aIUsageSummary.createMany({
          data: totals.map((total) => ({
            userId: total.userId,
            date,
            totalTokens: total._sum.totalTokens ?? 0,
            totalCostUsd:
              total._sum.estimatedCost ?? new Prisma.Decimal('0.00000000'),
          })),
        });
      }

      return transaction.aIUsageSummary.findMany({
        where: {
          date,
        },
        orderBy: {
          userId: 'asc',
        },
      });
    });
  }

  async list(query: ListUsageSummaryDto) {
    const records = await this.prisma.aIUsageSummary.findMany({
      where: {
        userId: query.userId,
        date: this.dateRange(query.from, query.to),
      },
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
      cursor: query.cursor ? { id: query.cursor } : undefined,
      skip: query.cursor ? 1 : undefined,
      take: query.limit + 1,
    });
    const hasMore = records.length > query.limit;
    const items = hasMore ? records.slice(0, query.limit) : records;

    return {
      items,
      nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
    };
  }

  private dateRange(
    from?: string,
    to?: string,
  ): Prisma.DateTimeFilter | undefined {
    if (!from && !to) {
      return undefined;
    }

    return {
      gte: from ? this.utcDay(new Date(from)) : undefined,
      lte: to ? this.utcDay(new Date(to)) : undefined,
    };
  }

  private utcDay(value: Date): Date {
    if (Number.isNaN(value.getTime())) {
      throw new BadRequestException('Data de consolidação inválida');
    }

    return new Date(
      Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
    );
  }
}
