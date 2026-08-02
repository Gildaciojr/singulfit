import { ForbiddenException, Injectable, OnModuleInit } from '@nestjs/common';
import { EventHandlerRegistry } from '../event-bus/event-handler.registry';
import { INTERNAL_EVENT } from '../event-bus/event-bus.constants';
import { ContextSnapshotService } from './context-snapshot.service';
import { SubscriptionAccessService } from '../subscriptions/subscription-access.service';
import type { OutboxEvent } from '@prisma/client';

@Injectable()
export class ContextEventHandlerService implements OnModuleInit {
  constructor(
    private readonly registry: EventHandlerRegistry,
    private readonly snapshotService: ContextSnapshotService,
    private readonly subscriptionAccess: SubscriptionAccessService,
  ) {}

  onModuleInit(): void {
    this.registry.register(
      INTERNAL_EVENT.USER_CONTEXT_REFRESH_REQUESTED,
      (event) => this.refreshWhenAuthorized(event),
    );
  }

  private async refreshWhenAuthorized(event: OutboxEvent): Promise<void> {
    if (
      typeof event.payload !== 'object' ||
      event.payload === null ||
      Array.isArray(event.payload) ||
      typeof event.payload.userId !== 'string'
    ) {
      return;
    }

    try {
      await this.subscriptionAccess.requireAccess(event.payload.userId);
    } catch (error: unknown) {
      if (error instanceof ForbiddenException) {
        return;
      }
      throw error;
    }

    await this.snapshotService.refreshFromEvent(event);
  }
}
