import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  WORKER_EVENT_TYPES,
  WORKER_NAME,
} from '../event-bus/event-bus.constants';
import { OutboxDispatcherService } from '../event-bus/outbox-dispatcher.service';
import { BaseOutboxWorker } from './base-outbox-worker';
import { WorkerHeartbeatService } from './worker-heartbeat.service';
import { WorkerIdentityService } from './worker-identity.service';
import { ActivationJourneyService } from '../activation/activation-journey.service';

@Injectable()
export class AutomationWorkerService extends BaseOutboxWorker {
  constructor(
    dispatcher: OutboxDispatcherService,
    configService: ConfigService,
    heartbeatService: WorkerHeartbeatService,
    identityService: WorkerIdentityService,
    private readonly activationJourney: ActivationJourneyService,
  ) {
    super(
      WORKER_NAME.AUTOMATION,
      WORKER_EVENT_TYPES[WORKER_NAME.AUTOMATION],
      dispatcher,
      configService,
      heartbeatService,
      identityService,
    );
  }

  protected override async runMaintenance(at: Date): Promise<void> {
    await this.activationJourney.processDue(at);
  }
}
