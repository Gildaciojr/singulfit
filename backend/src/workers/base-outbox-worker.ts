import {
  BeforeApplicationShutdown,
  Logger,
  OnApplicationBootstrap,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OutboxDispatcherService } from '../event-bus/outbox-dispatcher.service';
import { WorkerName, WORKER_NAME } from '../event-bus/event-bus.constants';
import { WorkerHeartbeatService } from './worker-heartbeat.service';
import { WorkerIdentityService } from './worker-identity.service';

type WorkerRole = 'ALL' | 'OUTBOX' | 'AI' | 'AUTOMATION';

export abstract class BaseOutboxWorker
  implements OnApplicationBootstrap, BeforeApplicationShutdown
{
  private readonly logger: Logger;
  private timer?: NodeJS.Timeout;
  private running = false;
  private stopping = false;
  private activeDrain?: Promise<number>;
  private started = false;

  protected constructor(
    private readonly workerName: WorkerName,
    private readonly eventTypes: readonly string[],
    private readonly dispatcher: OutboxDispatcherService,
    protected readonly configService: ConfigService,
    private readonly heartbeatService: WorkerHeartbeatService,
    private readonly identityService: WorkerIdentityService,
  ) {
    this.logger = new Logger(workerName);
  }

  async onApplicationBootstrap(): Promise<void> {
    if (!this.isEnabled()) {
      return;
    }

    await this.heartbeatService.start(
      this.workerName,
      this.identityService.instanceId,
      {
        pid: process.pid,
        eventTypes: [...this.eventTypes],
      },
    );
    this.started = true;
    await this.drain();

    if (this.stopping) {
      return;
    }

    this.timer = setInterval(() => {
      void this.drain();
    }, this.getPollMs());
    this.timer.unref();
  }

  async beforeApplicationShutdown(): Promise<void> {
    this.stopping = true;

    if (this.timer) {
      clearInterval(this.timer);
    }

    await this.activeDrain;

    if (this.started) {
      await this.heartbeatService.stop(
        this.workerName,
        this.identityService.instanceId,
      );
    }
  }

  async drain(at = new Date()): Promise<number> {
    if (!this.started || this.running || this.stopping) {
      return 0;
    }

    this.running = true;
    this.activeDrain = this.executeDrain(at);

    try {
      return await this.activeDrain;
    } finally {
      this.running = false;
      this.activeDrain = undefined;
    }
  }

  protected runMaintenance(at: Date): Promise<void> {
    void at;
    return Promise.resolve();
  }

  private async executeDrain(at: Date): Promise<number> {
    try {
      const processed = await this.dispatcher.drain(this.eventTypes, at);

      await this.runMaintenance(at);
      await this.heartbeatService.beat(
        this.workerName,
        this.identityService.instanceId,
      );

      return processed;
    } catch (error: unknown) {
      this.logger.error(
        'Falha ao executar ciclo do worker',
        error instanceof Error ? error.stack : undefined,
      );
      await this.heartbeatService.beat(
        this.workerName,
        this.identityService.instanceId,
      );
      return 0;
    }
  }

  private isEnabled(): boolean {
    const role = this.configService
      .get<string>('WORKER_ROLE', 'ALL')
      .trim()
      .toUpperCase() as WorkerRole;
    const validRoles: readonly WorkerRole[] = [
      'ALL',
      'OUTBOX',
      'AI',
      'AUTOMATION',
    ];

    if (!validRoles.includes(role)) {
      throw new ServiceUnavailableException(
        'WORKER_ROLE possui valor inválido',
      );
    }

    return (
      role === 'ALL' ||
      (role === 'OUTBOX' && this.workerName === WORKER_NAME.OUTBOX) ||
      (role === 'AI' && this.workerName === WORKER_NAME.AI) ||
      (role === 'AUTOMATION' && this.workerName === WORKER_NAME.AUTOMATION)
    );
  }

  private getPollMs(): number {
    const specificKey = `${this.workerName}_POLL_MS`;
    const value = Number.parseInt(
      this.configService.get<string>(
        specificKey,
        this.configService.get<string>('WORKER_POLL_MS', '1000'),
      ),
      10,
    );

    if (!Number.isInteger(value) || value < 250 || value > 60_000) {
      throw new ServiceUnavailableException(
        `${specificKey} possui valor inválido`,
      );
    }

    return value;
  }
}
