import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EventBusModule } from '../event-bus/event-bus.module';
import { ObservabilityModule } from '../observability/observability.module';
import { OperationsModule } from '../operations/operations.module';
import { AdminController } from './admin.controller';

@Module({
  imports: [AuthModule, EventBusModule, ObservabilityModule, OperationsModule],
  controllers: [AdminController],
})
export class AdminModule {}
