import { Injectable, Logger, ConflictException } from '@nestjs/common';
import {
  AIJobStatus,
  AIJobType,
  OutboxStatus,
  MealAnalysisStatus,
  Severity,
  UsageEventStatus,
} from '@prisma/client';
import { WORKER_NAME } from '../event-bus/event-bus.constants';
import { EventService } from '../observability/event.service';
import { PrismaService } from '../prisma/prisma.service';
import { UsageService } from '../usage/usage.service';
import {
  durableTextOperation,
  DurableTextPendingError,
  DURABLE_TEXT_REVISION,
} from './durable-text-operation.contract';
import { AIService, AITextOperationError } from './ai.service';
import { workoutDurableContinuation } from '../workout/v2/execution/workout-durable-continuation.contract';

const RECOVERY_BATCH_SIZE = 100;

@Injectable()
export class AIRecoveryService {
  private readonly logger = new Logger(AIRecoveryService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly usageService: UsageService,
    private readonly eventService: EventService,
    private readonly aiService: AIService,
  ) {}

  async recover(at = new Date()): Promise<number> {
    if (this.running) {
      return 0;
    }

    this.running = true;

    try {
      const jobs = await this.prisma.aIJob.findMany({
        where: {
          OR: [
            {
              status: AIJobStatus.PENDING,
              type: AIJobType.WORKOUT,
              result: {
                path: ['durableTextOperation', 'revision'],
                equals: DURABLE_TEXT_REVISION,
              },
            },
            {
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
                    lte: at.toISOString(),
                  },
                },
              ],
            },
            {
              status: AIJobStatus.PROCESSING,
              leaseExpiresAt: {
                lte: at,
              },
            },
            {
              status: {
                in: [AIJobStatus.PENDING, AIJobStatus.PROCESSING],
              },
              usageEvents: {
                some: {
                  status: UsageEventStatus.RESERVED,
                  expiresAt: {
                    lte: at,
                  },
                },
              },
            },
          ],
        },
        select: {
          id: true,
          result: true,
          type: true,
        },
        orderBy: {
          createdAt: 'asc',
        },
        take: RECOVERY_BATCH_SIZE,
      });

      const recoveryDeadline = Date.now() + 30_000;
      let processed = 0;
      for (const job of jobs) {
        if (Date.now() >= recoveryDeadline) break;
        processed += 1;
        const durable = durableTextOperation(job.result);
        if (durable) {
          // Keep the provider ledger/reservation: replay retrieves the same Responses.
          await this.prisma.aIJob.updateMany({
            where: {
              id: job.id,
              status: AIJobStatus.PROCESSING,
              leaseExpiresAt: { lte: at },
            },
            data: {
              status: AIJobStatus.PENDING,
              startedAt: null,
              leaseExpiresAt: null,
            },
          });
          if (
            job.type === AIJobType.WORKOUT &&
            workoutDurableContinuation(job.result)
          ) {
            const event = await this.aiService.enqueueWorkoutCompletion(job.id);
            if (event?.status === OutboxStatus.DEAD_LETTER)
              await this.failExhaustedWorkout(job.id, event.id);
            continue;
          }
          if (Date.parse(durable.deadlineAt) <= at.getTime()) {
            try {
              const response = await this.aiService.runTextJob(job.id, {
                input: durable.requestInput,
                executionContext: durable.executionContext,
                pollWindowMs: 0,
                repairInput: () =>
                  durable.initialValidated ? durable.repairInput : null,
              });
              await this.aiService.failJob(
                job.id,
                new Error('Durable operation recovery deadline exceeded'),
                response,
              );
            } catch (error: unknown) {
              if (
                !(error instanceof DurableTextPendingError) &&
                !(error instanceof ConflictException)
              )
                await this.aiService.failJob(
                  job.id,
                  error instanceof AITextOperationError
                    ? error.operationCause
                    : error,
                  error instanceof AITextOperationError
                    ? error.response
                    : undefined,
                );
            }
          }
        } else {
          await this.recoverJob(job.id, at);
        }
      }

      return processed;
    } catch (error: unknown) {
      this.logger.error(
        'Falha ao recuperar jobs de IA expirados',
        error instanceof Error ? error.stack : undefined,
      );
      return 0;
    } finally {
      this.running = false;
    }
  }

  private async failExhaustedWorkout(
    aiJobId: string,
    eventId: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const event = await transaction.outboxEvent.findUnique({
        where: { id: eventId },
      });
      if (event?.status !== OutboxStatus.DEAD_LETTER) return;
      const changed = await transaction.aIJob.updateMany({
        where: {
          id: aiJobId,
          type: AIJobType.WORKOUT,
          status: AIJobStatus.PENDING,
        },
        data: {
          status: AIJobStatus.FAILED,
          startedAt: new Date(),
          failedAt: new Date(),
          leaseExpiresAt: null,
          error: 'Workout continuation exhausted the Outbox retry policy',
        },
      });
      if (changed.count === 1)
        await this.usageService.reverseInTransaction(transaction, aiJobId);
    });
  }

  private async recoverJob(aiJobId: string, at: Date): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const changed = await transaction.aIJob.updateMany({
        where: {
          id: aiJobId,
          status: {
            in: [AIJobStatus.PENDING, AIJobStatus.PROCESSING],
          },
        },
        data: {
          status: AIJobStatus.FAILED,
          failedAt: at,
          leaseExpiresAt: null,
          error: 'Job recuperado após expiração do lease',
        },
      });

      if (changed.count !== 1) {
        return;
      }

      await transaction.mealAnalysis.updateMany({
        where: {
          aiJobId,
          status: MealAnalysisStatus.PROCESSING,
        },
        data: {
          status: MealAnalysisStatus.FAILED,
          error: 'Análise recuperada após expiração do lease',
        },
      });
      await this.usageService.reverseInTransaction(transaction, aiJobId);
      await this.eventService.recordInTransaction(transaction, {
        source: WORKER_NAME.AI,
        severity: Severity.WARNING,
        eventType: 'LEASE_EXPIRED',
        message: 'Job de IA recuperado após expiração do lease',
        metadata: {
          aiJobId,
        },
      });
    });
  }
}
