import type { CoachAdaptiveProfileCollectorService } from '../context/coach-adaptive-profile-collector.service';
import type { CoachProfileSnapshotBuilder } from '../context/coach-profile-snapshot.builder';
import type { CoachProfileSnapshot } from '../context/coach-profile-snapshot.contract';
import type { ConversationGoalDecision } from '../context/conversation-goal-planner.contract';
import type { ConversationGoalPlannerService } from '../context/conversation-goal-planner.service';
import type { GenerateNutritionPlanV2InputBuilder } from '../diet/v2/generate-nutrition-plan-v2-input.builder';
import type { NutritionShadowRuntimeOrchestratorService } from '../diet/v2/shadow-runtime/nutrition-shadow-runtime-orchestrator.service';
import type { CoachPlanningExecutionDispatcherService } from './coach-planning-execution-dispatcher.service';
import type { LegacyCoachIntentAdapter } from './legacy-coach-intent.adapter';
import { CoachPlanningExecutionService } from './coach-planning-execution.service';
import type { NutritionKnowledgeResolverService } from '../nutrition-knowledge/nutrition-knowledge-resolver.service';
import type { NutritionReasoningEngineService } from '../nutrition-reasoning/nutrition-reasoning-engine.service';
import type { WorkoutKnowledgeResolverService } from '../workout-knowledge/workout-knowledge-resolver.service';
import type { WorkoutReasoningEngineService } from '../workout-reasoning/workout-reasoning-engine.service';

