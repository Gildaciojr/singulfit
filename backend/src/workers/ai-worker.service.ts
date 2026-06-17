import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AIRecoveryService } from '../ai/ai-recovery.service';
import {
  WORKER_EVENT_TYPES,
  WORKER_NAME,
} from '../event-bus/event-bus.constants';
import { OutboxDispatcherService } from '../event-bus/outbox-dispatcher.service';
import { BaseOutboxWorker } from './base-outbox-worker';
import { WorkerHeartbeatService } from './worker-heartbeat.service';
import { WorkerIdentityService } from './worker-identity.service';

@Injectable()
export class AIWorkerService extends BaseOutboxWorker {
  private nextRecoveryAt = 0;

  constructor(
    dispatcher: OutboxDispatcherService,
    configService: ConfigService,
    heartbeatService: WorkerHeartbeatService,
    identityService: WorkerIdentityService,
    private readonly recoveryService: AIRecoveryService,
  ) {
    super(
      WORKER_NAME.AI,
      WORKER_EVENT_TYPES[WORKER_NAME.AI],
      dispatcher,
      configService,
      heartbeatService,
      identityService,
    );
  }

  protected async runMaintenance(at: Date): Promise<void> {
    if (at.getTime() < this.nextRecoveryAt) {
      return;
    }

    await this.recoveryService.recover(at);
    this.nextRecoveryAt = at.getTime() + this.getRecoveryIntervalMs();
  }

  private getRecoveryIntervalMs(): number {
    const value = Number.parseInt(
      this.configService.get<string>('AI_RECOVERY_INTERVAL_MS', '30000'),
      10,
    );

    if (!Number.isInteger(value) || value < 1_000 || value > 3_600_000) {
      throw new ServiceUnavailableException(
        'AI_RECOVERY_INTERVAL_MS possui valor inválido',
      );
    }

    return value;
  }
}
