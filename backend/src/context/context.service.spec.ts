import { PrismaService } from '../prisma/prisma.service';
import { ContextSnapshotService } from './context-snapshot.service';
import { ContextService } from './context.service';
import { MemoryService } from './memory.service';

describe('ContextService', () => {
  it.each(['profile', 'memory', 'snapshot'])(
    'rejects foreign %s before projecting Vision context',
    async (source) => {
      const foreign = { userId: 'user-b' };
      const prisma = {
        user: { findUnique: async () => ({ id: 'user-a' }) },
        nutritionProfile: {
          findUnique: async () => (source === 'profile' ? foreign : null),
        },
        userPreferences: { findUnique: async () => null },
        userContextSnapshot: {
          findFirst: async () => (source === 'snapshot' ? foreign : null),
        },
      };
      const service = new ContextService(
        prisma as unknown as PrismaService,
        {
          listRelevant: async () => (source === 'memory' ? [foreign] : []),
        } as unknown as MemoryService,
        {
          getStatistics: async () => ({}),
        } as unknown as ContextSnapshotService,
      );
      await expect(service.buildUserContext('user-a')).rejects.toThrow();
    },
  );
  it('builds user context only by aggregating persisted data', async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: 'user-id' }),
      },
      nutritionProfile: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'nutrition-id', userId: 'user-id' }),
      },
      userPreferences: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'preferences-id', userId: 'user-id' }),
      },
      userContextSnapshot: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 'snapshot-id', userId: 'user-id' }),
      },
    };
    const memoryService = {
      listRelevant: jest
        .fn()
        .mockResolvedValue([{ id: 'memory-id', userId: 'user-id' }]),
    };
    const snapshotService = {
      getStatistics: jest.fn().mockResolvedValue({
        messagesLast7Days: 2,
      }),
    };
    const service = new ContextService(
      prisma as unknown as PrismaService,
      memoryService as unknown as MemoryService,
      snapshotService as unknown as ContextSnapshotService,
    );

    await expect(service.buildUserContext('user-id')).resolves.toEqual({
      userId: 'user-id',
      nutritionProfile: { id: 'nutrition-id', userId: 'user-id' },
      preferences: { id: 'preferences-id', userId: 'user-id' },
      latestSnapshot: { id: 'snapshot-id', userId: 'user-id' },
      memories: [{ id: 'memory-id', userId: 'user-id' }],
      statistics: { messagesLast7Days: 2 },
    });
  });
});
