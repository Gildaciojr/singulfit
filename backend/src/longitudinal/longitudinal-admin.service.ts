import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ListLongitudinalDto } from './dto/list-longitudinal.dto';

@Injectable()
export class LongitudinalAdminService {
  constructor(private readonly prisma: PrismaService) {}

  users(query: ListLongitudinalDto) {
    return this.paginate(
      query,
      this.prisma.longitudinalNutritionProfile.findMany({
        where: {
          userId: query.userId,
          generatedAt: this.dateRange(query),
        },
        orderBy: [{ generatedAt: 'desc' }, { id: 'desc' }],
        cursor: query.cursor ? { id: query.cursor } : undefined,
        skip: query.cursor ? 1 : undefined,
        take: query.limit + 1,
      }),
    );
  }

  preferences(query: ListLongitudinalDto) {
    return this.paginate(
      query,
      this.prisma.foodPreferenceSnapshot.findMany({
        where: {
          userId: query.userId,
          observedAt: this.dateRange(query),
        },
        orderBy: [
          { observedAt: 'desc' },
          { confidence: 'desc' },
          { id: 'desc' },
        ],
        cursor: query.cursor ? { id: query.cursor } : undefined,
        skip: query.cursor ? 1 : undefined,
        take: query.limit + 1,
      }),
    );
  }

  relapses(query: ListLongitudinalDto) {
    return this.paginate(
      query,
      this.prisma.nutritionRelapse.findMany({
        where: {
          userId: query.userId,
          severity: query.severity,
          detectedAt: this.dateRange(query),
        },
        orderBy: [{ detectedAt: 'desc' }, { id: 'desc' }],
        cursor: query.cursor ? { id: query.cursor } : undefined,
        skip: query.cursor ? 1 : undefined,
        take: query.limit + 1,
      }),
    );
  }

  evolution(query: ListLongitudinalDto) {
    return this.paginate(
      query,
      this.prisma.nutritionEvolutionSnapshot.findMany({
        where: {
          userId: query.userId,
          overallDirection: query.direction,
          generatedAt: this.dateRange(query),
        },
        orderBy: [{ generatedAt: 'desc' }, { id: 'desc' }],
        cursor: query.cursor ? { id: query.cursor } : undefined,
        skip: query.cursor ? 1 : undefined,
        take: query.limit + 1,
      }),
    );
  }

  reviews(query: ListLongitudinalDto) {
    return this.paginate(
      query,
      this.prisma.monthlyEvolutionReview.findMany({
        where: {
          userId: query.userId,
          direction: query.direction,
          generatedAt: this.dateRange(query),
        },
        orderBy: [{ monthStart: 'desc' }, { id: 'desc' }],
        cursor: query.cursor ? { id: query.cursor } : undefined,
        skip: query.cursor ? 1 : undefined,
        take: query.limit + 1,
      }),
    );
  }

  private async paginate<T extends { id: string }>(
    query: ListLongitudinalDto,
    promise: Promise<T[]>,
  ) {
    const records = await promise;
    const hasMore = records.length > query.limit;
    const items = hasMore ? records.slice(0, query.limit) : records;

    return {
      items,
      nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
    };
  }

  private dateRange(
    query: Pick<ListLongitudinalDto, 'from' | 'to'>,
  ): Prisma.DateTimeFilter | undefined {
    return query.from || query.to
      ? {
          gte: query.from ? new Date(query.from) : undefined,
          lte: query.to ? new Date(query.to) : undefined,
        }
      : undefined;
  }
}
