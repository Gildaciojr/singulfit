import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AIJobStatus, AIJobType, MessageType, Prisma } from '@prisma/client';
import { ReservationService } from '../entitlements/reservation.service';
import { PrismaService } from '../prisma/prisma.service';
import { UsageService } from '../usage/usage.service';
import { EventBusService } from '../event-bus/event-bus.service';
import { INTERNAL_EVENT } from '../event-bus/event-bus.constants';
import { AIUsageService } from './ai-usage.service';
import {
  OpenAIJsonSchema,
  OpenAIResponseResult,
} from './interfaces/openai.interface';
import { OpenAIGateway } from './openai.gateway';
import { PromptService } from './prompt.service';

export interface CreateAIJobInput {
  userId: string;
  conversationId: string;
  messageId: string;
  type: AIJobType;
  promptName: string;
}

export interface CreateStandaloneAIJobInput {
  userId: string;
  type: AIJobType;
  promptName: string;
}

interface RunTextJobInput {
  input: string;
  jsonSchema?: OpenAIJsonSchema;
}

interface RunVisionJobInput extends RunTextJobInput {
  imageUrl: string;
}

@Injectable()
export class AIService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly promptService: PromptService,
    private readonly openAIGateway: OpenAIGateway,
    private readonly aiUsageService: AIUsageService,
    private readonly reservationService: ReservationService,
    private readonly usageService: UsageService,
    private readonly configService: ConfigService,
    private readonly eventBus: EventBusService,
  ) {}

  async createJob(input: CreateAIJobInput) {
    const [promptVersion, message] = await Promise.all([
      this.promptService.getActive(input.promptName),
      this.prisma.message.findUnique({
        where: {
          id: input.messageId,
        },
        include: {
          conversation: {
            select: {
              id: true,
              userId: true,
            },
          },
        },
      }),
    ]);

    if (!message) {
      throw new NotFoundException('Mensagem não encontrada');
    }

    if (
      message.conversationId !== input.conversationId ||
      message.conversation.userId !== input.userId
    ) {
      throw new BadRequestException(
        'Mensagem, conversa e usuário não correspondem',
      );
    }

    this.assertCompatibleType(input.type, message.type);

    const createJob = (client: PrismaService | Prisma.TransactionClient) =>
      client.aIJob.create({
        data: {
          userId: input.userId,
          conversationId: input.conversationId,
          messageId: input.messageId,
          type: input.type,
          promptVersionId: promptVersion.id,
        },
        include: {
          promptVersion: true,
        },
      });

    try {
      if (input.type !== AIJobType.IMAGE) {
        return await createJob(this.prisma);
      }

      return await this.prisma.$transaction(async (transaction) => {
        const job = await createJob(transaction);

        await this.reservationService.reserveImageAnalysisInTransaction(
          transaction,
          {
            userId: input.userId,
            aiJobId: job.id,
          },
        );

        return job;
      });
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const existingJob = await this.prisma.aIJob.findUnique({
          where: {
            messageId_type_promptVersionId: {
              messageId: input.messageId,
              type: input.type,
              promptVersionId: promptVersion.id,
            },
          },
          include: {
            promptVersion: true,
          },
        });

        if (existingJob) {
          return existingJob;
        }
      }

      throw error;
    }
  }

  async createStandaloneJob(input: CreateStandaloneAIJobInput) {
    const standaloneTypes = new Set<AIJobType>([
      AIJobType.DIET,
      AIJobType.WORKOUT,
      AIJobType.PROGRESS,
    ]);

    if (!standaloneTypes.has(input.type)) {
      throw new BadRequestException('Tipo de job não permitido sem conversa');
    }

    const promptVersion = await this.promptService.getActive(input.promptName);
    const now = new Date();
    const staleBefore = new Date(now.getTime() - this.getLeaseMs());

    return this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        WITH advisory_lock AS (
          SELECT pg_advisory_xact_lock(
            hashtext(${`ai:${input.type}:${input.userId}`})
          )
        )
        SELECT true AS "locked"
        FROM advisory_lock
      `;

      await transaction.aIJob.updateMany({
        where: {
          userId: input.userId,
          type: input.type,
          OR: [
            {
              status: AIJobStatus.PROCESSING,
              leaseExpiresAt: {
                lte: now,
              },
            },
            {
              status: AIJobStatus.PENDING,
              createdAt: {
                lte: staleBefore,
              },
            },
          ],
        },
        data: {
          status: AIJobStatus.FAILED,
          failedAt: now,
          leaseExpiresAt: null,
          error: 'Job expirado antes da conclusão',
        },
      });

      const activeJob = await transaction.aIJob.findFirst({
        where: {
          userId: input.userId,
          type: input.type,
          status: {
            in: [AIJobStatus.PENDING, AIJobStatus.PROCESSING],
          },
        },
        select: {
          id: true,
        },
      });

      if (activeJob) {
        throw new ConflictException('Já existe uma geração de IA em andamento');
      }

      return transaction.aIJob.create({
        data: {
          userId: input.userId,
          type: input.type,
          promptVersionId: promptVersion.id,
        },
        include: {
          promptVersion: true,
        },
      });
    });
  }

  async runTextJob(
    aiJobId: string,
    request: RunTextJobInput,
  ): Promise<OpenAIResponseResult> {
    const job = await this.claimJob(aiJobId);

    return this.openAIGateway.createTextResponse({
      instructions: job.promptVersion.prompt,
      input: request.input,
      requestId: job.id,
      jsonSchema: request.jsonSchema,
    });
  }

  async runVisionJob(
    aiJobId: string,
    request: RunVisionJobInput,
  ): Promise<OpenAIResponseResult> {
    const job = await this.claimJob(aiJobId);

    return this.openAIGateway.createVisionResponse({
      instructions: job.promptVersion.prompt,
      input: request.input,
      imageUrl: request.imageUrl,
      requestId: job.id,
      jsonSchema: request.jsonSchema,
    });
  }

  async completeJobInTransaction(
    transaction: Prisma.TransactionClient,
    input: {
      userId: string;
      aiJobId: string;
      jobType: AIJobType;
      response: OpenAIResponseResult;
    },
  ) {
    const usage = await this.aiUsageService.recordInTransaction(transaction, {
      userId: input.userId,
      aiJobId: input.aiJobId,
      jobType: input.jobType,
      model: input.response.model,
      promptTokens: input.response.promptTokens,
      completionTokens: input.response.completionTokens,
      totalTokens: input.response.totalTokens,
    });
    const completed = await transaction.aIJob.updateMany({
      where: {
        id: input.aiJobId,
        userId: input.userId,
        status: AIJobStatus.PROCESSING,
      },
      data: {
        status: AIJobStatus.COMPLETED,
        providerResponseId: input.response.responseId,
        completedAt: new Date(),
        leaseExpiresAt: null,
        error: null,
      },
    });

    if (completed.count !== 1) {
      throw new ConflictException(
        'Job de IA não está disponível para conclusão',
      );
    }

    await this.usageService.confirmInTransaction(transaction, input.aiJobId);
    await this.eventBus.publish(
      {
        eventType: INTERNAL_EVENT.AI_RESPONSE_GENERATED,
        aggregateType: 'AI_JOB',
        aggregateId: input.aiJobId,
        payload: {
          aiJobId: input.aiJobId,
          userId: input.userId,
          jobType: input.jobType,
          providerResponseId: input.response.responseId,
          model: input.response.model,
        },
      },
      transaction,
    );

    return usage;
  }

  async failJob(
    aiJobId: string,
    error: unknown,
    response?: OpenAIResponseResult,
  ): Promise<void> {
    const safeError = this.getSafeError(error);

    await this.prisma.$transaction(async (transaction) => {
      const job = await transaction.aIJob.findUnique({
        where: {
          id: aiJobId,
        },
      });

      if (!job || job.status !== AIJobStatus.PROCESSING) {
        return;
      }

      if (response) {
        await this.aiUsageService.recordInTransaction(transaction, {
          userId: job.userId,
          aiJobId: job.id,
          jobType: job.type,
          model: response.model,
          promptTokens: response.promptTokens,
          completionTokens: response.completionTokens,
          totalTokens: response.totalTokens,
        });
      }

      await transaction.aIJob.update({
        where: {
          id: job.id,
        },
        data: {
          status: AIJobStatus.FAILED,
          providerResponseId: response?.responseId,
          failedAt: new Date(),
          leaseExpiresAt: null,
          error: safeError,
        },
      });
      await this.usageService.reverseInTransaction(transaction, job.id);
    });
  }

  async executeTextJob(aiJobId: string) {
    const job = await this.prisma.aIJob.findUnique({
      where: {
        id: aiJobId,
      },
      include: {
        promptVersion: true,
        message: true,
      },
    });

    if (!job) {
      throw new NotFoundException('Job de IA não encontrado');
    }

    if (job.type !== AIJobType.TEXT || !job.message) {
      throw new BadRequestException(
        'Apenas jobs de texto podem ser executados neste bloco',
      );
    }

    try {
      const response = await this.runTextJob(job.id, {
        input: job.message.content,
      });
      const result = await this.prisma.$transaction(async (transaction) => {
        const usage = await this.completeJobInTransaction(transaction, {
          userId: job.userId,
          aiJobId: job.id,
          jobType: job.type,
          response,
        });
        const completedJob = await transaction.aIJob.findUniqueOrThrow({
          where: { id: job.id },
          include: { promptVersion: true },
        });

        return {
          job: completedJob,
          usage,
        };
      });

      return {
        ...result,
        outputText: response.outputText,
      };
    } catch (error: unknown) {
      await this.failJob(job.id, error);

      throw error;
    }
  }

  async getJob(aiJobId: string) {
    const job = await this.prisma.aIJob.findUnique({
      where: {
        id: aiJobId,
      },
      include: {
        promptVersion: true,
        usage: {
          orderBy: {
            createdAt: 'asc',
          },
        },
      },
    });

    if (!job) {
      throw new NotFoundException('Job de IA não encontrado');
    }

    return job;
  }

  private assertCompatibleType(jobType: AIJobType, messageType: MessageType) {
    const expectedMessageType: Partial<Record<AIJobType, MessageType>> = {
      [AIJobType.TEXT]: MessageType.TEXT,
      [AIJobType.IMAGE]: MessageType.IMAGE,
      [AIJobType.AUDIO]: MessageType.AUDIO,
    };

    if (
      expectedMessageType[jobType] === undefined ||
      messageType !== expectedMessageType[jobType]
    ) {
      throw new BadRequestException(
        'O tipo do job não corresponde ao tipo da mensagem',
      );
    }
  }

  private getSafeError(error: unknown): string {
    if (error instanceof Error && error.message.trim()) {
      return error.message.trim().slice(0, 2_000);
    }

    return 'Falha não identificada no processamento de IA';
  }

  private async claimJob(aiJobId: string) {
    const now = new Date();
    const leaseExpiresAt = new Date(now.getTime() + this.getLeaseMs());
    const claimed = await this.prisma.aIJob.updateMany({
      where: {
        id: aiJobId,
        OR: [
          {
            status: AIJobStatus.PENDING,
          },
          {
            status: AIJobStatus.PROCESSING,
            leaseExpiresAt: {
              lte: now,
            },
          },
        ],
      },
      data: {
        status: AIJobStatus.PROCESSING,
        startedAt: now,
        leaseExpiresAt,
        attempts: {
          increment: 1,
        },
        failedAt: null,
        error: null,
      },
    });

    if (claimed.count !== 1) {
      throw new ConflictException('Job de IA já processado ou em andamento');
    }

    return this.prisma.aIJob.findUniqueOrThrow({
      where: {
        id: aiJobId,
      },
      include: {
        promptVersion: true,
      },
    });
  }

  private getLeaseMs(): number {
    const seconds = Number.parseInt(
      this.configService.get<string>('AI_JOB_LEASE_SECONDS', '120'),
      10,
    );

    if (!Number.isInteger(seconds) || seconds < 30 || seconds > 3600) {
      throw new ServiceUnavailableException(
        'AI_JOB_LEASE_SECONDS possui valor inválido',
      );
    }

    return seconds * 1_000;
  }
}
