import { FitnessGoal, UserGoalType } from '@prisma/client';
import type { CoachAdaptiveProfileCollectorService } from '../context/coach-adaptive-profile-collector.service';
import type { CoachProfileSnapshotBuilder } from '../context/coach-profile-snapshot.builder';
import type { CoachProfileSnapshot } from '../context/coach-profile-snapshot.contract';
import type { ConversationGoalDecision } from '../context/conversation-goal-planner.contract';
import type { ConversationGoalPlannerService } from '../context/conversation-goal-planner.service';
import type { GenerateNutritionPlanV2InputBuilder } from '../diet/v2/generate-nutrition-plan-v2-input.builder';
import type { CoachPlanningExecutionDispatcherService } from './coach-planning-execution-dispatcher.service';
import { CoachPlanningExecutionService } from './coach-planning-execution.service';
import type { LegacyCoachIntentAdapter } from './legacy-coach-intent.adapter';
import type { PendingGoalConfirmationContext } from './pending-conversation-action.contract';
import type { PendingConversationActionService } from './pending-conversation-action.service';
import type { PlanningExecutionRoutePolicyService } from './planning-execution-route-policy.service';
import { UserGoalEngineService } from './user-goal-engine.service';

describe('Pending goal confirmation planning flow', () => {
  const referenceDate = new Date('2026-08-12T12:01:00.000Z');
  const originalMessage =
    'Quero perder gordura e ganhar massa muscular. Monte uma dieta para mim com 4 refeições por dia.';

  function decision(): ConversationGoalDecision {
    return Object.freeze({
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
    });
  }

  function snapshot(): CoachProfileSnapshot {
    const unknown = Object.freeze({
      status: 'UNKNOWN' as const,
      sources: Object.freeze([]),
    });
    return {
      nutrition: {
        desiredMealCount: unknown,
        primaryGoal: unknown,
        desiredOutcome: unknown,
      },
      training: { primaryGoal: unknown },
      completion: { overall: 'COMPLETE', sections: Object.freeze([]) },
      longitudinal: {
        latestProgressWeightKg: unknown,
        goalProgression: unknown,
        nutritionEvolution: unknown,
      },
    } as unknown as CoachProfileSnapshot;
  }

  function pending(
    status: 'RESOLVED' | 'REQUIRES_CONFIRMATION' = 'RESOLVED',
  ): PendingGoalConfirmationContext {
    const resolution =
      status === 'RESOLVED'
        ? Object.freeze({
            status: 'RESOLVED' as const,
            reason: 'EXPLICIT_CURRENT_GOAL' as const,
            primaryGoal: FitnessGoal.WEIGHT_LOSS,
            classificationGoal: UserGoalType.WEIGHT_LOSS,
            confidence: 0.98,
            declaredOutcome: 'emagrecimento',
          })
        : Object.freeze({
            status: 'REQUIRES_CONFIRMATION' as const,
            reason: 'AMBIGUOUS_CURRENT_GOAL',
            composite: false,
            declaredOutcome: null,
          });
    return Object.freeze({
      actionId: 'action-id',
      operationKey: 'pending-goal-confirmation:source-message-id',
      originalIntent: 'DIET',
      payload: Object.freeze({
        schemaVersion: 1 as const,
        declaredOutcome: 'perder gordura e ganhar massa muscular',
        allowedGoals: Object.freeze([
          FitnessGoal.WEIGHT_LOSS,
          FitnessGoal.MUSCLE_GAIN,
          FitnessGoal.MAINTENANCE,
        ]),
        originalIntent: 'DIET' as const,
        targetPlan: 'DIET' as const,
        originalMessage,
        originalReferenceDate: '2026-08-12T12:00:00.000Z',
        desiredMealCount: 4,
        resolvedGoal: null,
        selectedRoute: null,
      }),
      continuation: false,
      resolution,
    });
  }

  function setup(options?: {
    route?: 'V2' | 'LEGACY';
    consumption?: 'APPLIED' | 'CONTINUE' | 'REPLAY' | 'ALREADY_CONSUMED';
    executionClaim?: 'CLAIMED' | 'IN_PROGRESS' | 'COMPLETED';
  }) {
    const order: string[] = [];
    let claimSequence = 0;
    const route = options?.route ?? 'V2';
    const inputBuilder = {
      build: jest.fn((source: object) => ({ source })),
    };
    const pendingActions = {
      createGoalConfirmation: jest.fn(() => {
        order.push('create-pending');
        return Promise.resolve(pending());
      }),
      consumeGoalConfirmation: jest.fn(() => {
        order.push('consume-goal');
        return Promise.resolve(options?.consumption ?? 'APPLIED');
      }),
      claimGoalContinuationExecution: jest.fn().mockImplementation(() => {
        const status = options?.executionClaim ?? 'CLAIMED';
        return Promise.resolve(
          status === 'CLAIMED'
            ? {
                status,
                claimToken: `claim-token-${(claimSequence += 1)}`,
              }
            : { status },
        );
      }),
      releaseGoalContinuationExecution: jest.fn(() => {
        order.push('release-execution');
        return Promise.resolve('RELEASED');
      }),
    };
    const routePolicy = {
      select: jest.fn(() => {
        order.push('select-route');
        return {
          nutrition: route,
          workout: null,
          reason:
            route === 'V2'
              ? 'NUTRITION_V2_ELIGIBLE'
              : 'NUTRITION_PILOT_NOT_ELIGIBLE',
          nutritionPilotStatus: route === 'V2' ? 'ELIGIBLE' : 'NOT_ALLOWLISTED',
          suppressNutritionShadow: route === 'V2',
        };
      }),
    };
    const dispatcher = {
      dispatchStructured: jest.fn(
        (input: { decision: ConversationGoalDecision | null }) => {
          order.push(
            input.decision?.goal === 'REQUEST_CONFIRMATION'
              ? 'confirmation-response'
              : route === 'V2'
                ? 'generate-v2'
                : 'generate-legacy',
          );
          return Promise.resolve({
            content:
              input.decision?.goal === 'REQUEST_CONFIRMATION'
                ? 'confirme o objetivo'
                : 'plano gerado',
            executor:
              input.decision?.goal === 'REQUEST_CONFIRMATION'
                ? ('UNKNOWN_LEGACY' as const)
                : route === 'V2'
                  ? ('DIET_V2' as const)
                  : ('DIET_LEGACY' as const),
            generationCompleted:
              input.decision?.goal !== 'REQUEST_CONFIRMATION',
            fallbackApplied: false,
          });
        },
      ),
    };
    const service = new CoachPlanningExecutionService(
      dispatcher as unknown as CoachPlanningExecutionDispatcherService,
      {
        build: jest.fn().mockResolvedValue(snapshot()),
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
        plan: jest.fn().mockReturnValue(decision()),
      } as unknown as ConversationGoalPlannerService,
      inputBuilder as unknown as GenerateNutritionPlanV2InputBuilder,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      routePolicy as unknown as PlanningExecutionRoutePolicyService,
      new UserGoalEngineService(),
      undefined,
      undefined,
      pendingActions as unknown as PendingConversationActionService,
    );
    return { service, order, inputBuilder, pendingActions, dispatcher };
  }

  it('creates one durable action for the composite first turn after route selection and generates no plan', async () => {
    const test = setup();
    const result = await test.service.executeStructured('user-id', 'DIET', {
      conversationId: 'conversation-id',
      messageId: 'source-message-id',
      correlationId: 'source-message-id',
      profileId: 'profile-id',
      currentMessage: originalMessage,
      referenceDate: new Date('2026-08-12T12:00:00.000Z'),
    });

    expect(result.decision).toMatchObject({
      goal: 'REQUEST_CONFIRMATION',
      canExecute: false,
    });
    expect(test.order).toEqual([
      'select-route',
      'create-pending',
      'confirmation-response',
    ]);
    expect(test.pendingActions.createGoalConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({
        originalIntent: 'DIET',
        originalMessage,
      }),
    );
    expect(result.metadata.generationCompleted).toBe(false);
  });

  it.each([
    ['V2', 'generate-v2', 'NUTRITION_V2'],
    ['LEGACY', 'generate-legacy', 'LEGACY'],
  ] as const)(
    'resumes DIET through the normal %s route, preserving four meals',
    async (route, generationStep, selectedSource) => {
      const test = setup({ route });
      const result = await test.service.executeStructured('user-id', 'DIET', {
        conversationId: 'conversation-id',
        messageId: 'consumer-message-id',
        correlationId: 'consumer-message-id',
        profileId: 'profile-id',
        currentMessage: originalMessage,
        referenceDate,
        pendingGoalConfirmation: pending(),
      });

      expect(test.order).toEqual([
        'select-route',
        'consume-goal',
        generationStep,
      ]);
      expect(result.responseRequired).toBe(true);
      expect(result.selectedSource).toBe(selectedSource);
      expect(result.metadata.generationCompleted).toBe(true);
      expect(result.metadata.fallbackApplied).toBe(false);
      expect(test.inputBuilder.build).toHaveBeenCalledWith(
        expect.objectContaining({
          snapshot: expect.objectContaining({
            nutrition: expect.objectContaining({
              desiredMealCount: expect.objectContaining({
                status: 'KNOWN',
                value: 4,
              }),
            }),
          }),
        }),
      );
    },
  );

  it('keeps an ambiguous action pending and asks again without generation', async () => {
    const test = setup();
    const result = await test.service.executeStructured('user-id', 'DIET', {
      conversationId: 'conversation-id',
      messageId: 'consumer-message-id',
      correlationId: 'consumer-message-id',
      currentMessage: originalMessage,
      referenceDate,
      pendingGoalConfirmation: pending('REQUIRES_CONFIRMATION'),
    });

    expect(test.order).toEqual(['select-route', 'confirmation-response']);
    expect(test.pendingActions.consumeGoalConfirmation).not.toHaveBeenCalled();
    expect(result.metadata.generationCompleted).toBe(false);
  });

  it.each(['REPLAY', 'ALREADY_CONSUMED'] as const)(
    'suppresses a second generation and response when consumption is %s',
    async (consumption) => {
      const test = setup({ consumption });
      const result = await test.service.executeStructured('user-id', 'DIET', {
        conversationId: 'conversation-id',
        messageId: 'consumer-message-id',
        correlationId: 'consumer-message-id',
        profileId: 'profile-id',
        currentMessage: originalMessage,
        referenceDate,
        pendingGoalConfirmation: pending(),
      });

      expect(test.order).toEqual(['select-route', 'consume-goal']);
      expect(test.dispatcher.dispatchStructured).not.toHaveBeenCalled();
      expect(result.responseRequired).toBe(false);
      expect(result.metadata.generationCompleted).toBe(false);
    },
  );

  it('resumes the stored route after a crash between consume and dispatch', async () => {
    const test = setup({ route: 'V2', consumption: 'CONTINUE' });
    const initial = pending();
    const storedRoute = Object.freeze({
      nutrition: 'V2' as const,
      workout: null,
      reason: 'NUTRITION_V2_ELIGIBLE' as const,
      nutritionPilotStatus: 'ELIGIBLE' as const,
      suppressNutritionShadow: true,
    });
    const continuation = Object.freeze({
      ...initial,
      continuation: true,
      payload: Object.freeze({
        ...initial.payload,
        resolvedGoal: FitnessGoal.WEIGHT_LOSS,
        selectedRoute: storedRoute,
      }),
    });

    const result = await test.service.executeStructured('user-id', 'DIET', {
      conversationId: 'conversation-id',
      messageId: 'consumer-message-id',
      correlationId: 'consumer-message-id',
      profileId: 'profile-id',
      currentMessage: originalMessage,
      referenceDate,
      pendingGoalConfirmation: continuation,
    });

    expect(test.order).toEqual(['consume-goal', 'generate-v2']);
    expect(test.dispatcher.dispatchStructured).toHaveBeenCalledTimes(1);
    expect(result.responseRequired).toBe(true);
    expect(result.metadata.generationCompleted).toBe(true);
  });

  it('does not generate again when the continuation is already completed', async () => {
    const test = setup({
      consumption: 'CONTINUE',
      executionClaim: 'COMPLETED',
    });

    const result = await test.service.executeStructured('user-id', 'DIET', {
      conversationId: 'conversation-id',
      messageId: 'consumer-message-id',
      correlationId: 'consumer-message-id',
      profileId: 'profile-id',
      currentMessage: originalMessage,
      referenceDate,
      pendingGoalConfirmation: pending(),
    });

    expect(test.order).toEqual(['select-route', 'consume-goal']);
    expect(test.dispatcher.dispatchStructured).not.toHaveBeenCalled();
    expect(result.responseRequired).toBe(false);
    expect(result.metadata.generationCompleted).toBe(false);
  });

  it('releases a failed continuation without producing a terminal fallback and retries successfully', async () => {
    const test = setup({ consumption: 'CONTINUE' });
    const providerError = new Error('provider unavailable');
    test.dispatcher.dispatchStructured.mockRejectedValueOnce(providerError);

    await expect(
      test.service.executeStructured('user-id', 'DIET', {
        conversationId: 'conversation-id',
        messageId: 'consumer-message-id',
        correlationId: 'consumer-message-id',
        profileId: 'profile-id',
        currentMessage: originalMessage,
        referenceDate,
        pendingGoalConfirmation: pending(),
      }),
    ).rejects.toBe(providerError);
    expect(
      test.pendingActions.releaseGoalContinuationExecution,
    ).toHaveBeenCalledTimes(1);

    const recovered = await test.service.executeStructured('user-id', 'DIET', {
      conversationId: 'conversation-id',
      messageId: 'consumer-message-id',
      correlationId: 'consumer-message-id',
      profileId: 'profile-id',
      currentMessage: originalMessage,
      referenceDate,
      pendingGoalConfirmation: pending(),
    });
    expect(recovered.responseRequired).toBe(true);
    expect(recovered.metadata.generationCompleted).toBe(true);
    expect(test.dispatcher.dispatchStructured).toHaveBeenCalledTimes(2);
  });
});
