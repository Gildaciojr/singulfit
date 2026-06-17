import { ConflictException } from '@nestjs/common';
import { OutboxStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EventBusService } from './event-bus.service';

describe('EventBusService', () => {
  it('publishes idempotently by event and aggregate', async () => {
    const availableAt = new Date('2026-06-10T15:00:00.000Z');
    const event = {
      id: 'outbox-id',
      eventType: 'PAYMENT_APPROVED',
      aggregateType: 'PAYMENT',
      aggregateId: 'payment-id',
      payload: {
        paymentId: 'payment-id',
      },
      status: OutboxStatus.PENDING,
      attempts: 0,
      availableAt,
      claimedAt: null,
      processedAt: null,
      failedAt: null,
      lastError: null,
      createdAt: availableAt,
      updatedAt: availableAt,
    };
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([{ locked: true }]),
      outboxEvent: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(event),
      },
    };
    const prisma = {
      $transaction: jest.fn(
        (operation: (client: typeof transaction) => unknown) =>
          operation(transaction),
      ),
    };
    const service = new EventBusService(prisma as unknown as PrismaService);

    await expect(
      service.publish({
        eventType: 'PAYMENT_APPROVED',
        aggregateType: 'PAYMENT',
        aggregateId: 'payment-id',
        payload: {
          paymentId: 'payment-id',
        },
        availableAt,
      }),
    ).resolves.toBe(event);
    expect(transaction.outboxEvent.create).toHaveBeenCalledWith({
      data: {
        eventType: 'PAYMENT_APPROVED',
        aggregateType: 'PAYMENT',
        aggregateId: 'payment-id',
        payload: {
          paymentId: 'payment-id',
        },
        availableAt,
      },
    });
  });

  it('rejects reuse of an event identity with another payload', async () => {
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([{ locked: true }]),
      outboxEvent: {
        findUnique: jest.fn().mockResolvedValue({
          availableAt: new Date(),
          payload: {
            paymentId: 'another-payment',
          },
        }),
      },
    };
    const prisma = {
      $transaction: jest.fn(
        (operation: (client: typeof transaction) => unknown) =>
          operation(transaction),
      ),
    };
    const service = new EventBusService(prisma as unknown as PrismaService);

    await expect(
      service.publish({
        eventType: 'PAYMENT_APPROVED',
        aggregateType: 'PAYMENT',
        aggregateId: 'payment-id',
        payload: {
          paymentId: 'payment-id',
        },
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
