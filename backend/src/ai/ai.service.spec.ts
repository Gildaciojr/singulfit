import { ConfigService } from '@nestjs/config';
import { AIJobStatus, AIJobType, MessageType } from '@prisma/client';
import { ReservationService } from '../entitlements/reservation.service';
import { PrismaService } from '../prisma/prisma.service';
import { UsageService } from '../usage/usage.service';
import { AIUsageService } from './ai-usage.service';
import { AIService } from './ai.service';
import { OpenAIGateway } from './openai.gateway';
import { PromptService } from './prompt.service';
import { EventBusService } from '../event-bus/event-bus.service';

describe('AIService', () => {
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

  it('creates one standalone job after taking the operation lock', async () => {
    const createdJob = {
      id: 'diet-job-id',
      type: AIJobType.DIET,
      promptVersion: { id: 'prompt-id', prompt: 'Prompt' },
    };
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      aIJob: {
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
