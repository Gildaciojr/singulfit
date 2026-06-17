import { Injectable, OnModuleInit } from '@nestjs/common';
import { EventHandlerRegistry } from '../event-bus/event-handler.registry';
import { INTERNAL_EVENT } from '../event-bus/event-bus.constants';
import { ContextSnapshotService } from './context-snapshot.service';

@Injectable()
export class ContextEventHandlerService implements OnModuleInit {
  constructor(
    private readonly registry: EventHandlerRegistry,
    private readonly snapshotService: ContextSnapshotService,
  ) {}

  onModuleInit(): void {
    this.registry.register(
      INTERNAL_EVENT.USER_CONTEXT_REFRESH_REQUESTED,
      (event) =>
        this.snapshotService.refreshFromEvent(event).then(() => undefined),
    );
  }
}
