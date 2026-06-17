import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EventBusModule } from '../event-bus/event-bus.module';
import { ObservabilityModule } from '../observability/observability.module';
import { ContextAdminController } from './context-admin.controller';
import { ContextEventHandlerService } from './context-event-handler.service';
import { ContextSnapshotService } from './context-snapshot.service';
import { ContextService } from './context.service';
import { MemoryService } from './memory.service';

@Module({
  imports: [AuthModule, EventBusModule, ObservabilityModule],
  controllers: [ContextAdminController],
  providers: [
    ContextService,
    MemoryService,
    ContextSnapshotService,
    ContextEventHandlerService,
  ],
  exports: [ContextService, MemoryService, ContextSnapshotService],
})
export class ContextModule {}
