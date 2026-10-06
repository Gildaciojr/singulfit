import { Test } from '@nestjs/testing';
import type { Type } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from '../../app.module';
import { WorkersModule } from '../../workers/workers.module';
import { PrismaService } from '../../prisma/prisma.service';
import { OpenAIGateway } from '../../ai/openai.gateway';
import { EvolutionInboundWorkerService } from '../../evolution/evolution-inbound-worker.service';
import { EvolutionOutboundRecoveryService } from '../../evolution/evolution-outbound-recovery.service';
import { OutboxDispatcherService } from '../../event-bus/outbox-dispatcher.service';
import { WorkerHeartbeatService } from '../../workers/worker-heartbeat.service';
import { AIRecoveryService } from '../../ai/ai-recovery.service';
import { RetentionService } from '../../operations/retention.service';
import { ActivationJourneyService } from '../../activation/activation-journey.service';
import { SubscriptionLifecycleService } from '../../subscriptions/subscription-lifecycle.service';
import { AutomationService } from '../../automation/automation.service';
import { AIWorkerService } from '../../workers/ai-worker.service';
import { OutboxWorkerService } from '../../workers/outbox-worker.service';
import { AutomationWorkerService } from '../../workers/automation-worker.service';
import { WorkoutModalityResolutionService } from './workout-modality-resolution.service';
import { WorkoutPromptActivationService } from './workout-prompt-activation.service';
import { WorkoutPlanningEngineV2Service } from './workout-planning-engine-v2.service';

describe('Real API and worker module composition and bootstrap without external I/O', () => {
  it.each(['API', 'AI', 'OUTBOX', 'AUTOMATION'] as const)(
    'boots %s with mandatory Workout providers',
    async (role) => {
      const heartbeat = { start: jest.fn(), beat: jest.fn(), stop: jest.fn() };
      const dispatcher = { drain: jest.fn().mockResolvedValue(0) };
      const external = {
        createTextResponse: jest
          .fn()
          .mockRejectedValue(new Error('No external provider allowed')),
      };
      const config = {
        get: (key: string, fallback?: unknown) =>
          key === 'WORKER_ROLE'
            ? role
            : key === 'JWT_ACCESS_SECRET' || key === 'JWT_REFRESH_SECRET'
              ? 'composition-test-secret'
              : fallback,
      };
      const module = await Test.createTestingModule({
        imports: [role === 'API' ? AppModule : WorkersModule],
      })
        .overrideProvider(PrismaService)
        .useValue({})
        .overrideProvider(ConfigService)
        .useValue(config)
        .overrideProvider(OpenAIGateway)
        .useValue(external)
        .overrideProvider(EvolutionInboundWorkerService)
        .useValue({})
        .overrideProvider(EvolutionOutboundRecoveryService)
        .useValue({})
        .overrideProvider(WorkerHeartbeatService)
        .useValue(heartbeat)
        .overrideProvider(OutboxDispatcherService)
        .useValue(dispatcher)
        .overrideProvider(AIRecoveryService)
        .useValue({ recover: jest.fn().mockResolvedValue(0) })
        .overrideProvider(RetentionService)
        .useValue({ runIfDue: jest.fn().mockResolvedValue(null) })
        .overrideProvider(ActivationJourneyService)
        .useValue({ processDue: jest.fn().mockResolvedValue(0) })
        .overrideProvider(SubscriptionLifecycleService)
        .useValue({
          processDue: jest.fn().mockResolvedValue({ scanned: 0, processed: 0 }),
        })
        .overrideProvider(AutomationService)
        .useValue({
          materializeDueMessages: jest
            .fn()
            .mockResolvedValue({ scanned: 0, materialized: 0 }),
        })
        .compile();
      try {
        await module.init();
        expect(module.get(WorkoutModalityResolutionService)).toBeInstanceOf(
          WorkoutModalityResolutionService,
        );
        expect(module.get(WorkoutPromptActivationService)).toBeInstanceOf(
          WorkoutPromptActivationService,
        );
        expect(module.get(WorkoutPlanningEngineV2Service)).toBeInstanceOf(
          WorkoutPlanningEngineV2Service,
        );
        if (role !== 'API') {
          const worker =
            role === 'AI'
              ? AIWorkerService
              : role === 'OUTBOX'
                ? OutboxWorkerService
                : AutomationWorkerService;
          expect(module.get(worker)).toBeInstanceOf(worker);
          expect(heartbeat.start).toHaveBeenCalledTimes(1);
          expect(dispatcher.drain).toHaveBeenCalledTimes(1);
        }
        expect(external.createTextResponse).not.toHaveBeenCalled();
      } finally {
        await module.close();
      }
    },
  );
  it('cannot silently construct the engine without required prompt activation', async () => {
    const dependencies: readonly Type<unknown>[] = Reflect.getMetadata(
      'design:paramtypes',
      WorkoutPlanningEngineV2Service,
    ) as readonly Type<unknown>[];
    await expect(
      Test.createTestingModule({
        providers: [
          WorkoutPlanningEngineV2Service,
          ...dependencies
            .filter((token) => token !== WorkoutPromptActivationService)
            .map((token) => ({ provide: token, useValue: {} })),
        ],
      }).compile(),
    ).rejects.toThrow('WorkoutPromptActivationService');
  });
});
