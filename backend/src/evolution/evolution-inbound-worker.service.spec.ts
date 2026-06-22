import { ConfigService } from '@nestjs/config';
import { WebhookStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EvolutionInboundWorkerService } from './evolution-inbound-worker.service';
import { EvolutionWebhookService } from './evolution-webhook.service';

describe('EvolutionInboundWorkerService', () => {
  it('reclaims and completes a queued event outside the webhook request', async () => {
    const event = {
      id: 'event-id',
      instanceName: 'singulfit',
      externalMessageId: 'wamid-test',
      payload: { key: { id: 'wamid-test' } },
      status: WebhookStatus.PROCESSING,
      attempts: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      claimedAt: null,
      leaseExpiresAt: null,
      lastError: null,
      processedAt: null,
    };
    const prisma = {
      evolutionInboundEvent: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(event)
          .mockResolvedValueOnce(null),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const webhookService = {
      processQueuedEntry: jest.fn().mockResolvedValue({
        received: true,
        processed: true,
      }),
    };
    const worker = new EvolutionInboundWorkerService(
      prisma as unknown as PrismaService,
      {
        get: jest.fn((_key: string, fallback: string) => fallback),
      } as unknown as ConfigService,
      webhookService as unknown as EvolutionWebhookService,
    );

    await expect(worker.drain()).resolves.toBe(1);
    expect(webhookService.processQueuedEntry).toHaveBeenCalledWith(
      'singulfit',
      event.payload,
    );
    expect(prisma.evolutionInboundEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: WebhookStatus.PROCESSED,
          leaseExpiresAt: null,
        }),
      }),
    );
  });
});
