import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ListContextUsersDto } from './dto/list-context-users.dto';
import { ContextSnapshotService } from './context-snapshot.service';
import { MemoryService } from './memory.service';

@Injectable()
export class ContextService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly memoryService: MemoryService,
    private readonly snapshotService: ContextSnapshotService,
  ) {}

  async buildUserContext(userId: string) {
    await this.requireUser(userId);
    const [
      nutritionProfile,
      preferences,
      latestSnapshot,
      memories,
      statistics,
    ] = await Promise.all([
      this.prisma.nutritionProfile.findUnique({
        where: {
          userId,
        },
      }),
      this.prisma.userPreferences.findUnique({
        where: {
          userId,
        },
      }),
      this.prisma.userContextSnapshot.findFirst({
        where: {
          userId,
        },
        orderBy: [{ generatedAt: 'desc' }, { id: 'desc' }],
      }),
      this.memoryService.listRelevant(userId),
      this.snapshotService.getStatistics(userId),
    ]);

    return {
      userId,
      nutritionProfile,
      preferences,
      latestSnapshot,
      memories,
      statistics,
    };
  }

  async listUsers(query: ListContextUsersDto) {
    const limit = query.limit ?? 50;
    const records = await this.prisma.user.findMany({
      where: {
        OR: [
          {
            nutritionProfile: {
              isNot: null,
            },
          },
          {
            conversationMemories: {
              some: {},
            },
          },
          {
            contextSnapshots: {
              some: {},
            },
          },
        ],
      },
      select: {
        id: true,
        name: true,
        email: true,
        isActive: true,
        nutritionProfile: {
          select: {
            goal: true,
            activityLevel: true,
            currentWeightKg: true,
            updatedAt: true,
          },
        },
        contextSnapshots: {
          select: {
            generatedAt: true,
          },
          orderBy: {
            generatedAt: 'desc',
          },
          take: 1,
        },
        _count: {
          select: {
            conversationMemories: true,
            contextSnapshots: true,
          },
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
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

    return {
      items: items.map((record) => ({
        id: record.id,
        name: record.name,
        email: record.email,
        isActive: record.isActive,
        nutritionProfile: record.nutritionProfile,
        latestSnapshotAt: record.contextSnapshots[0]?.generatedAt ?? null,
        memoryCount: record._count.conversationMemories,
        snapshotCount: record._count.contextSnapshots,
      })),
      nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
    };
  }

  async getMemory(userId: string) {
    await this.requireUser(userId);

    return {
      userId,
      items: await this.prisma.conversationMemory.findMany({
        where: {
          userId,
        },
        orderBy: [
          {
            generatedAt: 'desc',
          },
          {
            relevanceScore: 'desc',
          },
          {
            id: 'desc',
          },
        ],
        take: 100,
      }),
    };
  }

  private async requireUser(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: {
        id: userId,
      },
      select: {
        id: true,
      },
    });

    if (!user) {
      throw new NotFoundException('Usuário não encontrado');
    }
  }
}
