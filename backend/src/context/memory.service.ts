import { Injectable } from '@nestjs/common';
import { MemoryType, MessageDirection, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CONTEXT_MEMORY_SOURCE } from './context.constants';

const RECENT_MESSAGE_LIMIT = 20;
const MESSAGE_CONTENT_LIMIT = 500;

export interface ContextStatistics {
  lastInteractionAt: Date | null;
  messagesLast7Days: number;
  messagesLast30Days: number;
  nutritionAnalysesCount: number;
  adherenceScore: number | null;
}

interface NutritionProfileSummary {
  goal: string;
  activityLevel: string;
  currentWeightKg: { toString(): string };
  targetWeightKg: { toString(): string };
}

export interface PreparedLongTermMemory {
  content: Prisma.InputJsonObject;
  summary: string;
  relevanceScore: Prisma.Decimal;
  generatedAt: Date;
}

@Injectable()
export class MemoryService {
  constructor(private readonly prisma: PrismaService) {}

  async prepareLongTermMemory(
    userId: string,
    statistics: ContextStatistics,
    profile: NutritionProfileSummary | null,
    generatedAt: Date,
  ): Promise<PreparedLongTermMemory> {
    const recentMessages = await this.prisma.message.findMany({
      where: {
        conversation: {
          userId,
        },
      },
      select: {
        direction: true,
        type: true,
        content: true,
        timestamp: true,
      },
      orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
      take: RECENT_MESSAGE_LIMIT,
    });
    const messages: Prisma.InputJsonArray = recentMessages
      .reverse()
      .map((message) => ({
        direction: message.direction,
        type: message.type,
        content: message.content.slice(0, MESSAGE_CONTENT_LIMIT),
        timestamp: message.timestamp.toISOString(),
      }));
    const inboundCount = recentMessages.filter(
      (message) => message.direction === MessageDirection.INBOUND,
    ).length;
    const summaryParts = [
      `${statistics.messagesLast30Days} mensagens nos últimos 30 dias`,
      `${statistics.nutritionAnalysesCount} análises nutricionais concluídas`,
    ];

    if (profile) {
      summaryParts.push(
        `objetivo ${profile.goal}`,
        `atividade ${profile.activityLevel}`,
      );
    }

    if (statistics.adherenceScore !== null) {
      summaryParts.push(`aderência ${statistics.adherenceScore}/100`);
    }

    return {
      content: {
        recentMessages: messages,
        recentInboundMessages: inboundCount,
        statistics: {
          messagesLast7Days: statistics.messagesLast7Days,
          messagesLast30Days: statistics.messagesLast30Days,
          nutritionAnalysesCount: statistics.nutritionAnalysesCount,
          adherenceScore: statistics.adherenceScore,
          lastInteractionAt:
            statistics.lastInteractionAt?.toISOString() ?? null,
        },
        profile: profile
          ? {
              goal: profile.goal,
              activityLevel: profile.activityLevel,
              currentWeightKg: profile.currentWeightKg.toString(),
              targetWeightKg: profile.targetWeightKg.toString(),
            }
          : null,
      },
      summary: summaryParts.join('; ').slice(0, 2_000),
      relevanceScore: new Prisma.Decimal('1.0000'),
      generatedAt,
    };
  }

  async persistLongTermInTransaction(
    transaction: Prisma.TransactionClient,
    userId: string,
    prepared: PreparedLongTermMemory,
  ) {
    const identity = {
      userId,
      memoryType: MemoryType.LONG_TERM,
      sourceKey: CONTEXT_MEMORY_SOURCE.CONSOLIDATED,
    };
    const existing = await transaction.conversationMemory.findUnique({
      where: {
        userId_memoryType_sourceKey: identity,
      },
    });

    if (existing && existing.generatedAt > prepared.generatedAt) {
      return existing;
    }

    return transaction.conversationMemory.upsert({
      where: {
        userId_memoryType_sourceKey: identity,
      },
      update: {
        content: prepared.content,
        summary: prepared.summary,
        relevanceScore: prepared.relevanceScore,
        generatedAt: prepared.generatedAt,
      },
      create: {
        ...identity,
        content: prepared.content,
        summary: prepared.summary,
        relevanceScore: prepared.relevanceScore,
        generatedAt: prepared.generatedAt,
      },
    });
  }

  listRelevant(userId: string, limit = 10) {
    return this.prisma.conversationMemory.findMany({
      where: {
        userId,
      },
      orderBy: [
        {
          relevanceScore: 'desc',
        },
        {
          generatedAt: 'desc',
        },
        {
          id: 'desc',
        },
      ],
      take: limit,
    });
  }
}
