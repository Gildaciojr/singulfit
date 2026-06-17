import { Injectable } from '@nestjs/common';
import { Prisma, Severity, WorkerStatus } from '@prisma/client';
import { EventService } from '../observability/event.service';
import { PrismaService } from '../prisma/prisma.service';
import { WorkerName } from '../event-bus/event-bus.constants';

export const WORKER_SYSTEM_EVENT = {
  STARTED: 'WORKER_STARTED',
  STOPPED: 'WORKER_STOPPED',
} as const;

@Injectable()
export class WorkerHeartbeatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventService: EventService,
  ) {}

  async start(
    workerName: WorkerName,
    instanceId: string,
    metadata: Prisma.InputJsonObject,
    at = new Date(),
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await transaction.workerHeartbeat.upsert({
        where: {
          workerName_instanceId: {
            workerName,
            instanceId,
          },
        },
        update: {
          status: WorkerStatus.RUNNING,
          startedAt: at,
          heartbeatAt: at,
          stoppedAt: null,
          metadata,
        },
        create: {
          workerName,
          instanceId,
          status: WorkerStatus.RUNNING,
          startedAt: at,
          heartbeatAt: at,
          metadata,
        },
      });
      await this.eventService.recordInTransaction(transaction, {
        source: workerName,
        severity: Severity.INFO,
        eventType: WORKER_SYSTEM_EVENT.STARTED,
        message: 'Worker iniciado',
        metadata: {
          instanceId,
          ...metadata,
        },
      });
    });
  }

  async beat(
    workerName: WorkerName,
    instanceId: string,
    at = new Date(),
  ): Promise<void> {
    await this.prisma.workerHeartbeat.updateMany({
      where: {
        workerName,
        instanceId,
        status: WorkerStatus.RUNNING,
      },
      data: {
        heartbeatAt: at,
      },
    });
  }

  async stop(
    workerName: WorkerName,
    instanceId: string,
    at = new Date(),
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await transaction.workerHeartbeat.updateMany({
        where: {
          workerName,
          instanceId,
        },
        data: {
          status: WorkerStatus.STOPPED,
          heartbeatAt: at,
          stoppedAt: at,
        },
      });
      await this.eventService.recordInTransaction(transaction, {
        source: workerName,
        severity: Severity.INFO,
        eventType: WORKER_SYSTEM_EVENT.STOPPED,
        message: 'Worker finalizado',
        metadata: {
          instanceId,
        },
      });
    });
  }
}
