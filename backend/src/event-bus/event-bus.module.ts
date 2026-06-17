import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ObservabilityModule } from '../observability/observability.module';
import { EventBusService } from './event-bus.service';
import { EventHandlerRegistry } from './event-handler.registry';
import { OutboxDispatcherService } from './outbox-dispatcher.service';
import { OutboxService } from './outbox.service';

@Global()
@Module({
  imports: [ConfigModule, ObservabilityModule],
  providers: [
    EventBusService,
    EventHandlerRegistry,
    OutboxDispatcherService,
    OutboxService,
  ],
  exports: [
    EventBusService,
    EventHandlerRegistry,
    OutboxDispatcherService,
    OutboxService,
  ],
})
export class EventBusModule {}
