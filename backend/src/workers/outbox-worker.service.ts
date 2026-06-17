import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  WORKER_EVENT_TYPES,
  WORKER_NAME,
} from '../event-bus/event-bus.constants';
import { OutboxDispatcherService } from '../event-bus/outbox-dispatcher.service';
import { RetentionService } from '../operations/retention.service';
import { BaseOutboxWorker } from './base-outbox-worker';
import { WorkerHeartbeatService } from './worker-heartbeat.service';
import { WorkerIdentityService } from './worker-identity.service';

@Injectable()
export class OutboxWorkerService extends BaseOutboxWorker {
  constructor(
    dispatcher: OutboxDispatcherService,
    configService: ConfigService,
    heartbeatService: WorkerHeartbeatService,
    identityService: WorkerIdentityService,
    private readonly retentionService: RetentionService,
  ) {
    super(
      WORKER_NAME.OUTBOX,
      WORKER_EVENT_TYPES[WORKER_NAME.OUTBOX],
      dispatcher,
      configService,
      heartbeatService,
      identityService,
    );
  }

  protected runMaintenance(at: Date): Promise<void> {
    return this.retentionService.runIfDue(at).then(() => undefined);
  }
}
