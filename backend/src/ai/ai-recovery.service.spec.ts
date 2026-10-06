import { AIJobStatus, MealAnalysisStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UsageService } from '../usage/usage.service';
import { EventService } from '../observability/event.service';
import { AIRecoveryService } from './ai-recovery.service';
import type { AIService } from './ai.service';
import { DURABLE_TEXT_REVISION } from './durable-text-operation.contract';

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
  it.each([false, true])(
    'preserves durable responses on restart and settles them only after deadline=%s',
    async (expired) => {
      const now = new Date('2026-10-06T12:00:00Z');
      const state = {
        revision: DURABLE_TEXT_REVISION,
        requestInput: '{}',
        executionContext: '{}',
        deadlineAt: new Date(
          now.getTime() + (expired ? -1 : 60_000),
        ).toISOString(),
        attempts: [
          {
            attemptKey: 'root:attempt:1',
            phase: 'POLLING',
            responseId: 'resp_initial',
            usageRecorded: false,
            response: null,
          },
        ],
        repairInput: null,
        initialValidated: false,
        accountingIssue: null,
      };
      const prisma = {
        aIJob: {
          findMany: jest
            .fn()
            .mockResolvedValue([
              { id: 'durable-job', result: { durableTextOperation: state } },
            ]),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
      };
      const usage = { reverseInTransaction: jest.fn() };
      const event = { recordInTransaction: jest.fn() };
      const response = {
        responseId: 'resp_initial',
        model: 'fixed-model',
        outputText: '{}',
        promptTokens: 100,
        completionTokens: 20,
        totalTokens: 120,
      };
      const ai = {
        runTextJob: jest.fn().mockResolvedValue(response),
        failJob: jest.fn().mockResolvedValue(undefined),
      };
      const recovery = new AIRecoveryService(
        prisma as unknown as PrismaService,
        usage as unknown as UsageService,
        event as unknown as EventService,
        ai as unknown as AIService,
      );
      await expect(recovery.recover(now)).resolves.toBe(1);
      expect(prisma.aIJob.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: AIJobStatus.PENDING, leaseExpiresAt: null },
        }),
      );
      expect(usage.reverseInTransaction).not.toHaveBeenCalled();
      if (expired) {
        expect(ai.runTextJob).toHaveBeenCalledTimes(1);
        expect(ai.failJob).toHaveBeenCalledWith(
          'durable-job',
          new Error('Durable operation recovery deadline exceeded'),
          response,
        );
      } else {
        expect(ai.runTextJob).not.toHaveBeenCalled();
        expect(ai.failJob).not.toHaveBeenCalled();
      }
    },
  );
});
