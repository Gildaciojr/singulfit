import { Prisma, Severity, WorkerStatus } from '@prisma/client';
import { EventService } from '../observability/event.service';
import { PrismaService } from '../prisma/prisma.service';
import { WORKER_NAME } from '../event-bus/event-bus.constants';
import {
  WORKER_SYSTEM_EVENT,
  WorkerHeartbeatService,
} from './worker-heartbeat.service';

describe('WorkerHeartbeatService', () => {
  it('persists lifecycle state and system events', async () => {
    const transaction = {
      workerHeartbeat: {
        upsert: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const prisma = {
      $transaction: jest.fn(
        (operation: (client: typeof transaction) => unknown) =>
          operation(transaction),
      ),
      workerHeartbeat: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const eventService = {
      recordInTransaction: jest.fn().mockResolvedValue({}),
    };
    const service = new WorkerHeartbeatService(
      prisma as unknown as PrismaService,
      eventService as unknown as EventService,
    );
    const startedAt = new Date('2026-06-10T12:00:00.000Z');
    const metadata: Prisma.InputJsonObject = {
      pid: 123,
    };

    await service.start(WORKER_NAME.AI, 'instance-id', metadata, startedAt);
    await service.beat(WORKER_NAME.AI, 'instance-id', startedAt);
    await service.stop(WORKER_NAME.AI, 'instance-id', startedAt);

    expect(transaction.workerHeartbeat.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          status: WorkerStatus.RUNNING,
          workerName: WORKER_NAME.AI,
        }),
      }),
    );
    expect(prisma.workerHeartbeat.updateMany).toHaveBeenCalled();
    expect(transaction.workerHeartbeat.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: WorkerStatus.STOPPED,
          stoppedAt: startedAt,
        }),
      }),
    );
    expect(eventService.recordInTransaction).toHaveBeenCalledWith(
      transaction,
      expect.objectContaining({
        severity: Severity.INFO,
        eventType: WORKER_SYSTEM_EVENT.STARTED,
      }),
    );
    expect(eventService.recordInTransaction).toHaveBeenCalledWith(
      transaction,
      expect.objectContaining({
        eventType: WORKER_SYSTEM_EVENT.STOPPED,
      }),
    );
  });
});
