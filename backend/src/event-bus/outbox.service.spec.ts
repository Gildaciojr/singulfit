import { ConfigService } from '@nestjs/config';
import { OutboxEvent, OutboxStatus } from '@prisma/client';
import { AuditService } from '../observability/audit.service';
import { EventService } from '../observability/event.service';
import { PrismaService } from '../prisma/prisma.service';
import { OutboxService } from './outbox.service';

describe('OutboxService', () => {
  function event(attempts: number): OutboxEvent {
    const claimedAt = new Date('2026-06-10T15:00:00.000Z');

    return {
      id: 'outbox-id',
      eventType: 'MEDIA_RECEIVED',
      aggregateType: 'MEDIA_FILE',
      aggregateId: 'media-id',
      payload: {
        mediaFileId: 'media-id',
      },
      status: OutboxStatus.PROCESSING,
      attempts,
      availableAt: claimedAt,
      claimedAt,
      processedAt: null,
      failedAt: null,
      lastError: null,
      createdAt: claimedAt,
      updatedAt: claimedAt,
    };
  }

  function createSubject() {
    const transaction = {
      outboxEvent: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };
    const prisma = {
      $transaction: jest.fn(
        (operation: (client: typeof transaction) => unknown) =>
          operation(transaction),
      ),
      outboxEvent: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest.fn(),
      },
    };
    const eventService = {
      recordInTransaction: jest.fn(),
    };
    const auditService = {
      recordInTransaction: jest.fn(),
    };
    const configService = {
      get: jest.fn((_key: string, fallback: string) => fallback),
    };
    const service = new OutboxService(
      prisma as unknown as PrismaService,
      configService as unknown as ConfigService,
      eventService as unknown as EventService,
      auditService as unknown as AuditService,
    );

    return {
      service,
      prisma,
      transaction,
      eventService,
      auditService,
    };
  }

  it('schedules exponential retry after a transient failure', async () => {
    const subject = createSubject();
    const claimed = event(2);

    await expect(
      subject.service.markFailed(claimed, new Error('provider offline')),
    ).resolves.toBe(true);
    expect(subject.transaction.outboxEvent.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: claimed.id,
          status: OutboxStatus.PROCESSING,
          claimedAt: claimed.claimedAt,
        },
        data: expect.objectContaining({
          status: OutboxStatus.FAILED,
          availableAt: expect.any(Date),
          lastError: 'provider offline',
        }),
      }),
    );
    expect(subject.eventService.recordInTransaction).toHaveBeenCalledWith(
      subject.transaction,
      expect.objectContaining({
        eventType: 'RETRY_SCHEDULED',
      }),
    );
  });

  it('moves an exhausted event to dead letter', async () => {
    const subject = createSubject();

    await subject.service.markFailed(event(10), new Error('permanent'));

    expect(subject.transaction.outboxEvent.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: OutboxStatus.DEAD_LETTER,
        }),
      }),
    );
    expect(subject.eventService.recordInTransaction).toHaveBeenCalledWith(
      subject.transaction,
      expect.objectContaining({
        eventType: 'DEAD_LETTER',
      }),
    );
  });

  it('recovers a dead-letter event through the administrative action', async () => {
    const subject = createSubject();
    const deadLetter = {
      ...event(10),
      status: OutboxStatus.DEAD_LETTER,
    };
    const recovered = {
      ...deadLetter,
      status: OutboxStatus.PENDING,
      attempts: 0,
    };
    subject.transaction.outboxEvent.findUnique.mockResolvedValue(deadLetter);
    subject.transaction.outboxEvent.update.mockResolvedValue(recovered);

    await expect(
      subject.service.retry(deadLetter.id, 'admin-id'),
    ).resolves.toBe(recovered);
    expect(subject.auditService.recordInTransaction).toHaveBeenCalledWith(
      subject.transaction,
      expect.objectContaining({
        userId: 'admin-id',
        action: 'OUTBOX_RETRIED',
      }),
    );
    expect(subject.eventService.recordInTransaction).toHaveBeenCalledWith(
      subject.transaction,
      expect.objectContaining({
        eventType: 'EVENT_RECOVERED',
      }),
    );
  });
});
