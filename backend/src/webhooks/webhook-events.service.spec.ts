import { PaymentProvider } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WebhookEventsService } from './webhook-events.service';
import { ConfigService } from '@nestjs/config';

describe('WebhookEventsService', () => {
  it('marks a previously recorded provider event as duplicated', async () => {
    const existingEvent = {
      id: 'webhook-event-id',
      provider: PaymentProvider.MERCADO_PAGO,
      eventKey: 'payment:provider-event-id',
    };
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([{ locked: true }]),
      webhookEvent: {
        findUnique: jest.fn().mockResolvedValue(existingEvent),
        create: jest.fn(),
      },
    };
    const prisma = {
      $transaction: jest.fn(
        (operation: (client: typeof transaction) => unknown) =>
          operation(transaction),
      ),
    };
    const service = new WebhookEventsService(
      prisma as unknown as PrismaService,
      {
        get: jest.fn((_: string, fallback?: string) => fallback),
      } as unknown as ConfigService,
    );

    const result = await service.record({
      provider: PaymentProvider.MERCADO_PAGO,
      eventKey: existingEvent.eventKey,
      payload: {
        id: 'provider-event-id',
      },
    });

    expect(result).toEqual({
      event: existingEvent,
      duplicated: true,
    });
    expect(transaction.webhookEvent.create).not.toHaveBeenCalled();
  });

  it('reclaims a PROCESSING event whose lease expired', async () => {
    const prisma = {
      webhookEvent: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const service = new WebhookEventsService(
      prisma as unknown as PrismaService,
      {
        get: jest.fn((key: string, fallback: string) =>
          key === 'WEBHOOK_LEASE_SECONDS' ? '60' : fallback,
        ),
      } as unknown as ConfigService,
    );

    await expect(service.claimForProcessing('webhook-event-id')).resolves.toBe(
      true,
    );
    expect(prisma.webhookEvent.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({
              status: 'PROCESSING',
              leaseExpiresAt: {
                lte: expect.any(Date),
              },
            }),
          ]),
        }),
        data: expect.objectContaining({
          claimedAt: expect.any(Date),
          leaseExpiresAt: expect.any(Date),
          attempts: {
            increment: 1,
          },
        }),
      }),
    );
  });
});
