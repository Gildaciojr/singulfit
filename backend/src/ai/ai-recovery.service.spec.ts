import { AIJobStatus, MealAnalysisStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UsageService } from '../usage/usage.service';
import { EventService } from '../observability/event.service';
import { AIRecoveryService } from './ai-recovery.service';

describe('AIRecoveryService', () => {
  it('fails stale jobs, fails their analysis and reverses reservations', async () => {
    const transaction = {
      aIJob: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      mealAnalysis: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const prisma = {
      aIJob: {
        findMany: jest.fn().mockResolvedValue([{ id: 'job-id' }]),
      },
      $transaction: jest.fn(
        (callback: (client: typeof transaction) => unknown) =>
          callback(transaction),
      ),
    };
    const usageService = {
      reverseInTransaction: jest.fn().mockResolvedValue([]),
    };
    const eventService = {
      recordInTransaction: jest.fn().mockResolvedValue({}),
    };
    const service = new AIRecoveryService(
      prisma as unknown as PrismaService,
      usageService as unknown as UsageService,
      eventService as unknown as EventService,
    );
    const now = new Date('2026-06-10T12:00:00.000Z');

    await expect(service.recover(now)).resolves.toBe(1);
    expect(transaction.aIJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: AIJobStatus.FAILED,
          leaseExpiresAt: null,
        }),
      }),
    );
    expect(transaction.mealAnalysis.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: MealAnalysisStatus.FAILED,
        }),
      }),
    );
    expect(usageService.reverseInTransaction).toHaveBeenCalledWith(
      transaction,
      'job-id',
    );
    expect(eventService.recordInTransaction).toHaveBeenCalledWith(
      transaction,
      expect.objectContaining({
        source: 'AI_WORKER',
        eventType: 'LEASE_EXPIRED',
      }),
    );
  });
});
