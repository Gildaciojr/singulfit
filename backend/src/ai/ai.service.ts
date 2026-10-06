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
import type { CommercialUsageEntitlementCode } from '../entitlements/entitlement.constants';
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
import {
  durableTextOperation,
  DURABLE_TEXT_REVISION,
  DurableTextPendingError,
  type DurableTextOperation,
  type DurableValidationIssue,
} from './durable-text-operation.contract';

export interface CreateAIJobInput {
  userId: string;
  conversationId: string;
  messageId: string;
  type: AIJobType;
  promptName: string;
}

export interface CreateStandaloneAIJobInput {
  readonly userId: string;
  readonly type: AIJobType;
  readonly promptName: string;
  readonly operationKey?: string;
  readonly recoverExpiredOperation?: boolean;
  readonly usageEntitlementCode?: CommercialUsageEntitlementCode;
}

interface RunTextJobInput {
  input: string;
  jsonSchema?: OpenAIJsonSchema;
  timeoutMs?: number;
  /** Recovery workers perform one GET; interactive execution has a bounded poll window. */
  pollWindowMs?: number;
  /** Internal bounded repair under the original claim, never a second entitlement. */
  repairInput?: (initial: OpenAIResponseResult) => string | null;
  executionContext?: string;
  initialValidationIssues?: () => readonly DurableValidationIssue[];
}

export interface TextJobResponse extends OpenAIResponseResult {
  readonly providerAttempts?: readonly OpenAIResponseResult[];
  readonly providerCalls?: number;
  readonly durableTextOperation?: DurableTextOperation;
}

export class AITextOperationError extends Error {
  constructor(
    readonly operationCause: unknown,
    readonly response: TextJobResponse | undefined,
    readonly providerCalls: number,
  ) {
    super('Bounded text operation failed');
  }
}

interface RunVisionJobInput extends RunTextJobInput {
  imageUrl: string;
  expectedContext?: Pick<
    CreateAIJobInput,
    'userId' | 'conversationId' | 'messageId'
  >;
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
      AIJobType.TEXT,
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

      const recoverableJob =
        input.operationKey && input.recoverExpiredOperation
          ? await transaction.aIJob.findUnique({
              where: { operationKey: input.operationKey },
              include: { promptVersion: true },
            })
          : null;
      if (
        recoverableJob &&
        (recoverableJob.userId !== input.userId ||
          recoverableJob.type !== input.type ||
          recoverableJob.promptVersionId !== promptVersion.id)
      ) {
        throw new ConflictException(
          'Chave de operação de IA pertence a outro contexto',
        );
      }

