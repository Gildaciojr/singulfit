import { ConfigService } from '@nestjs/config';
import { AIJobStatus, AIJobType, MessageType, Prisma } from '@prisma/client';
import { ReservationService } from '../entitlements/reservation.service';
import { PrismaService } from '../prisma/prisma.service';
import { UsageService } from '../usage/usage.service';
import { AIUsageService } from './ai-usage.service';
import { AIService } from './ai.service';
import { OpenAIGateway } from './openai.gateway';
import { PromptService } from './prompt.service';
import { EventBusService } from '../event-bus/event-bus.service';

describe('AIService', () => {
  it.each(['before', 'after'] as const)(
    'rejects a foreign Vision job %s claim before gateway',
    async (phase) => {
      const owned = {
        id: 'job-id',
        userId: 'user-a',
        conversationId: 'conversation-id',
        messageId: 'message-id',
        type: AIJobType.IMAGE,
        promptVersion: { prompt: 'Vision prompt' },
      };
      const foreign = { ...owned, userId: 'user-b' };
      const prisma = {
        aIJob: {
          findUnique: jest
            .fn()
            .mockResolvedValue(phase === 'before' ? foreign : owned),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          findUniqueOrThrow: jest.fn().mockResolvedValue(foreign),
        },
      };
      const gateway = { createVisionResponse: jest.fn() };
      const service = createService({ prisma, gateway });
      await expect(
        service.runVisionJob('job-id', {
          input: 'user-a context',
          imageUrl: 'data:image/jpeg;base64,AA==',
          expectedContext: {
            userId: 'user-a',
            conversationId: 'conversation-id',
            messageId: 'message-id',
          },
        }),
      ).rejects.toThrow('ownership mismatch');
      expect(gateway.createVisionResponse).not.toHaveBeenCalled();
      if (phase === 'before')
        expect(prisma.aIJob.updateMany).not.toHaveBeenCalled();
      else
        expect(prisma.aIJob.updateMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              userId: 'user-a',
              conversationId: 'conversation-id',
              messageId: 'message-id',
              type: AIJobType.IMAGE,
            }),
          }),
        );
    },
  );
  function createService(options: {
    prisma: Record<string, unknown>;
    promptService?: Record<string, unknown>;
    gateway?: Record<string, unknown>;
    aiUsageService?: Record<string, unknown>;
    reservationService?: Record<string, unknown>;
    usageService?: Record<string, unknown>;
  }) {
    return new AIService(
      options.prisma as unknown as PrismaService,
      (options.promptService ?? {}) as unknown as PromptService,
      (options.gateway ?? {}) as unknown as OpenAIGateway,
      (options.aiUsageService ?? {}) as unknown as AIUsageService,
      (options.reservationService ?? {}) as unknown as ReservationService,
      (options.usageService ?? {
        confirmInTransaction: jest.fn(),
        reverseInTransaction: jest.fn(),
      }) as unknown as UsageService,
      {
        get: jest.fn().mockReturnValue('120'),
      } as unknown as ConfigService,
      {
        publish: jest.fn(),
      } as unknown as EventBusService,
    );
  }

  it.each([AIJobStatus.PENDING, AIJobStatus.PROCESSING])(
    'reverses an owned rejected IMAGE reservation once from %s',
    async (status) => {
      const job = {
        id: 'job-id',
        userId: 'user-a',
        type: AIJobType.IMAGE,
        status: status as AIJobStatus,
      };
      const tx = {
        aIJob: {
          findUnique: jest.fn().mockResolvedValue(job),
          update: jest.fn().mockImplementation(() => {
            job.status = AIJobStatus.FAILED;
            return Promise.resolve(job);
          }),
        },
      };
      const usageService = {
        reverseInTransaction: jest.fn(),
        confirmInTransaction: jest.fn(),
      };
      const service = createService({
        prisma: {
          $transaction: async (
            operation: (client: typeof tx) => Promise<void>,
          ) => operation(tx),
        },
        usageService,
      });
      await service.failJob(
        'job-id',
        new Error('ownership mismatch'),
        undefined,
        'user-a',
      );
      await service.failJob('job-id', new Error('retry'), undefined, 'user-a');
      expect(usageService.reverseInTransaction).toHaveBeenCalledTimes(1);
      expect(usageService.reverseInTransaction).toHaveBeenCalledWith(
        tx,
        'job-id',
      );
      expect(usageService.confirmInTransaction).not.toHaveBeenCalled();
    },
  );

  it('does not mutate or reverse a foreign IMAGE job returned during rejection', async () => {
    const tx = {
      aIJob: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'job-id',
          userId: 'user-b',
          type: AIJobType.IMAGE,
          status: AIJobStatus.PROCESSING,
        }),
        update: jest.fn(),
      },
    };
    const usageService = { reverseInTransaction: jest.fn() };
    const service = createService({
      prisma: {
        $transaction: async (operation: (client: typeof tx) => Promise<void>) =>
          operation(tx),
      },
      usageService,
    });
    await service.failJob(
      'job-id',
      new Error('ownership mismatch'),
      undefined,
      'user-a',
    );
    expect(tx.aIJob.update).not.toHaveBeenCalled();
    expect(usageService.reverseInTransaction).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'fails a Workout job once with explicit diagnostic=%s',
    async (withDiagnostic) => {
      const diagnostic: Prisma.InputJsonValue = {
        candidateOutput: '  {"sessions": []}\n',
        model: 'model',
        rejection: {
          stage: 'POST_GENERATION_VALIDATION',
          issues: [
            {
              code: 'TIMED_DURATION_IMPOSSIBLE',
              severity: 'ERROR',
              path: 'activity',
            },
          ],
        },
      };
      const job = {
        id: 'job-id',
        userId: 'user-id',
        type: AIJobType.WORKOUT,
        status: AIJobStatus.PROCESSING as AIJobStatus,
        result: null as Prisma.InputJsonValue | null,
      };
      const tx = {
        aIJob: {
          findUnique: jest.fn().mockResolvedValue(job),
          update: jest
            .fn()
            .mockImplementation(
              (input: {
                data: { status: AIJobStatus; result?: Prisma.InputJsonValue };
              }) => {
                job.status = input.data.status;
                if (input.data.result !== undefined)
                  job.result = input.data.result;
                return Promise.resolve(job);
              },
            ),
        },
      };
      const aiUsageService = {
        recordInTransaction: jest.fn().mockResolvedValue({ id: 'usage' }),
      };
      const usageService = {
        reverseInTransaction: jest.fn(),
        confirmInTransaction: jest.fn(),
      };
      const service = createService({
        prisma: {
          $transaction: async (
            callback: (client: typeof tx) => Promise<void>,
          ) => callback(tx),
        },
        aiUsageService,
        usageService,
      });
      const response = {
        responseId: 'provider-response',
        model: 'model',
        outputText: '  {"sessions": []}\n',
        promptTokens: 10,
        completionTokens: 20,
        totalTokens: 30,
      };
      await service.failJob(
        job.id,
        new Error('candidate rejected'),
        response,
        undefined,
        withDiagnostic ? diagnostic : undefined,
      );
      await service.failJob(
        job.id,
        new Error('duplicate failure'),
        response,
        undefined,
        withDiagnostic ? diagnostic : undefined,
      );
      expect(job.status).toBe(AIJobStatus.FAILED);
      expect(job.result).toEqual(withDiagnostic ? diagnostic : null);
      const update = tx.aIJob.update.mock.calls[0][0];
      expect(update.data).toMatchObject({
        status: AIJobStatus.FAILED,
        providerResponseId: 'provider-response',
        error: expect.stringContaining('candidate rejected'),
        leaseExpiresAt: null,
      });
      if (withDiagnostic) expect(update.data.result).toEqual(diagnostic);
      else expect(update.data).not.toHaveProperty('result');
      expect(tx.aIJob.update).toHaveBeenCalledTimes(1);
      expect(aiUsageService.recordInTransaction).toHaveBeenCalledTimes(1);
      expect(aiUsageService.recordInTransaction).toHaveBeenCalledWith(tx, {
        userId: 'user-id',
        aiJobId: 'job-id',
        jobType: AIJobType.WORKOUT,
        model: 'model',
        promptTokens: 10,
        completionTokens: 20,
        totalTokens: 30,
      });
      expect(usageService.reverseInTransaction).toHaveBeenCalledTimes(1);
      expect(usageService.reverseInTransaction).toHaveBeenCalledWith(
        tx,
        job.id,
      );
      expect(usageService.confirmInTransaction).not.toHaveBeenCalled();
    },
  );

  it.each([AIJobType.TEXT, AIJobType.IMAGE, AIJobType.DIET])(
    'leaves an existing %s result unchanged when no failureResult is supplied',
    async (type) => {
      const result = { existing: 'preserved' };
      const job = {
        id: 'job-id',
        userId: 'user-id',
        type,
        status: AIJobStatus.PROCESSING,
        result,
      };
      const tx = {
        aIJob: {
          findUnique: jest.fn().mockResolvedValue(job),
          update: jest.fn().mockResolvedValue(job),
        },
      };
      const aiUsageService = { recordInTransaction: jest.fn() };
      const usageService = { reverseInTransaction: jest.fn() };
      const service = createService({
        prisma: {
          $transaction: async (
            callback: (client: typeof tx) => Promise<void>,
          ) => callback(tx),
        },
        aiUsageService,
        usageService,
      });
      await service.failJob(job.id, new Error('traditional failure'));
      expect(tx.aIJob.update.mock.calls[0][0].data).not.toHaveProperty(
        'result',
      );
      expect(job.result).toBe(result);
      expect(aiUsageService.recordInTransaction).not.toHaveBeenCalled();
      expect(usageService.reverseInTransaction).toHaveBeenCalledWith(
        tx,
        job.id,
      );
    },
  );

  it('creates one standalone job after taking the operation lock', async () => {
    const createdJob = {
      id: 'diet-job-id',
      type: AIJobType.DIET,
      promptVersion: { id: 'prompt-id', prompt: 'Prompt' },
    };
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      aIJob: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(createdJob),
      },
    };
    const prisma = {
      $transaction: jest.fn(
        (callback: (client: typeof transaction) => unknown) =>
          callback(transaction),
      ),
    };
    const service = createService({
      prisma,
      promptService: {
        getActive: jest
          .fn()
          .mockResolvedValue({ id: 'prompt-id', prompt: 'Prompt' }),
      },
    });

    await expect(
      service.createStandaloneJob({
        userId: 'user-id',
        type: AIJobType.DIET,
        promptName: 'diet_generation_weight_loss',
      }),
    ).resolves.toBe(createdJob);
    expect(transaction.$queryRaw).toHaveBeenCalled();
    expect(transaction.aIJob.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 'user-id',
          type: AIJobType.DIET,
        }),
      }),
    );
  });

  it('explicitly allows a standalone text job for proactive realization', async () => {
    const createdJob = {
      id: 'text-job-id',
      type: AIJobType.TEXT,
      promptVersion: { id: 'prompt-id', prompt: 'Prompt' },
    };
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      aIJob: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(createdJob),
      },
    };
    const service = createService({
      prisma: {
        $transaction: jest.fn(
          (callback: (client: typeof transaction) => unknown) =>
            callback(transaction),
        ),
      },
      promptService: {
        getActive: jest
          .fn()
          .mockResolvedValue({ id: 'prompt-id', prompt: 'Prompt' }),
      },
    });

    await expect(
      service.createStandaloneJob({
        userId: 'user-id',
        type: AIJobType.TEXT,
        promptName: 'coach_proactive_outreach',
      }),
    ).resolves.toBe(createdJob);
  });

  it('creates an idempotent message job and reserves image quota atomically', async () => {
    const createdJob = {
      id: 'image-job-id',
      type: AIJobType.IMAGE,
    };
    const transaction = {
      aIJob: {
        create: jest.fn().mockResolvedValue(createdJob),
      },
    };
    const reservationService = {
      reserveImageAnalysisInTransaction: jest.fn().mockResolvedValue([]),
    };
    const prisma = {
      message: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'message-id',
          type: MessageType.IMAGE,
          conversationId: 'conversation-id',
          conversation: { userId: 'user-id' },
        }),
      },
      $transaction: jest.fn(
        (callback: (client: typeof transaction) => unknown) =>
          callback(transaction),
      ),
    };
    const service = createService({
      prisma,
      promptService: {
        getActive: jest.fn().mockResolvedValue({ id: 'prompt-id' }),
      },
      reservationService,
    });

    await service.createJob({
      userId: 'user-id',
      conversationId: 'conversation-id',
      messageId: 'message-id',
      type: AIJobType.IMAGE,
      promptName: 'nutrition',
    });

    expect(
      reservationService.reserveImageAnalysisInTransaction,
    ).toHaveBeenCalledWith(transaction, {
      userId: 'user-id',
      aiJobId: 'image-job-id',
    });
  });

  it('fails only pending text jobs through the read-only Q&A helper', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const service = createService({ prisma: { aIJob: { updateMany } } });

    await service.failPendingJob('text-job-id', new Error('deadline'));

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'text-job-id',
          type: AIJobType.TEXT,
          status: AIJobStatus.PENDING,
        },
      }),
    );
  });

  it('claims, executes, accounts and completes a text job', async () => {
    const job = {
      id: 'job-id',
      userId: 'user-id',
      type: AIJobType.TEXT,
      status: AIJobStatus.PENDING,
      promptVersion: { prompt: 'Prompt base' },
      message: { content: 'Mensagem do usuário' },
    };
    const completedJob = { ...job, status: AIJobStatus.COMPLETED };
    const transaction = {
      aIJob: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue(completedJob),
      },
    };
    const prisma = {
      aIJob: {
        findUnique: jest.fn().mockResolvedValue(job),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue(job),
      },
      $transaction: jest.fn(
        (callback: (client: typeof transaction) => unknown) =>
          callback(transaction),
      ),
    };
    const aiUsageService = {
      recordInTransaction: jest.fn().mockResolvedValue({ id: 'usage-id' }),
    };
    const usageService = {
      confirmInTransaction: jest.fn().mockResolvedValue([]),
      reverseInTransaction: jest.fn().mockResolvedValue([]),
    };
    const service = createService({
      prisma,
      gateway: {
        createTextResponse: jest.fn().mockResolvedValue({
          responseId: 'response-id',
          model: 'text-model',
          outputText: 'Resposta gerada',
          promptTokens: 100,
          completionTokens: 25,
          totalTokens: 125,
        }),
      },
      aiUsageService,
      usageService,
    });

    await expect(service.executeTextJob('job-id')).resolves.toEqual({
      job: completedJob,
      usage: { id: 'usage-id' },
      outputText: 'Resposta gerada',
    });
    expect(prisma.aIJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: AIJobStatus.PROCESSING,
          leaseExpiresAt: expect.any(Date),
        }),
      }),
    );
    expect(usageService.confirmInTransaction).toHaveBeenCalledWith(
      transaction,
      'job-id',
    );
  });

  it('fails and releases a claimed job when the provider rejects it', async () => {
    const job = {
      id: 'job-id',
      userId: 'user-id',
      type: AIJobType.TEXT,
      status: AIJobStatus.PROCESSING,
      promptVersion: { prompt: 'Prompt base' },
      message: { content: 'Mensagem' },
    };
    const transaction = {
      aIJob: {
        findUnique: jest.fn().mockResolvedValue(job),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const prisma = {
      aIJob: {
        findUnique: jest.fn().mockResolvedValue({
          ...job,
          status: AIJobStatus.PENDING,
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue(job),
      },
      $transaction: jest.fn(
        (callback: (client: typeof transaction) => unknown) =>
          callback(transaction),
      ),
    };
    const usageService = {
      confirmInTransaction: jest.fn(),
      reverseInTransaction: jest.fn().mockResolvedValue([]),
    };
    const service = createService({
      prisma,
      gateway: {
        createTextResponse: jest
          .fn()
          .mockRejectedValue(new Error('Falha segura da OpenAI')),
      },
      usageService,
    });

    await expect(service.executeTextJob('job-id')).rejects.toThrow(
      'Falha segura da OpenAI',
    );
    expect(transaction.aIJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: AIJobStatus.FAILED,
          leaseExpiresAt: null,
        }),
      }),
    );
    expect(usageService.reverseInTransaction).toHaveBeenCalledWith(
      transaction,
      'job-id',
    );
  });
});
