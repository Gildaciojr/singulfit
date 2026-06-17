import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AIReviewStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ListAIQualityDto } from './dto/list-ai-quality.dto';
import { ResolveAIReviewDto } from './dto/resolve-ai-review.dto';

@Injectable()
export class AIQualityAdminService {
  constructor(private readonly prisma: PrismaService) {}

  listEvaluations(query: ListAIQualityDto) {
    return this.page(
      this.prisma.aIResponseEvaluation.findMany({
        where: this.evaluationWhere(query),
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          promptVersion: {
            select: {
              id: true,
              name: true,
              version: true,
              isActive: true,
            },
          },
          reviewQueue: true,
        },
        orderBy: [{ evaluatedAt: 'desc' }, { id: 'desc' }],
        cursor: query.cursor ? { id: query.cursor } : undefined,
        skip: query.cursor ? 1 : undefined,
        take: (query.limit ?? 50) + 1,
      }),
      query.limit ?? 50,
    );
  }

  listFlags(query: ListAIQualityDto) {
    return this.page(
      this.prisma.aIResponseEvaluation.findMany({
        where: {
          ...this.evaluationWhere(query),
          NOT: {
            flags: {
              equals: [],
            },
          },
        },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          promptVersion: {
            select: {
              id: true,
              name: true,
              version: true,
            },
          },
        },
        orderBy: [{ evaluatedAt: 'desc' }, { id: 'desc' }],
        cursor: query.cursor ? { id: query.cursor } : undefined,
        skip: query.cursor ? 1 : undefined,
        take: (query.limit ?? 50) + 1,
      }),
      query.limit ?? 50,
    );
  }

  async listPrompts(query: ListAIQualityDto) {
    const limit = query.limit ?? 50;
    const date = this.dateRange(query);
    const records = await this.prisma.promptVersion.findMany({
      where: {
        id: query.promptVersionId,
        qualitySnapshots: {
          some: {
            snapshotDate: date,
          },
        },
      },
      include: {
        qualitySnapshots: {
          where: {
            snapshotDate: date,
          },
          orderBy: {
            snapshotDate: 'asc',
          },
        },
      },
      orderBy: [{ name: 'asc' }, { version: 'desc' }, { id: 'asc' }],
      cursor: query.cursor ? { id: query.cursor } : undefined,
      skip: query.cursor ? 1 : undefined,
      take: limit + 1,
    });
    const hasMore = records.length > limit;
    const items = (hasMore ? records.slice(0, limit) : records).map(
      (record) => ({
        id: record.id,
        name: record.name,
        version: record.version,
        isActive: record.isActive,
        createdAt: record.createdAt,
        metrics: this.promptMetrics(record.qualitySnapshots),
        history: record.qualitySnapshots,
      }),
    );

    return {
      items,
      nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
    };
  }

  listReviewQueue(query: ListAIQualityDto) {
    return this.page(
      this.prisma.aIReviewQueue.findMany({
        where: {
          userId: query.userId,
          status: query.status,
          createdAt: this.dateRange(query),
          evaluation: {
            promptVersionId: query.promptVersionId,
            riskLevel: query.riskLevel,
            evaluationType: query.evaluationType,
          },
        },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          evaluation: {
            include: {
              promptVersion: {
                select: {
                  id: true,
                  name: true,
                  version: true,
                },
              },
            },
          },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        cursor: query.cursor ? { id: query.cursor } : undefined,
        skip: query.cursor ? 1 : undefined,
        take: (query.limit ?? 50) + 1,
      }),
      query.limit ?? 50,
    );
  }

  async resolveReview(id: string, input: ResolveAIReviewDto) {
    return this.prisma.$transaction(async (transaction) => {
      const review = await transaction.aIReviewQueue.findUnique({
        where: {
          id,
        },
      });

      if (!review) {
        throw new NotFoundException('Item da fila de revisão não encontrado');
      }

      if (review.status !== AIReviewStatus.OPEN) {
        if (review.status === input.status) {
          return review;
        }

        throw new ConflictException('Item da fila já foi resolvido');
      }

      return transaction.aIReviewQueue.update({
        where: {
          id,
        },
        data: {
          status: input.status,
          reviewedAt: new Date(),
        },
      });
    });
  }

  private evaluationWhere(
    query: ListAIQualityDto,
  ): Prisma.AIResponseEvaluationWhereInput {
    return {
      userId: query.userId,
      promptVersionId: query.promptVersionId,
      riskLevel: query.riskLevel,
      evaluationType: query.evaluationType,
      evaluatedAt: this.dateRange(query),
    };
  }

  private dateRange(query: ListAIQualityDto) {
    if (!query.from && !query.to) {
      return undefined;
    }

    return {
      gte: query.from ? new Date(query.from) : undefined,
      lte: query.to ? new Date(query.to) : undefined,
    };
  }

  private promptMetrics(
    snapshots: Array<{
      evaluationCount: number;
      averageQualityScore: Prisma.Decimal;
      averageSafetyScore: Prisma.Decimal;
      averageCost: Prisma.Decimal;
      flaggedCount: number;
      blockedCount: number;
      fallbackCount: number;
    }>,
  ) {
    const evaluationCount = snapshots.reduce(
      (total, snapshot) => total + snapshot.evaluationCount,
      0,
    );
    const weighted = (
      selector: (snapshot: (typeof snapshots)[number]) => Prisma.Decimal,
      decimals: number,
    ) => {
      if (evaluationCount === 0) {
        return new Prisma.Decimal(0);
      }

      return snapshots
        .reduce(
          (total, snapshot) =>
            total.add(selector(snapshot).mul(snapshot.evaluationCount)),
          new Prisma.Decimal(0),
        )
        .div(evaluationCount)
        .toDecimalPlaces(decimals);
    };
    const flaggedCount = snapshots.reduce(
      (total, snapshot) => total + snapshot.flaggedCount,
      0,
    );

    return {
      evaluationCount,
      averageQualityScore: weighted(
        (snapshot) => snapshot.averageQualityScore,
        2,
      ),
      averageSafetyScore: weighted(
        (snapshot) => snapshot.averageSafetyScore,
        2,
      ),
      averageCost: weighted((snapshot) => snapshot.averageCost, 8),
      flaggedCount,
      flagRate: new Prisma.Decimal(
        ((flaggedCount / Math.max(1, evaluationCount)) * 100).toFixed(2),
      ),
      blockedCount: snapshots.reduce(
        (total, snapshot) => total + snapshot.blockedCount,
        0,
      ),
      fallbackCount: snapshots.reduce(
        (total, snapshot) => total + snapshot.fallbackCount,
        0,
      ),
    };
  }

  private async page<T extends { id: string }>(
    promise: Promise<T[]>,
    limit: number,
  ) {
    const records = await promise;
    const hasMore = records.length > limit;
    const items = hasMore ? records.slice(0, limit) : records;

    return {
      items,
      nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
    };
  }
}
