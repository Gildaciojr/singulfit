import { OutboxEvent, OutboxStatus } from '@prisma/client';
import { EventHandlerRegistry } from './event-handler.registry';
import { OutboxDispatcherService } from './outbox-dispatcher.service';
import { OutboxService } from './outbox.service';

describe('OutboxDispatcherService', () => {
  function event(): OutboxEvent {
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
      attempts: 1,
      availableAt: claimedAt,
      claimedAt,
      processedAt: null,
      failedAt: null,
      lastError: null,
      createdAt: claimedAt,
      updatedAt: claimedAt,
    };
  }

  it('dispatches a claimed event and marks it processed', async () => {
    const claimed = event();
    const handler = jest.fn().mockResolvedValue(undefined);
    const registry = new EventHandlerRegistry();
    registry.register(claimed.eventType, handler);
    const outboxService = {
      claimBatch: jest.fn().mockResolvedValue([claimed]),
      markProcessed: jest.fn().mockResolvedValue(true),
      markFailed: jest.fn(),
      markIgnored: jest.fn(),
    };
    const dispatcher = new OutboxDispatcherService(
      outboxService as unknown as OutboxService,
      registry,
    );

    await expect(dispatcher.drain(['MEDIA_RECEIVED'])).resolves.toBe(1);
    expect(outboxService.claimBatch).toHaveBeenCalledWith(expect.any(Date), [
      'MEDIA_RECEIVED',
    ]);
    expect(handler).toHaveBeenCalledWith(claimed);
    expect(outboxService.markProcessed).toHaveBeenCalledWith(claimed);
    expect(outboxService.markFailed).not.toHaveBeenCalled();
  });

  it('persists handler failure for retry', async () => {
    const claimed = event();
    const failure = new Error('handler failed');
    const registry = new EventHandlerRegistry();
    registry.register(claimed.eventType, jest.fn().mockRejectedValue(failure));
    const outboxService = {
      claimBatch: jest.fn().mockResolvedValue([claimed]),
      markProcessed: jest.fn(),
      markFailed: jest.fn().mockResolvedValue(true),
      markIgnored: jest.fn(),
    };
    const dispatcher = new OutboxDispatcherService(
      outboxService as unknown as OutboxService,
      registry,
    );

    await dispatcher.drain(['MEDIA_RECEIVED']);

    expect(outboxService.markFailed).toHaveBeenCalledWith(claimed, failure);
    expect(outboxService.markProcessed).not.toHaveBeenCalled();
  });
});
