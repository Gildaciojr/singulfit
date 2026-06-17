import { PrismaService } from '../prisma/prisma.service';
import { ContextSnapshotService } from './context-snapshot.service';
import { ContextService } from './context.service';
import { MemoryService } from './memory.service';

describe('ContextService', () => {
  it('builds user context only by aggregating persisted data', async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: 'user-id' }),
      },
      nutritionProfile: {
        findUnique: jest.fn().mockResolvedValue({ id: 'nutrition-id' }),
      },
      userPreferences: {
        findUnique: jest.fn().mockResolvedValue({ id: 'preferences-id' }),
      },
      userContextSnapshot: {
        findFirst: jest.fn().mockResolvedValue({ id: 'snapshot-id' }),
      },
    };
    const memoryService = {
      listRelevant: jest.fn().mockResolvedValue([{ id: 'memory-id' }]),
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
      nutritionProfile: { id: 'nutrition-id' },
      preferences: { id: 'preferences-id' },
      latestSnapshot: { id: 'snapshot-id' },
      memories: [{ id: 'memory-id' }],
      statistics: { messagesLast7Days: 2 },
    });
  });
});
