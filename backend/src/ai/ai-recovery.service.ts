import { Injectable, Logger } from '@nestjs/common';
import {
  AIJobStatus,
  MealAnalysisStatus,
  Severity,
  UsageEventStatus,
} from '@prisma/client';
import { WORKER_NAME } from '../event-bus/event-bus.constants';
import { EventService } from '../observability/event.service';
import { PrismaService } from '../prisma/prisma.service';
import { UsageService } from '../usage/usage.service';

const RECOVERY_BATCH_SIZE = 100;

@Injectable()
export class AIRecoveryService {
  private readonly logger = new Logger(AIRecoveryService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly usageService: UsageService,
    private readonly eventService: EventService,
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
        },
        orderBy: {
          createdAt: 'asc',
        },
        take: RECOVERY_BATCH_SIZE,
      });

      for (const job of jobs) {
        await this.recoverJob(job.id, at);
      }

      return jobs.length;
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
