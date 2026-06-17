import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AIModule } from '../ai/ai.module';
import { EventBusModule } from '../event-bus/event-bus.module';
import { IntegrationEventsModule } from '../event-bus/integration-events.module';
import { ObservabilityModule } from '../observability/observability.module';
import { OperationsModule } from '../operations/operations.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AIWorkerService } from './ai-worker.service';
import { AutomationWorkerService } from './automation-worker.service';
import { OutboxWorkerService } from './outbox-worker.service';
import { WorkerHeartbeatService } from './worker-heartbeat.service';
import { WorkerIdentityService } from './worker-identity.service';
import { ContextModule } from '../context/context.module';
import { validateEnvironment } from '../production/environment.validation';
import { ProductionModule } from '../production/production.module';
import { RUNTIME_MODE } from '../production/runtime-mode';
import { ActivationModule } from '../activation/activation.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: (environment) =>
        validateEnvironment(environment, RUNTIME_MODE.WORKER),
    }),
    PrismaModule,
    ProductionModule,
    ObservabilityModule,
    EventBusModule,
    AIModule,
    ContextModule,
    ActivationModule,
    IntegrationEventsModule,
    OperationsModule,
  ],
  providers: [
    WorkerIdentityService,
    WorkerHeartbeatService,
    OutboxWorkerService,
    AIWorkerService,
    AutomationWorkerService,
  ],
})
export class WorkersModule {}
