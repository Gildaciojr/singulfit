import { ConfigService } from '@nestjs/config';
import { AIRecoveryService } from '../ai/ai-recovery.service';
import {
  WORKER_EVENT_TYPES,
  WORKER_NAME,
} from '../event-bus/event-bus.constants';
import { OutboxDispatcherService } from '../event-bus/outbox-dispatcher.service';
import { RetentionService } from '../operations/retention.service';
import { AIWorkerService } from './ai-worker.service';
import { AutomationWorkerService } from './automation-worker.service';
import { OutboxWorkerService } from './outbox-worker.service';
import { WorkerHeartbeatService } from './worker-heartbeat.service';
import { WorkerIdentityService } from './worker-identity.service';
import { ActivationJourneyService } from '../activation/activation-journey.service';

describe('dedicated workers', () => {
  function config(role = 'ALL') {
    return {
      get: jest.fn((key: string, fallback?: string) =>
        key === 'WORKER_ROLE' ? role : fallback,
      ),
    } as unknown as ConfigService;
  }

  function heartbeat() {
    const stop = jest.fn().mockResolvedValue(undefined);
    const service = {
      start: jest.fn().mockResolvedValue(undefined),
      beat: jest.fn().mockResolvedValue(undefined),
      stop,
    } as unknown as WorkerHeartbeatService;

    return {
      service,
      stop,
    };
  }

  const identity = {
    instanceId: 'worker-instance',
  } as WorkerIdentityService;

  it('assigns every internal event to exactly one worker', async () => {
    const dispatcher = {
      drain: jest.fn().mockResolvedValue(0),
    } as unknown as OutboxDispatcherService;
    const { service: heartbeatService } = heartbeat();
    const retention = {
      runIfDue: jest.fn().mockResolvedValue(null),
    } as unknown as RetentionService;
    const recovery = {
      recover: jest.fn().mockResolvedValue(0),
    } as unknown as AIRecoveryService;
    const workers = [
      new OutboxWorkerService(
        dispatcher,
        config(),
        heartbeatService,
        identity,
        retention,
      ),
      new AIWorkerService(
        dispatcher,
        config(),
        heartbeatService,
        identity,
        recovery,
      ),
      new AutomationWorkerService(
        dispatcher,
        config(),
        heartbeatService,
        identity,
        {
          processDue: jest.fn().mockResolvedValue(0),
        } as unknown as ActivationJourneyService,
      ),
    ];

    await Promise.all(workers.map((worker) => worker.onApplicationBootstrap()));
    const assignedTypes = (
      (dispatcher.drain as jest.Mock).mock.calls as Array<
        [readonly string[], Date]
      >
    ).map(([eventTypes]) => eventTypes);
    const flattened = assignedTypes.flat();

    expect(new Set(flattened).size).toBe(flattened.length);
    expect(new Set(flattened)).toEqual(
      new Set(Object.values(WORKER_EVENT_TYPES).flat()),
    );

    await Promise.all(
      workers.map((worker) => worker.beforeApplicationShutdown()),
    );
  });

  it('waits for the active drain before recording a safe shutdown', async () => {
    let resolveDrain: (value: number) => void = () => undefined;
    const activeDrain = new Promise<number>((resolve) => {
      resolveDrain = resolve;
    });
    const dispatcher = {
      drain: jest.fn().mockReturnValue(activeDrain),
    } as unknown as OutboxDispatcherService;
    const { service: heartbeatService, stop } = heartbeat();
    const worker = new OutboxWorkerService(
      dispatcher,
      config('OUTBOX'),
      heartbeatService,
      identity,
      {
        runIfDue: jest.fn().mockResolvedValue(null),
      } as unknown as RetentionService,
    );
    const bootstrap = worker.onApplicationBootstrap();

    await Promise.resolve();
    await Promise.resolve();

    const shutdown = worker.beforeApplicationShutdown();

    expect(stop).not.toHaveBeenCalled();
    resolveDrain(1);
    await bootstrap;
    await shutdown;
    expect(stop).toHaveBeenCalledWith(WORKER_NAME.OUTBOX, identity.instanceId);
  });
});