      const expiredJobs = await transaction.aIJob.findMany({
        where: {
          userId: input.userId,
          type: input.type,
          ...(recoverableJob ? { id: { not: recoverableJob.id } } : {}),
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
        select: { id: true, type: true, result: true },
      });
      const staleJobs = expiredJobs.filter(
        (job) => !durableTextOperation(job.result),
      );
      await transaction.aIJob.updateMany({
        where: { id: { in: staleJobs.map((job) => job.id) } },
        data: {
          status: AIJobStatus.FAILED,
          failedAt: now,
          leaseExpiresAt: null,
          error: 'Job expirado antes da conclusão',
        },
      });
      for (const staleJob of staleJobs) {
        const usage =
          staleJob.type === AIJobType.WORKOUT
            ? this.boundedTextUsage(staleJob.result)
            : null;
        if (
          usage &&
          !(await transaction.aIUsage.findUnique({
            where: { aiJobId: staleJob.id },
          }))
        )
          await this.aiUsageService.recordInTransaction(transaction, {
            userId: input.userId,
            aiJobId: staleJob.id,
            jobType: AIJobType.WORKOUT,
            ...usage,
          });
        await this.usageService.reverseInTransaction(transaction, staleJob.id);
      }

      if (recoverableJob) {
        const abandonedProcessing =
          recoverableJob.status === AIJobStatus.PROCESSING &&
          (!recoverableJob.leaseExpiresAt ||
            recoverableJob.leaseExpiresAt <= now);
        if (
          recoverableJob.status === AIJobStatus.FAILED ||
          abandonedProcessing
        ) {
          const recovered = await transaction.aIJob.update({
            where: { id: recoverableJob.id },
            data: {
              status: AIJobStatus.PENDING,
              startedAt: null,
              leaseExpiresAt: null,
              providerResponseId: null,
              failedAt: null,
              error: null,
            },
            include: { promptVersion: true },
          });
          await this.reserveStandaloneUsage(transaction, input, recovered.id);
          return recovered;
        }
        if (recoverableJob.status !== AIJobStatus.COMPLETED) {
          await this.reserveStandaloneUsage(
            transaction,
            input,
            recoverableJob.id,
          );
        }
        return recoverableJob;
      }

      if (input.operationKey) {
        const existingJob = await transaction.aIJob.findUnique({
          where: {
            operationKey: input.operationKey,
          },
          include: {
            promptVersion: true,
          },
        });

        if (existingJob) {
          if (
            existingJob.userId !== input.userId ||
            existingJob.type !== input.type ||
            existingJob.promptVersionId !== promptVersion.id
          ) {
            throw new ConflictException(
              'Chave de operação de IA pertence a outro contexto',
            );
          }

          if (
            (existingJob.status === AIJobStatus.PENDING ||
              existingJob.status === AIJobStatus.PROCESSING) &&
            !durableTextOperation(existingJob.result)
          ) {
            await this.reserveStandaloneUsage(
              transaction,
              input,
              existingJob.id,
            );
          }
          return existingJob;
        }
      }

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

      const created = await transaction.aIJob.create({
        data: {
          userId: input.userId,
          type: input.type,
          promptVersionId: promptVersion.id,
          operationKey: input.operationKey,
        },
        include: {
          promptVersion: true,
        },
      });
      await this.reserveStandaloneUsage(transaction, input, created.id);
      return created;
    });
  }

  private async reserveStandaloneUsage(
    transaction: Prisma.TransactionClient,
    input: CreateStandaloneAIJobInput,
    aiJobId: string,
  ): Promise<void> {
    if (!input.usageEntitlementCode) return;
    await this.reservationService.reserveCommercialUsageInTransaction(
      transaction,
      {
        userId: input.userId,
        aiJobId,
        entitlementCode: input.usageEntitlementCode,
      },
    );
  }

  async runTextJob(
    aiJobId: string,
    request: RunTextJobInput,
  ): Promise<TextJobResponse> {
    const source = request.repairInput
      ? await this.prisma.aIJob.findUnique({ where: { id: aiJobId } })
      : null;
    const job = await this.claimJob(
      aiJobId,
      undefined,
      !!request.repairInput && !durableTextOperation(source?.result),
    );

    if (request.repairInput) return this.runDurableTextOperation(job, request);

    return this.openAIGateway.createTextResponse({
      instructions: job.promptVersion.prompt,
      input: request.input,
      requestId: job.id,
      jsonSchema: request.jsonSchema,
      timeoutMs: request.timeoutMs,
    });
  }

  private async runDurableTextOperation(
    job: Awaited<ReturnType<AIService['claimJob']>>,
    request: RunTextJobInput,
  ): Promise<TextJobResponse> {
    const state: DurableTextOperation = durableTextOperation(job.result) ?? {
      revision: DURABLE_TEXT_REVISION,
      requestInput: request.input,
      executionContext: request.executionContext ?? '{}',
      deadlineAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      attempts: [],
      repairInput: null,
      initialValidated: false,
      accountingIssue: null,
    };
    const epoch = { startedAt: job.startedAt, attempts: job.attempts };
    const fence = {
      id: job.id,
      userId: job.userId,
      status: AIJobStatus.PROCESSING,
      ...epoch,
    };
    const aggregate = (): TextJobResponse | undefined => {
      const responses = state.attempts
        .map((attempt) => attempt.response)
        .filter(
          (response): response is OpenAIResponseResult => response !== null,
        );
      const last = responses.at(-1);
      return last
        ? {
            ...last,
            promptTokens: responses.reduce(
              (sum, response) => sum + response.promptTokens,
              0,
            ),
            completionTokens: responses.reduce(
              (sum, response) => sum + response.completionTokens,
              0,
            ),
            totalTokens: responses.reduce(
              (sum, response) => sum + response.totalTokens,
              0,
            ),
            providerCalls: state.attempts.length,
            providerAttempts: responses,
            durableTextOperation: structuredClone(state),
          }
        : undefined;
    };
    const save = async (recordUsage = false) => {
      const usage = aggregate();
      if (recordUsage)
        for (const attempt of state.attempts)
          if (attempt.response) attempt.usageRecorded = true;
      try {
        await this.prisma.$transaction(async (transaction) => {
          const updated = await transaction.aIJob.updateMany({
            where: fence,
            data: {
              leaseExpiresAt: new Date(Date.now() + this.getLeaseMs()),
              result: JSON.parse(
                JSON.stringify({ durableTextOperation: state }),
              ) as Prisma.InputJsonObject,
            },
          });
          if (updated.count !== 1)
            throw new ConflictException('Durable text lease lost');
          if (recordUsage && usage)
            await this.aiUsageService.recordCumulativeInTransaction(
              transaction,
              {
                userId: job.userId,
                aiJobId: job.id,
                jobType: job.type,
                model: usage.model,
                promptTokens: usage.promptTokens,
                completionTokens: usage.completionTokens,
                totalTokens: usage.totalTokens,
              },
            );
        });
      } catch (error: unknown) {
        if (error instanceof ConflictException) throw error;
        // The atomic document/usage commit may have succeeded before its ACK.
        // Replay reads the persisted marker; never terminally discard this ledger.
        throw new DurableTextPendingError();
      }
    };
    const pause = async (): Promise<never> => {
      await this.prisma.aIJob.updateMany({
        where: fence,
        data: { leaseExpiresAt: new Date(0) },
      });
      throw new DurableTextPendingError();
    };
    const consume = async (
      index: 0 | 1,
      input: string,
    ): Promise<OpenAIResponseResult> => {
      let attempt = state.attempts[index];
      if (!attempt) {
        if (Date.now() >= Date.parse(state.deadlineAt))
          throw new ServiceUnavailableException(
            'Background operation deadline exceeded; generation blocked',
          );
        attempt = {
          attemptKey: `${job.operationKey ?? job.id}:attempt:${index + 1}`,
          phase: 'CREATING',
          responseId: null,
          usageRecorded: false,
          response: null,
          validationIssues: [],
        };
        state.attempts.push(attempt);
        await save();
        // X-Client-Request-Id is correlation, not documented create idempotency.
        // An unacknowledged create is never automatically recreated.
        attempt.responseId =
          await this.openAIGateway.startBackgroundTextResponse({
            instructions: job.promptVersion.prompt,
            input,
            requestId: attempt.attemptKey,
            ...(index === 1
              ? { expectedModel: state.attempts[0]?.response?.model }
              : {}),
            jsonSchema: request.jsonSchema,
            timeoutMs: Math.min(
              request.timeoutMs ?? 30_000,
              30_000,
              this.getLeaseMs() - 5_000,
            ),
          });
        attempt.phase = 'POLLING';
        await save();
      } else if (!attempt.responseId) {
        throw new ServiceUnavailableException(
          'Provider create outcome is ambiguous; automatic generation retry blocked',
        );
      }
      if (index === 1 && attempt.responseId === state.attempts[0]?.responseId)
        throw new ServiceUnavailableException(
          'Provider response identity reused across attempts',
        );
      const windowDeadline =
        Date.now() +
        Math.max(
          0,
          Math.min(
            request.pollWindowMs ?? 30_000,
            30_000,
            this.getLeaseMs() - 10_000,
          ),
        );
      let cancellationIssued = false;
      while (!attempt.response) {
        let retrieved;
        try {
          retrieved = await this.openAIGateway.retrieveTextResponse(
            attempt.responseId,
          );
        } catch {
          return pause();
        }
        if (
          retrieved.status === 'queued' ||
          retrieved.status === 'in_progress'
        ) {
          if (
            !cancellationIssued &&
            Date.now() >= Date.parse(state.deadlineAt)
          ) {
            try {
              await this.openAIGateway.cancelTextResponse(attempt.responseId);
              cancellationIssued = true;
            } catch {
              return pause();
            }
          }
          if (Date.now() >= windowDeadline) return pause();
          await new Promise<void>((resolve) => setTimeout(resolve, 500));
          continue;
        }
        attempt.phase =
          retrieved.status === 'completed' ? 'COMPLETED' : 'FAILED';
        attempt.response = retrieved.result ?? null;
        await save();
        if (!attempt.response)
          throw new ServiceUnavailableException(
            `Background response terminated: ${retrieved.status}`,
          );
      }
      const firstModel = state.attempts[0]?.response?.model;
      if (firstModel && attempt.response.model !== firstModel) {
        state.accountingIssue = 'MODEL_MISMATCH';
        await save();
        throw new ServiceUnavailableException(
          'Provider model mismatch; durable usage requires cost reconciliation',
        );
      }
      if (!attempt.usageRecorded) await save(true);
      if (attempt.phase === 'FAILED')
        throw new ServiceUnavailableException('Background response failed');
      return attempt.response;
    };
    try {
      if (state.accountingIssue)
        throw new ServiceUnavailableException(
          'Provider model mismatch; durable usage requires cost reconciliation',
        );
      const initial = await consume(0, state.requestInput);
      if (!state.initialValidated) {
        state.repairInput = request.repairInput?.(initial) ?? null;
        state.attempts[0].validationIssues =
          request.initialValidationIssues?.() ?? [];
        state.initialValidated = true;
        await save();
      }
      if (state.repairInput !== null) await consume(1, state.repairInput);
      const response = aggregate();
      if (!response)
        throw new ServiceUnavailableException('Durable response missing');
      return response;
    } catch (error: unknown) {
      if (
        error instanceof DurableTextPendingError ||
        error instanceof ConflictException
      )
        throw error;
      throw new AITextOperationError(error, aggregate(), state.attempts.length);
    }
  }

  async runVisionJob(
    aiJobId: string,
    request: RunVisionJobInput,
  ): Promise<OpenAIResponseResult> {
    const expected = request.expectedContext;
    if (expected) {
      const source = await this.prisma.aIJob.findUnique({
        where: { id: aiJobId },
      });
      if (
        !source ||
        source.id !== aiJobId ||
        source.userId !== expected.userId ||
        source.conversationId !== expected.conversationId ||
        source.messageId !== expected.messageId ||
        source.type !== AIJobType.IMAGE
      )
        throw new ConflictException('Vision AIJob ownership mismatch');
    }
    const job = await this.claimJob(aiJobId, expected);
    if (
      expected &&
      (job.id !== aiJobId ||
        job.userId !== expected.userId ||
        job.conversationId !== expected.conversationId ||
        job.messageId !== expected.messageId ||
        job.type !== AIJobType.IMAGE)
    )
      throw new ConflictException('Vision AIJob ownership mismatch');

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
      result?: Prisma.InputJsonValue;
    },
  ) {
    const usageInput = {
      userId: input.userId,
      aiJobId: input.aiJobId,
      jobType: input.jobType,
      model: input.response.model,
      promptTokens: input.response.promptTokens,
      completionTokens: input.response.completionTokens,
      totalTokens: input.response.totalTokens,
    };
    const usage =
      'providerAttempts' in input.response
        ? await this.aiUsageService.recordCumulativeInTransaction(
            transaction,
            usageInput,
          )
        : await this.aiUsageService.recordInTransaction(
            transaction,
            usageInput,
          );
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
        ...(input.result ? { result: input.result } : {}),
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
    expectedUserId?: string,
    failureResult?: Prisma.InputJsonValue,
  ): Promise<void> {
    const safeError = this.getSafeError(error);

    await this.prisma.$transaction(async (transaction) => {
      const job = await transaction.aIJob.findUnique({
        where: {
          id: aiJobId,
        },
      });

      if (
        job?.status === AIJobStatus.FAILED &&
        response &&
        'providerAttempts' in response &&
        expectedUserId === undefined
      ) {
        if (durableTextOperation(job.result)?.accountingIssue) return;
        await this.aiUsageService.recordCumulativeInTransaction(transaction, {
          userId: job.userId,
          aiJobId: job.id,
          jobType: job.type,
          model: response.model,
          promptTokens: response.promptTokens,
          completionTokens: response.completionTokens,
          totalTokens: response.totalTokens,
        });
        return;
      }
      if (
        !job ||
        job.id !== aiJobId ||
        (expectedUserId !== undefined &&
          (job.userId !== expectedUserId || job.type !== AIJobType.IMAGE)) ||
        (job.status !== AIJobStatus.PROCESSING &&
          !(
            expectedUserId !== undefined &&
            job.type === AIJobType.IMAGE &&
            job.status === AIJobStatus.PENDING
          ))
      ) {
        return;
      }

      if (response && !durableTextOperation(job.result)?.accountingIssue) {
        const usageInput = {
          userId: job.userId,
          aiJobId: job.id,
          jobType: job.type,
          model: response.model,
          promptTokens: response.promptTokens,
          completionTokens: response.completionTokens,
          totalTokens: response.totalTokens,
        };
        if ('providerAttempts' in response) {
          await this.aiUsageService.recordCumulativeInTransaction(
            transaction,
            usageInput,
          );
        } else {
          await this.aiUsageService.recordInTransaction(
            transaction,
            usageInput,
          );
        }
      }

      await transaction.aIJob.update({
        where: {
          id: job.id,
          ...(expectedUserId !== undefined
            ? {
                userId: expectedUserId,
                type: AIJobType.IMAGE,
                status: job.status,
              }
            : {}),
        },
        data: {
          status: AIJobStatus.FAILED,
          providerResponseId: response?.responseId,
          failedAt: new Date(),
          leaseExpiresAt: null,
          error: safeError,
          ...(failureResult !== undefined
            ? {
                result: durableTextOperation(job.result)
                  ? {
                      ...(typeof failureResult === 'object' &&
                      failureResult !== null &&
                      !Array.isArray(failureResult)
                        ? failureResult
                        : {}),
                      durableTextOperation: JSON.parse(
                        JSON.stringify(durableTextOperation(job.result)),
                      ) as Prisma.InputJsonObject,
                    }
                  : failureResult,
              }
            : {}),
        },
      });
      await this.usageService.reverseInTransaction(transaction, job.id);
    });
  }

  async failPendingJob(aiJobId: string, error: unknown): Promise<void> {
    await this.prisma.aIJob.updateMany({
      where: {
        id: aiJobId,
        type: AIJobType.TEXT,
        status: AIJobStatus.PENDING,
      },
      data: {
        status: AIJobStatus.FAILED,
        failedAt: new Date(),
        leaseExpiresAt: null,
        error: this.getSafeError(error),
      },
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

  private async claimJob(
    aiJobId: string,
    expected?: Pick<
      CreateAIJobInput,
      'userId' | 'conversationId' | 'messageId'
    >,
    firstClaimOnly = false,
  ) {
    const now = new Date();
    const leaseExpiresAt = new Date(now.getTime() + this.getLeaseMs());
    const claimed = await this.prisma.aIJob.updateMany({
      where: {
        id: aiJobId,
        ...(firstClaimOnly ? { attempts: 0 } : {}),
        ...(expected ? { ...expected, type: AIJobType.IMAGE } : {}),
        OR: [
          {
            status: AIJobStatus.PENDING,
          },
          ...(!firstClaimOnly
            ? [
                {
                  status: AIJobStatus.PROCESSING,
                  leaseExpiresAt: {
                    lte: now,
                  },
                },
              ]
            : []),
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

  private boundedTextUsage(
    result: Prisma.JsonValue | null,
  ): Pick<
    OpenAIResponseResult,
    'model' | 'promptTokens' | 'completionTokens' | 'totalTokens'
  > | null {
    if (
      !result ||
      typeof result !== 'object' ||
      Array.isArray(result) ||
      result.boundedTextOperation !== true
    )
      return null;
    const usage = result.aggregateUsage;
    if (
      !usage ||
      typeof usage !== 'object' ||
      Array.isArray(usage) ||
      typeof usage.model !== 'string' ||
      typeof usage.promptTokens !== 'number' ||
      typeof usage.completionTokens !== 'number' ||
      typeof usage.totalTokens !== 'number'
    )
      return null;
    return {
      model: usage.model,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      totalTokens: usage.totalTokens,
    };
  }
}
