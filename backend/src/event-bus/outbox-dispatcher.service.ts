import { Injectable, Logger } from '@nestjs/common';
import { OutboxEvent } from '@prisma/client';
import { EventHandlerRegistry } from './event-handler.registry';
import { OutboxService } from './outbox.service';

@Injectable()
export class OutboxDispatcherService {
  private readonly logger = new Logger(OutboxDispatcherService.name);

  constructor(
    private readonly outboxService: OutboxService,
    private readonly registry: EventHandlerRegistry,
  ) {}

  async drain(
    eventTypes?: readonly string[],
    at = new Date(),
  ): Promise<number> {
    const events = await this.outboxService.claimBatch(at, eventTypes);

    await Promise.allSettled(events.map((event) => this.process(event)));

    return events.length;
  }

  private async process(event: OutboxEvent): Promise<void> {
    const handler = this.registry.get(event.eventType);

    if (!handler) {
      await this.outboxService.markIgnored(event);
      return;
    }

    try {
      await handler(event);
      const completed = await this.outboxService.markProcessed(event);

      if (!completed) {
        this.logger.warn(`Lease perdido ao concluir evento ${event.id}`);
      }
    } catch (error: unknown) {
      const persisted = await this.outboxService.markFailed(event, error);

      if (!persisted) {
        this.logger.warn(`Lease perdido ao falhar evento ${event.id}`);
      }
    }
  }
}
