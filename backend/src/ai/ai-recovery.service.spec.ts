import { AIJobStatus, MealAnalysisStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UsageService } from '../usage/usage.service';
import { EventService } from '../observability/event.service';
import { AIRecoveryService } from './ai-recovery.service';
import { AIService } from './ai.service';
import { ConflictException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DURABLE_TEXT_REVISION } from './durable-text-operation.contract';

describe('AIRecoveryService', () => {
  it('injects the required AIService in the worker recovery provider', async () => {
    const ai = { runTextJob: jest.fn(), failJob: jest.fn() };
    const module = await Test.createTestingModule({
      providers: [
        AIRecoveryService,
        { provide: PrismaService, useValue: {} },
        { provide: UsageService, useValue: {} },
        { provide: EventService, useValue: {} },
        { provide: AIService, useValue: ai },
      ],
    }).compile();
    const metadata: unknown[] = Reflect.getMetadata(
      'design:paramtypes',
      AIRecoveryService,
    );
    expect(metadata[3]).toBe(AIService);
    expect(module.get(AIRecoveryService)).toBeDefined();
    expect(Reflect.get(module.get(AIRecoveryService), 'aiService')).toBe(ai);
    expect(module.get(AIService)).toBe(ai);
    await module.close();
  });

  it('fails startup instead of silently disabling durable settlement when AIService is missing', async () => {
    await expect(
      Test.createTestingModule({
        providers: [
          AIRecoveryService,
          { provide: PrismaService, useValue: {} },
          { provide: UsageService, useValue: {} },
          { provide: EventService, useValue: {} },
        ],
      }).compile(),
    ).rejects.toThrow('AIService');
  });

  it.each([
    [AIJobStatus.PENDING, true, true, 1],
    [AIJobStatus.PENDING, true, false, 0],
    [AIJobStatus.PENDING, false, true, 0],
    [AIJobStatus.COMPLETED, true, true, 0],
    [AIJobStatus.FAILED, true, true, 0],
  ] as const)(
    'selects only expired durable PENDING without an expired reservation: %s durable=%s expired=%s',
    async (status, isDurable, expired, expected) => {
      const now = new Date('2026-10-07T15:17:00Z');
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
            responseId: 'resp_existing',
            usageRecorded: false,
            response: null,
          },
        ],
        repairInput: null,
        initialValidated: false,
        accountingIssue: null,
      };
      const job = {
        id: 'durable-job',
        status,
        attempts: 1,
        startedAt: null,
        leaseExpiresAt: null,
        result: isDurable ? { durableTextOperation: state } : {},
      };
      const prisma = {
        aIJob: {
          findMany: jest.fn((query: Prisma.AIJobFindManyArgs) => {
            expect(query.where?.OR).toContainEqual({
              status: AIJobStatus.PENDING,
              AND: [
                {
                  result: {
                    path: ['durableTextOperation', 'revision'],
                    equals: DURABLE_TEXT_REVISION,
                  },
                },
                {
                  result: {
                    path: ['durableTextOperation', 'deadlineAt'],
                    lte: now.toISOString(),
                  },
                },
              ],
            });
            // No expired lease or reservation: only the durable JSON branch matches.
            return Promise.resolve(
              status === AIJobStatus.PENDING && isDurable && expired
                ? [job]
                : [],
            );
          }),
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
      };
      const ai = {
        runTextJob: jest
          .fn()
          .mockResolvedValue({ responseId: 'resp_existing' }),
        failJob: jest.fn().mockResolvedValue(undefined),
      };
      const usage = { reverseInTransaction: jest.fn() };
      const service = new AIRecoveryService(
        prisma as unknown as PrismaService,
        usage as unknown as UsageService,
        {} as EventService,
        ai as unknown as AIService,
      );
      await expect(service.recover(now)).resolves.toBe(expected);
      expect(ai.runTextJob).toHaveBeenCalledTimes(expected);
      if (expected) {
        expect(ai.runTextJob).toHaveBeenCalledWith(
          job.id,
          expect.objectContaining({
            input: '{}',
            pollWindowMs: 0,
            repairInput: expect.any(Function),
          }),
        );
        expect(ai.failJob).toHaveBeenCalledWith(job.id, expect.any(Error), {
          responseId: 'resp_existing',
        });
      }
      expect(usage.reverseInTransaction).not.toHaveBeenCalled();
      expect(job.attempts).toBe(1);
      expect(job.result).toEqual(
        isDurable ? { durableTextOperation: state } : {},
      );
    },
  );

  it('reselects an expired durable PENDING after a concurrent claim conflict', async () => {
    const now = new Date('2026-10-07T15:17:00Z');
    const result = {
      durableTextOperation: {
        revision: DURABLE_TEXT_REVISION,
        requestInput: '{}',
        executionContext: '{}',
        deadlineAt: new Date(now.getTime() - 1).toISOString(),
        attempts: [
          {
            attemptKey: 'root:attempt:1',
            phase: 'POLLING',
            responseId: 'resp_existing',
            usageRecorded: false,
            response: null,
          },
        ],
        repairInput: null,
        initialValidated: false,
        accountingIssue: null,
      },
    };
    const prisma = {
      aIJob: {
        findMany: jest.fn().mockResolvedValue([{ id: 'durable-job', result }]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const ai = {
      runTextJob: jest
        .fn()
        .mockRejectedValueOnce(new ConflictException('Concurrent claim'))
        .mockResolvedValueOnce({ responseId: 'resp_existing' }),
      failJob: jest.fn().mockResolvedValue(undefined),
    };
    const service = new AIRecoveryService(
      prisma as unknown as PrismaService,
      {} as UsageService,
      {} as EventService,
      ai as unknown as AIService,
    );
    await expect(service.recover(now)).resolves.toBe(1);
    expect(ai.failJob).not.toHaveBeenCalled();
    await expect(service.recover(now)).resolves.toBe(1);
    expect(ai.runTextJob).toHaveBeenCalledTimes(2);
    expect(ai.failJob).toHaveBeenCalledTimes(1);
  });
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
      {} as AIService,
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
          data: {
            status: AIJobStatus.PENDING,
            startedAt: null,
            leaseExpiresAt: null,
          },
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
  it('satisfies the PENDING lifecycle constraint without changing durable accounting', async () => {
    const now = new Date('2026-10-07T15:07:00Z');
    const original = {
      id: 'durable-job',
      status: AIJobStatus.PROCESSING,
      startedAt: new Date('2026-10-07T15:06:43.046Z'),
      leaseExpiresAt: new Date(now.getTime() - 1),
      completedAt: null,
      failedAt: null,
      error: null,
      attempts: 1,
      operationKey: 'durable-operation',
      promptVersionId: 'prompt-version',
      providerResponseId: 'resp_existing',
      result: {
        durableTextOperation: {
          revision: DURABLE_TEXT_REVISION,
          requestInput: '{}',
          executionContext: '{}',
          deadlineAt: new Date(now.getTime() + 60_000).toISOString(),
          attempts: [
            {
              attemptKey: 'root:attempt:1',
              phase: 'POLLING',
              responseId: 'resp_existing',
              usageRecorded: true,
              response: null,
            },
          ],
          repairInput: null,
          initialValidated: false,
          accountingIssue: null,
        },
      },
    };
    let row: Omit<
      typeof original,
      'status' | 'startedAt' | 'leaseExpiresAt'
    > & {
      status: AIJobStatus;
      startedAt: Date | null;
      leaseExpiresAt: Date | null;
    } = original;
    const prisma = {
      aIJob: {
        findMany: jest.fn().mockResolvedValue([original]),
        updateMany: jest.fn(
          (input: {
            data: {
              status: AIJobStatus;
              startedAt?: null;
              leaseExpiresAt: null;
            };
          }) => {
            const next = { ...row, ...input.data };
            if (
              next.status === AIJobStatus.PENDING &&
              (next.startedAt !== null ||
                next.completedAt !== null ||
                next.failedAt !== null ||
                next.error !== null)
            ) {
              throw new Error('23514: ai_jobs_lifecycle_check');
            }
            row = next;
            return Promise.resolve({ count: 1 });
          },
        ),
      },
    };
    const usage = { reverseInTransaction: jest.fn() };
    const event = { recordInTransaction: jest.fn() };
    const ai = { runTextJob: jest.fn(), failJob: jest.fn() };
    const recovery = new AIRecoveryService(
      prisma as unknown as PrismaService,
      usage as unknown as UsageService,
      event as unknown as EventService,
      ai as unknown as AIService,
    );
    await expect(recovery.recover(now)).resolves.toBe(1);
    expect(row).toEqual({
      ...original,
      status: AIJobStatus.PENDING,
      startedAt: null,
      leaseExpiresAt: null,
    });
    expect(row.result).toBe(original.result);
    expect(usage.reverseInTransaction).not.toHaveBeenCalled();
    expect(ai.runTextJob).not.toHaveBeenCalled();
    expect(ai.failJob).not.toHaveBeenCalled();
  });
});
