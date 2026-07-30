import { ConfigService } from '@nestjs/config';
import type { CoachAdaptiveProfileCollectorService } from '../context/coach-adaptive-profile-collector.service';
import type { CoachProfileSnapshotBuilder } from '../context/coach-profile-snapshot.builder';
import type { CoachProfileSnapshot } from '../context/coach-profile-snapshot.contract';
import type { ConversationGoalDecision } from '../context/conversation-goal-planner.contract';
import type { ConversationGoalPlannerService } from '../context/conversation-goal-planner.service';
import type { NutritionConversationalArtifactPersistenceService } from '../diet/v2/conversational-persistence/nutrition-conversational-artifact-persistence.service';
import { NutritionApplicationExecutorService } from '../diet/v2/execution/nutrition-application-executor.service';
import { NutritionPublicResultFormatter } from '../diet/v2/execution/nutrition-public-result.formatter';
import { GenerateNutritionPlanV2InputBuilder } from '../diet/v2/generate-nutrition-plan-v2-input.builder';
import { NutritionArtifactResolverService } from '../diet/v2/nutrition-artifact-resolver.service';
import { NutritionPlanV2Formatter } from '../diet/v2/nutrition-plan-v2.formatter';
import type { NutritionPlanV2 } from '../diet/v2/nutrition-plan-v2.contract';
import type { NutritionPlanningEngineV2Service } from '../diet/v2/nutrition-planning-engine-v2.service';
import type { NutritionPlanningGenerationResult } from '../diet/v2/nutrition-planning-generation.contract';
import type { NutritionPlanV2PersistenceService } from '../diet/v2/persistence/nutrition-plan-v2-persistence.service';
import type { NutritionShadowRuntimeOrchestratorService } from '../diet/v2/shadow-runtime/nutrition-shadow-runtime-orchestrator.service';
import type { EventBusService } from '../event-bus/event-bus.service';
import type { PrismaService } from '../prisma/prisma.service';
import { CoachCommandService } from './coach-command.service';
import type { CoachPlanningExecutionDispatcherService } from './coach-planning-execution-dispatcher.service';
import { CoachPlanningExecutionService } from './coach-planning-execution.service';
import type { ConversationGoalShadowPipelineService } from './conversation-goal-shadow-pipeline.service';
import type { LegacyCoachIntentAdapter } from './legacy-coach-intent.adapter';
import { NutritionV2PilotConfigService } from './nutrition-v2-pilot-config.service';
import { NutritionV2PilotService } from './nutrition-v2-pilot.service';

const USER_ID = '123e4567-e89b-42d3-a456-426614174000';

