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
import type { CoachPlanningExecutionDispatchInput } from './coach-planning-execution-dispatcher.service';
import { CoachPlanningExecutionService } from './coach-planning-execution.service';
import type { ConversationGoalShadowPipelineService } from './conversation-goal-shadow-pipeline.service';
import type { LegacyCoachIntentAdapter } from './legacy-coach-intent.adapter';
import { NutritionV2PilotConfigService } from './nutrition-v2-pilot-config.service';
import { NutritionV2PilotService } from './nutrition-v2-pilot.service';
import { PlanningExecutionRoutePolicyService } from './planning-execution-route-policy.service';

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
      identity: Object.freeze({ displayName: unknownDatum }),
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
      schemaVersion: 2,
      artifactType: 'DAILY_STRUCTURE',
      lifecycleReason: 'CREATION',
      replacesPlanReference: null,
      title: 'Plano diário V2',
      objectiveSummary: 'Estrutura diária personalizada.',
      strategy: Object.freeze({
        schemaVersion: 2,
        artifactType: 'DAILY_STRUCTURE',
        objective: Object.freeze({ status: 'NOT_SET' }),
        dayCount: 1,
        mealCountPerDay: Object.freeze({ status: 'NOT_SET' }),
        mealSchedule: Object.freeze({ status: 'NOT_SET' }),
        energyTargetKcal: Object.freeze({ status: 'NOT_SET' }),
        energySource: 'NOT_AVAILABLE',
        macroTargets: Object.freeze({ status: 'NOT_SET' }),
        trainingAware: false,
        appliedConstraintCodes: Object.freeze([]),
        excludedFoods: Object.freeze([]),
        preferredFoods: Object.freeze([]),
        variationPolicy: 'DAILY',
        detailLevel: 'STANDARD',
        factors: Object.freeze([]),
      }),
      guidance: Object.freeze(['Siga os horários combinados.']),
      days: Object.freeze([
        Object.freeze({
          label: 'Dia 1',
          meals: Object.freeze([
            Object.freeze({
              mealKey: 'breakfast',
              name: 'Café da manhã',
              period: 'BREAKFAST',
              suggestedTime: '08:00',
              items: Object.freeze([
                Object.freeze({
                  itemKey: 'oats',
                  quantity: '40 g',
                  foodName: 'Aveia',
                  role: 'CARBOHYDRATE',
                  caloriesKcal: 150,
                  macros: Object.freeze({
                    proteinGrams: 5,
                    carbohydrateGrams: 25,
                    fatGrams: 3,
                  }),
                  allergenTags: Object.freeze([]),
                  dietaryTags: Object.freeze([]),
                }),
              ]),
              alternatives: Object.freeze([]),
            }),
          ]),
        }),
      ]),
      substitutions: Object.freeze([]),
      adaptationRules: Object.freeze([]),
      hydrationGuidance: Object.freeze(['Mantenha a hidratação.']),
      safetyNotes: Object.freeze([]),
      generation: Object.freeze({
        engineVersion: 2,
        promptVersionId: 'prompt-id',
        aiJobId: 'ai-job-id',
        operationKey: 'operation-key',
        model: 'model',
        generatedAt: referenceDate.toISOString(),
        reused: false,
      }),
      validation: Object.freeze({
        status: 'VALID',
        issues: Object.freeze([]),
      }),
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
      generateCandidate: jest.fn(() => {
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
    const pilot = new NutritionV2PilotService(operationalConfig);
    const routePolicy = new PlanningExecutionRoutePolicyService(pilot);
    const dispatcher = {
      dispatchStructured: jest.fn(
        async (input: CoachPlanningExecutionDispatchInput) => {
          if (input.routeSelection?.nutrition === 'V2' && input.nutritionV2) {
            const result = await executor.execute({
              generationInput: input.nutritionV2.generationInput,
              ownership: {
                userId: input.userId,
                profileId: input.nutritionV2.profileId,
              },
              correlationId: input.nutritionV2.correlationId,
              traceId: input.nutritionV2.traceId,
            });
            return {
              content: publicFormatter.format(result),
              executor: 'DIET_V2' as const,
              generationCompleted: result.aiJobCompleted,
              fallbackApplied: false,
            };
          }
          order.push('legacy');
          return {
            content: 'resposta legada',
            executor: 'DIET_LEGACY' as const,
            generationCompleted: true,
            fallbackApplied: false,
          };
        },
      ),
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
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      routePolicy,
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

  it('routes an eligible pilot request through V2 only and emits one official response', async () => {
    const test = setup();

    await test.command.processTextMessage({
      userId: USER_ID,
      messageId: 'message-id',
    });

    expect(test.order).toEqual(['v2']);
    expect(test.prisma.coachMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          content: expect.stringContaining('🥗 *Seu plano alimentar*'),
        }),
      }),
    );
    expect(test.transaction.scheduledMessage.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          content: expect.stringContaining('🥗 *Seu plano alimentar*'),
        }),
      }),
    );
    expect(test.eventBus.publish).toHaveBeenCalledTimes(1);
    expect(test.prisma.coachMessage.create).toHaveBeenCalledTimes(1);
    expect(test.transaction.scheduledMessage.upsert).toHaveBeenCalledTimes(1);
    expect(test.engine.generateCandidate).toHaveBeenCalledTimes(1);
    expect(test.planPersistence.persist).toHaveBeenCalledTimes(1);
    expect(test.shadowRuntime.execute).not.toHaveBeenCalled();
  });

  it('does not attempt cross-route fallback when the selected V2 provider fails', async () => {
    const test = setup({ engineFailure: new Error('provider unavailable') });

    await test.command.processTextMessage({
      userId: USER_ID,
      messageId: 'message-id',
    });

    expect(test.order).toEqual(['v2']);
    expect(test.prisma.coachMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          content: expect.not.stringMatching(/resposta legada/u),
        }),
      }),
    );
    expect(test.transaction.scheduledMessage.upsert).toHaveBeenCalledTimes(1);
    expect(test.engine.generateCandidate).toHaveBeenCalledTimes(1);
    expect(test.planPersistence.persist).not.toHaveBeenCalled();
    expect(test.shadowRuntime.execute).not.toHaveBeenCalled();
  });

  it('does not call any V2 provider when the global pilot switch is disabled', async () => {
    const test = setup({ enabled: 'false' });

    await test.command.processTextMessage({
      userId: USER_ID,
      messageId: 'message-id',
    });

    expect(test.order).toEqual(['legacy']);
    expect(test.engine.generateCandidate).not.toHaveBeenCalled();
    expect(test.shadowRuntime.execute).toHaveBeenCalledTimes(1);
  });

  it('does not call any V2 provider when the user is outside the existing allowlist', async () => {
    const test = setup({
      allowed: '223e4567-e89b-42d3-a456-426614174000',
    });

    await test.command.processTextMessage({
      userId: USER_ID,
      messageId: 'message-id',
    });

    expect(test.order).toEqual(['legacy']);
    expect(test.engine.generateCandidate).not.toHaveBeenCalled();
    expect(test.planPersistence.persist).not.toHaveBeenCalled();
    expect(test.shadowRuntime.execute).toHaveBeenCalledTimes(1);
  });

  it('preserves legacy and Shadow for an ineligible goal', async () => {
    const test = setup({ goal: 'GENERATE_COMBINED_PLANS' });

    await test.command.processTextMessage({
      userId: USER_ID,
      messageId: 'message-id',
    });

    expect(test.order).toEqual(['legacy']);
    expect(test.engine.generateCandidate).not.toHaveBeenCalled();
    expect(test.shadowRuntime.execute).toHaveBeenCalledTimes(1);
  });
});