describe('CoachPlanningExecutionService', () => {
  it('builds the V2 input with the same snapshot and reference date without executing it', async () => {
    const unavailableDatum = Object.freeze({
      status: 'UNKNOWN' as const,
      sources: Object.freeze([]),
    });
    const snapshot = Object.freeze({
      completion: Object.freeze({
        overall: 'COMPLETE' as const,
        sections: Object.freeze([]),
      }),
      longitudinal: Object.freeze({
        latestProgressWeightKg: unavailableDatum,
        goalProgression: unavailableDatum,
        nutritionEvolution: unavailableDatum,
      }),
    }) as unknown as CoachProfileSnapshot;
    const decision = Object.freeze({
      recognizedIntent: 'DIET_PLAN_REQUEST',
      goal: 'GENERATE_DIET_PLAN',
      reason: 'DIET_PROFILE_READY',
      targetPlan: 'DIET',
      profileCompletionState: 'COMPLETE',
      canExecute: true,
      confidence: 'HIGH',
      selectedProfileField: null,
      metPreconditions: Object.freeze([]),
      missingPreconditions: Object.freeze([]),
      pendingDependencies: Object.freeze([]),
    }) satisfies ConversationGoalDecision;
    const dispatcher = {
      dispatchStructured: jest.fn().mockResolvedValue({
        content: 'resposta legada',
        executor: 'DIET_LEGACY',
        generationCompleted: true,
        fallbackApplied: false,
      }),
    };
    const snapshotBuilder = {
      build: jest.fn().mockResolvedValue(snapshot),
    };
    const intentAdapter = {
      adapt: jest.fn().mockReturnValue({
        recognizedIntent: 'DIET_PLAN_REQUEST',
        planTarget: 'DIET',
        acquisitionIntent: Object.freeze({}),
      }),
    };
    const collector = {
      decide: jest.fn().mockReturnValue(Object.freeze({})),
    };
    const planner = {
      plan: jest.fn().mockReturnValue(decision),
    };
    const inputBuilder = {
      build: jest.fn().mockReturnValue(Object.freeze({})),
    };
    const service = new CoachPlanningExecutionService(
      dispatcher as unknown as CoachPlanningExecutionDispatcherService,
      snapshotBuilder as unknown as CoachProfileSnapshotBuilder,
      intentAdapter as unknown as LegacyCoachIntentAdapter,
      collector as unknown as CoachAdaptiveProfileCollectorService,
      planner as unknown as ConversationGoalPlannerService,
      inputBuilder as unknown as GenerateNutritionPlanV2InputBuilder,
    );

    await expect(service.execute('user-id', 'DIET')).resolves.toBe(
      'resposta legada',
    );

    const referenceDate = snapshotBuilder.build.mock.calls[0][1];
    expect(referenceDate).toBeInstanceOf(Date);
    expect(inputBuilder.build).toHaveBeenCalledWith({
      userId: 'user-id',
      decision,
      snapshot,
      referenceDate,
    });
    expect(dispatcher.dispatchStructured).toHaveBeenCalledWith({
      userId: 'user-id',
      legacyIntent: 'DIET',
      decision,
    });
  });

  it('returns the official legacy response without awaiting or trusting Shadow Runtime', async () => {
    const unavailableDatum = Object.freeze({
      status: 'UNKNOWN' as const,
      sources: Object.freeze([]),
    });
    const snapshot = Object.freeze({
      completion: Object.freeze({
        overall: 'COMPLETE' as const,
        sections: Object.freeze([]),
      }),
      longitudinal: Object.freeze({
        latestProgressWeightKg: unavailableDatum,
        goalProgression: unavailableDatum,
        nutritionEvolution: unavailableDatum,
      }),
    }) as unknown as CoachProfileSnapshot;
    const decision = Object.freeze({
      recognizedIntent: 'DIET_PLAN_REQUEST',
      goal: 'GENERATE_DIET_PLAN',
      reason: 'DIET_PROFILE_READY',
      targetPlan: 'DIET',
      profileCompletionState: 'COMPLETE',
      canExecute: true,
      confidence: 'HIGH',
      selectedProfileField: null,
      metPreconditions: Object.freeze([]),
      missingPreconditions: Object.freeze([]),
      pendingDependencies: Object.freeze([]),
    }) satisfies ConversationGoalDecision;
    const dispatcher = {
      dispatchStructured: jest.fn().mockResolvedValue({
        content: 'resposta oficial legada',
        executor: 'DIET_LEGACY',
        generationCompleted: true,
        fallbackApplied: false,
      }),
    };
    const inputBuilder = {
      build: jest.fn().mockReturnValue({
        explicitArtifactType: 'WEEKLY_PLAN',
      }),
    };
    const runtime = {
      execute: jest.fn(() => {
        throw new Error('shadow indisponível');
      }),
    };
    const service = new CoachPlanningExecutionService(
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
      inputBuilder as unknown as GenerateNutritionPlanV2InputBuilder,
      runtime as unknown as NutritionShadowRuntimeOrchestratorService,
    );

    await expect(
      service.execute('user-id', 'DIET', {
        conversationId: 'conversation-id',
        messageId: 'message-id',
        correlationId: 'message-id',
        referenceDate: new Date('2026-07-29T12:00:00.000Z'),
      }),
    ).resolves.toBe('resposta oficial legada');
    expect(runtime.execute).toHaveBeenCalledTimes(1);
    expect(dispatcher.dispatchStructured).toHaveBeenCalledTimes(1);
  });

  it('produces each official reasoning once and preserves the exact instances in the structured result', async () => {
    const unavailableDatum = Object.freeze({
      status: 'UNKNOWN' as const,
      sources: Object.freeze([]),
    });
    const snapshot = Object.freeze({
      completion: Object.freeze({
        overall: 'COMPLETE' as const,
        sections: Object.freeze([]),
      }),
      longitudinal: Object.freeze({
        latestProgressWeightKg: unavailableDatum,
        goalProgression: unavailableDatum,
        nutritionEvolution: unavailableDatum,
      }),
    }) as unknown as CoachProfileSnapshot;
    const decision = Object.freeze({
      recognizedIntent: 'COMBINED_PLAN_REQUEST',
      goal: 'GENERATE_COMBINED_PLANS',
      reason: 'COMBINED_PROFILE_READY',
      targetPlan: 'BOTH',
      profileCompletionState: 'COMPLETE',
      canExecute: true,
      confidence: 'HIGH',
      selectedProfileField: null,
      metPreconditions: Object.freeze([]),
      missingPreconditions: Object.freeze([]),
      pendingDependencies: Object.freeze([]),
    }) satisfies ConversationGoalDecision;
    const nutritionResult = Object.freeze({ marker: 'nutrition' });
    const workoutResult = Object.freeze({ marker: 'workout' });
    const dispatcher = {
      dispatch: jest.fn(),
      dispatchStructured: jest.fn().mockResolvedValue(
        Object.freeze({
          content: 'resposta combinada',
          executor: 'COMBINED_LEGACY',
          generationCompleted: true,
          fallbackApplied: false,
        }),
      ),
    };
    const planner = { plan: jest.fn().mockReturnValue(decision) };
    const nutritionReasoning = {
      reason: jest.fn().mockReturnValue(nutritionResult),
    };
    const workoutReasoning = {
      reason: jest.fn().mockReturnValue(workoutResult),
    };
    const service = new CoachPlanningExecutionService(
      dispatcher as unknown as CoachPlanningExecutionDispatcherService,
      {
        build: jest.fn().mockResolvedValue(snapshot),
      } as unknown as CoachProfileSnapshotBuilder,
      {
        adapt: jest.fn().mockReturnValue({
          recognizedIntent: 'COMBINED_PLAN_REQUEST',
          planTarget: 'BOTH',
          acquisitionIntent: Object.freeze({}),
        }),
      } as unknown as LegacyCoachIntentAdapter,
      {
        decide: jest.fn().mockReturnValue(Object.freeze({})),
      } as unknown as CoachAdaptiveProfileCollectorService,
      planner as unknown as ConversationGoalPlannerService,
      {
        build: jest.fn().mockReturnValue({
          explicitArtifactType: 'DAILY_STRUCTURE',
        }),
      } as unknown as GenerateNutritionPlanV2InputBuilder,
      undefined,
      undefined,
      {
        resolve: jest.fn().mockReturnValue({ packages: Object.freeze([]) }),
      } as unknown as NutritionKnowledgeResolverService,
      nutritionReasoning as unknown as NutritionReasoningEngineService,
      {
        resolve: jest.fn().mockReturnValue(Object.freeze({})),
      } as unknown as WorkoutKnowledgeResolverService,
      workoutReasoning as unknown as WorkoutReasoningEngineService,
    );

    const result = await service.executeStructured('user-id', 'BOTH', {
      conversationId: 'conversation-id',
      messageId: 'message-id',
      correlationId: 'correlation-id',
      referenceDate: new Date('2026-08-02T12:00:00.000Z'),
    });

    expect(result.content).toBe('resposta combinada');
    expect(result.decision).toBe(decision);
    expect(result.nutritionReasoning).toBe(nutritionResult);
    expect(result.workoutReasoning).toBe(workoutResult);
    expect(result.longitudinalDecision).toBeNull();
    expect(result.reasoning.nutrition.reasoningObservedOnly).toBe(true);
    expect(result.reasoning.workout.reasoningAppliedToGeneration).toBe(false);
    expect(result.reasoning.longitudinal.unavailableReason).toBe(
      'CANONICAL_INPUT_UNAVAILABLE',
    );
    expect(planner.plan).toHaveBeenCalledTimes(1);
    expect(nutritionReasoning.reason).toHaveBeenCalledTimes(1);
    expect(workoutReasoning.reason).toHaveBeenCalledTimes(1);
    expect(dispatcher.dispatchStructured).toHaveBeenCalledTimes(1);
    expect(dispatcher.dispatch).not.toHaveBeenCalled();
  });

  it('keeps reasoning unavailable without a runtime context', async () => {
    const dispatcher = {
      dispatchStructured: jest.fn().mockResolvedValue({
        content: 'legado',
        executor: 'UNKNOWN_LEGACY',
        generationCompleted: false,
        fallbackApplied: false,
      }),
    };
    const nutritionReasoning = { reason: jest.fn() };
    const workoutReasoning = { reason: jest.fn() };
    const service = new CoachPlanningExecutionService(
      dispatcher as unknown as CoachPlanningExecutionDispatcherService,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      nutritionReasoning as unknown as NutritionReasoningEngineService,
      undefined,
      workoutReasoning as unknown as WorkoutReasoningEngineService,
    );

    const result = await service.executeStructured('user-id', 'UNKNOWN');

    expect(result.content).toBe('legado');
    expect(result.nutritionReasoning).toBeNull();
    expect(result.workoutReasoning).toBeNull();
    expect(result.reasoning.nutrition.unavailableReason).toBe(
      'CONVERSATION_LAYER_OFF',
    );
    expect(nutritionReasoning.reason).not.toHaveBeenCalled();
    expect(workoutReasoning.reason).not.toHaveBeenCalled();
  });
});
