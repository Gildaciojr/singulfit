import {
  MemoryType,
  MessageDirection,
  MessageType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CONTEXT_MEMORY_SOURCE } from './context.constants';
import { MemoryService } from './memory.service';

describe('MemoryService', () => {
  it('builds a deterministic and bounded long-term memory', async () => {
    const prisma = {
      message: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'message-2',
            direction: MessageDirection.INBOUND,
            type: MessageType.TEXT,
            content: 'b'.repeat(700),
            timestamp: new Date('2026-06-10T12:00:00.000Z'),
          },
          {
            id: 'message-1',
            direction: MessageDirection.OUTBOUND,
            type: MessageType.TEXT,
            content: 'Resposta curta',
            timestamp: new Date('2026-06-10T11:00:00.000Z'),
          },
        ]),
      },
    };
    const service = new MemoryService(prisma as unknown as PrismaService);

    const prepared = await service.prepareLongTermMemory(
      'user-id',
      {
        lastInteractionAt: new Date('2026-06-10T12:00:00.000Z'),
        messagesLast7Days: 2,
        messagesLast30Days: 3,
        nutritionAnalysesCount: 4,
        adherenceScore: 80,
      },
      {
        goal: 'WEIGHT_LOSS',
        activityLevel: 'MODERATE',
        currentWeightKg: new Prisma.Decimal('80'),
        targetWeightKg: new Prisma.Decimal('70'),
      },
      new Date('2026-06-10T12:05:00.000Z'),
    );
    const messages = prepared.content.recentMessages as Prisma.JsonArray;

    expect(messages).toHaveLength(2);
    expect((messages[1] as Prisma.JsonObject).content).toHaveLength(500);
    expect(prepared.summary).toContain('3 mensagens');
    expect(prepared.summary).toContain('aderência 80/100');
  });

  it('upserts the consolidated memory without creating retry duplicates', async () => {
    const transaction = {
      conversationMemory: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({ id: 'memory-id' }),
      },
    };
    const service = new MemoryService({} as PrismaService);
    const generatedAt = new Date('2026-06-10T12:00:00.000Z');

    await service.persistLongTermInTransaction(
      transaction as unknown as Prisma.TransactionClient,
      'user-id',
      {
        content: {
          recentMessages: [],
        },
        summary: 'Resumo consolidado',
        relevanceScore: new Prisma.Decimal('1'),
        generatedAt,
      },
    );

    expect(transaction.conversationMemory.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId_memoryType_sourceKey: {
            userId: 'user-id',
            memoryType: MemoryType.LONG_TERM,
            sourceKey: CONTEXT_MEMORY_SOURCE.CONSOLIDATED,
          },
        },
      }),
    );
  });
});