describe('Nutrition V2 internal pilot integration', () => {
  function setup(options?: {
    enabled?: string;
    allowed?: string;
    goal?: string;
    engineFailure?: Error;
    timeoutMs?: number;
  }) {
    const order: string[] = [];
    const referenceDate = new Date('2026-07-30T12:00:00.000Z');
    const decision = Object.freeze({
      goal: options?.goal ?? 'GENERATE_DIET_PLAN',
      recognizedIntent: 'DIET_PLAN_REQUEST',
    }) as unknown as ConversationGoalDecision;
    const unknownDatum = Object.freeze({
      status: 'UNKNOWN' as const,
      sources: Object.freeze([]),
    });
    const snapshot = Object.freeze({
      completion: Object.freeze({
        overall: 'COMPLETE' as const,
        sections: Object.freeze([]),
      }),
      longitudinal: Object.freeze({
        latestProgressWeightKg: unknownDatum,
        goalProgression: unknownDatum,
        nutritionEvolution: unknownDatum,
      }),
    }) as unknown as CoachProfileSnapshot;
    const document = Object.freeze({
      artifactType: 'DAILY_STRUCTURE',
      title: 'Plano diário V2',
      objectiveSummary: 'Estrutura diária personalizada.',
      guidance: Object.freeze(['Siga os horários combinados.']),
      days: Object.freeze([
        Object.freeze({
          label: 'Dia 1',
          meals: Object.freeze([
            Object.freeze({
              name: 'Café da manhã',
              suggestedTime: '08:00',
              items: Object.freeze([
                Object.freeze({
                  quantity: '40 g',
                  foodName: 'Aveia',
                }),
              ]),
            }),
          ]),
        }),
      ]),
      hydrationGuidance: Object.freeze(['Mantenha a hidratação.']),
      safetyNotes: Object.freeze([]),
    }) as unknown as NutritionPlanV2;
    const generation = Object.freeze({
      status: 'PENDING_COMPLETION',
      output: Object.freeze({
        kind: 'PLAN',
        artifactType: 'DAILY_STRUCTURE',
        plan: document,
      }),
      aiJobId: 'ai-job-id',
      operationKey: 'operation-key',
      storedResult: Object.freeze({
        candidateOutput: '{}',
        model: 'model',
      }),
      reused: false,
      completion: Object.freeze({}),
    }) as unknown as NutritionPlanningGenerationResult;
    const engine = {
      generate: jest.fn(() => {
        order.push('v2');
        if (options?.engineFailure)
          return Promise.reject(options.engineFailure);
        if (options?.timeoutMs)
          return new Promise<NutritionPlanningGenerationResult>(
            () => undefined,
          );
        return Promise.resolve(generation);
      }),
    };
    const planPersistence = {
      persist: jest.fn().mockResolvedValue({
        persistence: 'CREATED',
        aggregate: { id: 'v2-plan-id', document },
        aiJobCompleted: true,
      }),
    };
    const conversationalPersistence = { persist: jest.fn() };
    const executor = new NutritionApplicationExecutorService(
      engine as unknown as NutritionPlanningEngineV2Service,
      planPersistence as unknown as NutritionPlanV2PersistenceService,
      conversationalPersistence as unknown as NutritionConversationalArtifactPersistenceService,
    );
    const publicFormatter = new NutritionPublicResultFormatter(
      new NutritionPlanV2Formatter(),
    );
    const operationalConfig = new NutritionV2PilotConfigService(
      new ConfigService({
        NUTRITION_V2_PILOT_ENABLED: options?.enabled ?? 'true',
        NUTRITION_V2_PILOT_USER_IDS: options?.allowed ?? USER_ID,
      }),
    );
    if (options?.timeoutMs)
      jest
        .spyOn(operationalConfig, 'timeoutMs')
        .mockReturnValue(options.timeoutMs);
    const pilot = new NutritionV2PilotService(
      operationalConfig,
      executor,
      publicFormatter,
    );
    const dispatcher = {
      dispatch: jest.fn(() => {
        order.push('legacy');
        return Promise.resolve('resposta legada');
      }),
    };
    const shadowRuntime = { execute: jest.fn() };
    const planning = new CoachPlanningExecutionService(
      dispatcher as unknown as CoachPlanningExecutionDispatcherService,
      {
        build: jest.fn().mockResolvedValue(snapshot),
      } as unknown as CoachProfileSnapshotBuilder,
      {
        adapt: jest.fn().mockReturnValue({
          recognizedIntent: 'DIET_PLAN_REQUEST',
          planTarget: 'DIET',
          acquisitionIntent: Object.freeze({}),
        }),
      } as unknown as LegacyCoachIntentAdapter,
      {
        decide: jest.fn().mockReturnValue(Object.freeze({})),
      } as unknown as CoachAdaptiveProfileCollectorService,
      {
        plan: jest.fn().mockReturnValue(decision),
      } as unknown as ConversationGoalPlannerService,
      new GenerateNutritionPlanV2InputBuilder(
        new NutritionArtifactResolverService(),
      ),
      shadowRuntime as unknown as NutritionShadowRuntimeOrchestratorService,
      pilot,
    );
    const transaction = {
      scheduledMessage: {
        upsert: jest.fn().mockResolvedValue({ id: 'scheduled-message-id' }),
      },
    };
    const prisma = {
      message: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'message-id',
          content: 'quero uma dieta',
          timestamp: referenceDate,
          conversation: {
            id: 'conversation-id',
            user: {
              onboardingCompleted: true,
              fitnessProfile: { id: 'fitness-profile-id' },
            },
          },
        }),
      },
      coachMessage: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'coach-message-id' }),
      },
      automationRule: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'rule-id',
          enabled: true,
        }),
      },
      userAutomationPreference: {
        upsert: jest.fn().mockResolvedValue({ id: 'preference-id' }),
      },
      $transaction: jest.fn(
        (operation: (client: typeof transaction) => Promise<unknown>) =>
          operation(transaction),
      ),
    };
    const eventBus = {
      publish: jest.fn().mockResolvedValue({ id: 'event-id' }),
    };
    const goalShadow = { execute: jest.fn() };
    const command = new CoachCommandService(
      prisma as unknown as PrismaService,
      planning,
      eventBus as unknown as EventBusService,
      goalShadow as unknown as ConversationGoalShadowPipelineService,
    );
    return {
      command,
      dispatcher,
      engine,
      planPersistence,
      shadowRuntime,
      prisma,
      transaction,
      eventBus,
      order,
    };
  }

  it('runs legacy first and sends exactly one selected V2 string through the existing objects', async () => {
    const test = setup();

    await test.command.processTextMessage({
      userId: USER_ID,
      messageId: 'message-id',
    });

    expect(test.order).toEqual(['legacy', 'v2']);
    const content = expect.stringContaining('Plano diário V2');
    expect(test.prisma.coachMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ content }),
      }),
    );
    expect(test.transaction.scheduledMessage.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ content }),
      }),
    );
    expect(test.eventBus.publish).toHaveBeenCalledTimes(1);
    expect(test.prisma.coachMessage.create).toHaveBeenCalledTimes(1);
    expect(test.transaction.scheduledMessage.upsert).toHaveBeenCalledTimes(1);
    expect(test.shadowRuntime.execute).not.toHaveBeenCalled();
  });

  it('keeps the same legacy string when V2 fails after legacy completion', async () => {
    const test = setup({ engineFailure: new Error('provider unavailable') });

    await test.command.processTextMessage({
      userId: USER_ID,
      messageId: 'message-id',
    });

    expect(test.order).toEqual(['legacy', 'v2']);
    expect(test.prisma.coachMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ content: 'resposta legada' }),
      }),
    );
    expect(test.transaction.scheduledMessage.upsert).toHaveBeenCalledTimes(1);
    expect(test.shadowRuntime.execute).not.toHaveBeenCalled();
  });

  it('does not call any V2 provider when the global pilot switch is disabled', async () => {
    const test = setup({ enabled: 'false' });

    await test.command.processTextMessage({
      userId: USER_ID,
      messageId: 'message-id',
    });

    expect(test.order).toEqual(['legacy']);
    expect(test.engine.generate).not.toHaveBeenCalled();
    expect(test.shadowRuntime.execute).toHaveBeenCalledTimes(1);
  });

  it('falls back after the external timeout and creates only one official message', async () => {
    const test = setup({ timeoutMs: 5 });

    await test.command.processTextMessage({
      userId: USER_ID,
      messageId: 'message-id',
    });

    expect(test.order).toEqual(['legacy', 'v2']);
    expect(test.prisma.coachMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ content: 'resposta legada' }),
      }),
    );
    expect(test.prisma.coachMessage.create).toHaveBeenCalledTimes(1);
    expect(test.transaction.scheduledMessage.upsert).toHaveBeenCalledTimes(1);
  });

  it('preserves legacy and Shadow for an ineligible goal', async () => {
    const test = setup({ goal: 'GENERATE_COMBINED_PLANS' });

    await test.command.processTextMessage({
      userId: USER_ID,
      messageId: 'message-id',
    });

    expect(test.order).toEqual(['legacy']);
    expect(test.engine.generate).not.toHaveBeenCalled();
    expect(test.shadowRuntime.execute).toHaveBeenCalledTimes(1);
  });
});
