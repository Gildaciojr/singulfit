import { workoutEquipmentBaseline } from '../workout/v2/workout-equipment-defaults';
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
import type { NutritionV2PilotService } from './nutrition-v2-pilot.service';
import type { PlanningExecutionRoutePolicyService } from './planning-execution-route-policy.service';
import { FitnessGoal } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { UserGoalEngineService } from './user-goal-engine.service';
import type { GenerateWorkoutPlanV2InputBuilder } from '../workout/v2/generate-workout-plan-v2-input.builder';
import type { WorkoutPlanMutationResolverService } from '../workout/v2/workout-plan-mutation-resolver.service';
import { UsageLimitExceededException } from '../entitlements/usage-limit.exception';
import { DurableTextPendingError } from '../ai/durable-text-operation.contract';
import type { CoachPlanningRuntimeContext } from './coach-planning-execution.service';
import type { PendingGoalConfirmationContext } from './pending-conversation-action.contract';
import { isWorkoutEffectAuthorized } from '../workout/v2/workout-generation-authorization.policy';

describe('CoachPlanningExecutionService', () => {
  it.each([
    'Já concluí meu treino de musculação na academia.',
    'Hoje fiz CrossFit.',
    'Quero uma dica sobre musculação.',
    'Quero academia.',
    'CrossFit',
  ])('a literal quote of %s is not authorization', (text) => {
    expect(
      isWorkoutEffectAuthorized(text, {
        effect: 'GENERATE',
        requestQuote: text,
      }),
    ).toBe(false);
  });
  it('requires owned inbound and owned original request for a legitimately resolved pending confirmation', async () => {
    const service = new CoachPlanningExecutionService({} as never);
    const originalMessage = 'Monte um treino de musculação para mim.';
    const resolution = new UserGoalEngineService().resolveCurrentMessage(
      'Quero emagrecer',
    );
    if (resolution.status !== 'RESOLVED')
      throw new Error('Invalid goal fixture');
    const context: PendingGoalConfirmationContext = {
      actionId: 'action',
      operationKey: 'pending-goal-confirmation:original',
      originalIntent: 'WORKOUT',
      continuation: true,
      resolution,
      payload: {
        schemaVersion: 1,
        declaredOutcome: null,
        allowedGoals: [FitnessGoal.WEIGHT_LOSS],
        originalIntent: 'WORKOUT',
        targetPlan: 'WORKOUT',
        originalMessage,
        originalReferenceDate: '2026-08-18T12:00:00Z',
        desiredMealCount: null,
        resolvedGoal: FitnessGoal.WEIGHT_LOSS,
        selectedRoute: null,
      },
    };
    const findFirst = jest.fn(
      ({
        where,
      }: {
        where: {
          id: string;
          conversationId: string;
          conversation: { userId: string };
        };
      }) =>
        Promise.resolve(
          where.conversationId === 'conversation-id' &&
            where.conversation.userId === 'user-id' &&
            ['original', 'consumer'].includes(where.id)
            ? {
                content:
                  where.id === 'original' ? originalMessage : 'Quero emagrecer',
                timestamp: new Date('2026-08-18T12:00:00Z'),
              }
            : null,
        ),
    );
    const pending = {
      findPendingForInbound: jest
        .fn()
        .mockResolvedValue({ status: 'ACTIONABLE', context }),
    };
    Object.defineProperty(service, 'prisma', {
      configurable: true,
      value: { message: { findFirst } },
    });
    Object.defineProperty(service, 'pendingActions', { value: pending });
    const runtime: CoachPlanningRuntimeContext = {
      conversationId: 'conversation-id',
      messageId: 'consumer',
      correlationId: 'consumer',
      referenceDate: new Date(),
      currentMessage: originalMessage,
      pendingGoalConfirmation: context,
    };
    const boundary = service as unknown as {
      authorizeWorkoutEffect(
        userId: string,
        runtime?: CoachPlanningRuntimeContext,
      ): Promise<boolean>;
    };
    const evaluate = (userId: string, input?: CoachPlanningRuntimeContext) =>
      boundary.authorizeWorkoutEffect(userId, input);
    expect(await evaluate('user-id', runtime)).toBe(true);
    findFirst.mockResolvedValueOnce({
      content: 'Não gere um treino. Quero emagrecer.',
      timestamp: new Date('2026-08-18T12:00:00Z'),
    });
    expect(await evaluate('user-id', runtime)).toBe(false);
    for (const content of [
      'Evite criar um novo plano de treino.',
      'Quero que você evite criar um novo treino.',
      'Por favor, pare de montar planos para mim.',
    ]) {
      findFirst.mockResolvedValueOnce({
        content,
        timestamp: new Date('2026-08-18T12:00:00Z'),
      });
      expect(await evaluate('user-id', runtime)).toBe(false);
    }
    expect(await evaluate('other-user', runtime)).toBe(false);
    expect(
      await evaluate('user-id', {
        ...runtime,
        messageId: 'different-consumer',
      }),
    ).toBe(false);
    expect(
      await evaluate('user-id', {
        ...runtime,
        conversationId: 'other-conversation',
      }),
    ).toBe(false);
    expect(
      await evaluate('user-id', { ...runtime, currentMessage: undefined }),
    ).toBe(false);
    expect(
      await evaluate('user-id', {
        ...runtime,
        pendingGoalConfirmation: { ...context, actionId: 'forged' },
      }),
    ).toBe(false);
    findFirst.mockResolvedValueOnce({
      content: 'Quero emagrecer',
      timestamp: new Date(),
    });
    findFirst.mockResolvedValueOnce(null);
    expect(await evaluate('user-id', runtime)).toBe(false);
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'original',
          conversation: { userId: 'user-id' },
          direction: 'INBOUND',
          type: 'TEXT',
        }),
      }),
    );
    findFirst.mockImplementation(({ where }) =>
      Promise.resolve(
        where.conversation.userId === 'user-id'
          ? {
              content:
                where.id === 'original'
                  ? `Já bebi água. ${originalMessage}`
                  : 'Quero emagrecer',
              timestamp: new Date('2026-08-18T12:00:00Z'),
            }
          : null,
      ),
    );
    expect(await evaluate('user-id', runtime)).toBe(true);
    const profileContext = {
      ...context,
      operationKey: 'pending-goal-confirmation:profile-answer',
    };
    pending.findPendingForInbound.mockResolvedValue({
      status: 'ACTIONABLE',
      context: profileContext,
    });
    const cycles = {
      findFirst: jest.fn().mockResolvedValue({ origin: 'WORKOUT_V2:original' }),
    };
    Object.defineProperty(service, 'prisma', {
      configurable: true,
      value: { message: { findFirst }, coachProfileAcquisitionCycle: cycles },
    });
    findFirst.mockImplementation(({ where }) =>
      Promise.resolve(
        where.conversation.userId === 'user-id'
          ? {
              content:
                where.id === 'original'
                  ? originalMessage
                  : where.id === 'profile-answer'
                    ? 'Academia'
                    : 'Quero emagrecer',
              timestamp: new Date('2026-08-18T12:00:00Z'),
            }
          : null,
      ),
    );
    expect(
      await evaluate('user-id', {
        ...runtime,
        pendingGoalConfirmation: profileContext,
      }),
    ).toBe(true);
    cycles.findFirst.mockResolvedValueOnce(null);
    expect(
      await evaluate('user-id', {
        ...runtime,
        pendingGoalConfirmation: profileContext,
      }),
    ).toBe(false);
  });
  it('cannot authorize an original request ID without a stored acquisition response binding', async () => {
    const service = new CoachPlanningExecutionService({} as never);
    const currentMessage = 'Monte um treino de CrossFit 4 vezes por semana';
    const findFirst = jest.fn(
      ({
        where,
      }: {
        where: { id: string; conversation: { userId: string } };
      }) =>
        Promise.resolve(
          where.conversation.userId === 'user-id' &&
            ['root', 'answer'].includes(where.id)
            ? {
                content: where.id === 'root' ? currentMessage : 'Academia',
                timestamp: new Date('2026-08-18T12:00:00Z'),
              }
            : null,
        ),
    );
    const cycle = { findFirst: jest.fn().mockResolvedValue(null) };
    Object.defineProperty(service, 'prisma', {
      value: { message: { findFirst }, coachProfileAcquisitionCycle: cycle },
    });
    const boundary = service as unknown as {
      authorizeWorkoutEffect(
        userId: string,
        runtime: CoachPlanningRuntimeContext,
      ): Promise<boolean>;
    };
    const runtime = {
      currentMessage,
      originalRequestMessageId: 'root',
      conversationId: 'conversation-id',
      messageId: 'answer',
      correlationId: 'answer',
      referenceDate: new Date(),
    };
    expect(await boundary.authorizeWorkoutEffect('user-id', runtime)).toBe(
      false,
    );
    cycle.findFirst.mockResolvedValue({ id: 'owned-completed-cycle' });
    expect(await boundary.authorizeWorkoutEffect('user-id', runtime)).toBe(
      true,
    );
    expect(cycle.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 'user-id',
          active: false,
          origin: { endsWith: ':root' },
          OR: expect.arrayContaining([
            expect.objectContaining({ status: 'ANSWERED' }),
            expect.objectContaining({ status: 'COMPLETED' }),
          ]),
        }),
      }),
    );
    expect(await boundary.authorizeWorkoutEffect('other-user', runtime)).toBe(
      false,
    );
    expect(
      await boundary.authorizeWorkoutEffect('user-id', {
        ...runtime,
        originalRequestMessageId: 'foreign-root',
      }),
    ).toBe(false);
  });
  it('does not authorize a request quote stripped from a negated full turn', () => {
    expect(
      isWorkoutEffectAuthorized('Não quero um novo treino de CrossFit', {
        effect: 'GENERATE',
        requestQuote: 'quero um novo treino de CrossFit',
      }),
    ).toBe(false);
  });
  function ownedInbound(
    service: CoachPlanningExecutionService,
    content: string,
    messageId = 'message-id',
  ) {
    const findFirst = jest.fn(
      ({
        where,
      }: {
        where: {
          id: string;
          conversationId: string;
          conversation: { userId: string };
        };
      }) =>
        Promise.resolve(
          where.id === messageId &&
            where.conversationId === 'conversation-id' &&
            where.conversation.userId === 'user-id'
            ? { content, timestamp: new Date('2026-08-18T12:00:00Z') }
            : null,
        ),
    );
    Object.defineProperty(service, 'prisma', {
      value: { message: { findFirst } },
    });
    return findFirst;
  }
  it('fences an inferred WORKOUT intent for the real retrospective report before dispatcher or persistence effects', async () => {
    const dispatcher = { dispatchStructured: jest.fn() };
    const service = new CoachPlanningExecutionService(
      dispatcher as unknown as CoachPlanningExecutionDispatcherService,
    );
    const result = await service.executeStructured('user-id', 'WORKOUT', {
      conversationId: 'conversation-id',
      messageId: 'message-id',
      correlationId: 'correlation-id',
      referenceDate: new Date(),
      currentMessage:
        'Bom dia. Já tomei 1 litro de água pela manhã e já realizei meu treino de superiores na academia.',
    });
    expect(result.dispatch?.generationCompleted).toBe(false);
    expect(result.dispatch?.workoutDisposition).toBe('BLOCKED');
    expect(dispatcher.dispatchStructured).not.toHaveBeenCalled();
  });
  it('suppresses a durable pending response instead of presenting it as FAILURE_FALLBACK', async () => {
    const dispatcher = {
      dispatchStructured: jest
        .fn()
        .mockRejectedValue(new DurableTextPendingError()),
    };
    const service = new CoachPlanningExecutionService(
      dispatcher as unknown as CoachPlanningExecutionDispatcherService,
    );
    const result = await service.executeStructured('user-id', 'BOTH', {
      conversationId: 'conversation-id',
      messageId: 'message-id',
      correlationId: 'correlation-id',
      referenceDate: new Date(),
    });
    expect(result.responseRequired).toBe(false);
    expect(result.content).toBe('');
    expect(result.dispatch).toMatchObject({
      executor: 'NO_GENERATION',
      fallbackApplied: false,
      generationCompleted: false,
    });
  });
  it('keeps combined root identity across acquisition turns and isolates independent requests', async () => {
    const dispatcher = {
      dispatchStructured: jest.fn().mockResolvedValue({
        content: '',
        executor: 'V2_DECOMPOSITION',
        generationCompleted: false,
        fallbackApplied: false,
      }),
    };
    const service = new CoachPlanningExecutionService(
      dispatcher as unknown as CoachPlanningExecutionDispatcherService,
    );
    const referenceDate = new Date('2026-09-05T12:00:00Z');
    for (const messageId of ['answer-one', 'answer-two']) {
      await service.executeStructured('user-id', 'BOTH', {
        conversationId: 'conversation-id',
        messageId,
        originalRequestMessageId: 'root-id',
        correlationId: messageId,
        referenceDate,
      });
      expect(dispatcher.dispatchStructured).toHaveBeenLastCalledWith(
        expect.objectContaining({
          continuationOperationKey:
            'combined-continuation:conversation-id:root-id:nutrition',
        }),
      );
    }
    await service.executeStructured('user-id', 'BOTH', {
      conversationId: 'conversation-id',
      messageId: 'independent-id',
      correlationId: 'independent-id',
      referenceDate,
    });
    expect(dispatcher.dispatchStructured).toHaveBeenLastCalledWith(
      expect.objectContaining({
        continuationOperationKey:
          'combined-continuation:conversation-id:independent-id:nutrition',
      }),
    );
  });
  it.each([
    ['DIET', 'plano alimentar'],
    ['WORKOUT', 'treino'],
    ['BOTH', 'planos'],
  ] as const)(
    'reports a %s execution failure in the correct domain',
    async (intent, expectedDomain) => {
      const dispatcher = {
        dispatchStructured: jest
          .fn()
          .mockRejectedValue(new Error('execution failed')),
      };
      const service = new CoachPlanningExecutionService(
        dispatcher as unknown as CoachPlanningExecutionDispatcherService,
      );
      const result = await service.executeStructured('user-id', intent);
      expect(result.content).toContain(expectedDomain);
      if (intent !== 'WORKOUT') expect(result.content).not.toContain('treino');
      expect(result.metadata.executor).toBe('FAILURE_FALLBACK');
    },
  );

  it.each([
    ['Qual é meu treino atual?', 'UNKNOWN'],
    ['Qual é meu treino de hoje?', 'UNKNOWN'],
    ['Sessão 1', 'UNKNOWN'],
    ['Quero os exercícios da sessão 3', 'UNKNOWN'],
  ] as const)(
    'routes "%s" to the canonical Workout reader before preparation',
    async (currentMessage, intent) => {
      const dispatcher = {
        dispatchStructured: jest.fn().mockResolvedValue({
          content: 'Plano Workout canônico preexistente',
          executor: 'WORKOUT_V2_READER',
          generationCompleted: false,
          fallbackApplied: false,
        }),
      };
      const snapshotBuilder = { build: jest.fn() };
      const service = new CoachPlanningExecutionService(
        dispatcher as unknown as CoachPlanningExecutionDispatcherService,
        snapshotBuilder as unknown as CoachProfileSnapshotBuilder,
      );
      const referenceDate = new Date('2026-09-02T12:00:00.000Z');

      const result = await service.executeStructured('user-id', intent, {
        conversationId: 'conversation-id',
        messageId: 'message-id',
        correlationId: 'message-id',
        currentMessage,
        referenceDate,
      });

      expect(result).toMatchObject({
        content: 'Plano Workout canônico preexistente',
        responseRequired: true,
        selectedSource: 'WORKOUT_V2',
        decision: {
          recognizedIntent: 'CURRENT_PLAN_REQUEST',
          goal: 'SHOW_CURRENT_PLAN',
          targetPlan: 'WORKOUT',
        },
        dispatch: {
          executor: 'WORKOUT_V2_READER',
          generationCompleted: false,
        },
        metadata: {
          routeSelection: {
            nutrition: null,
            workout: 'V2',
            reason: 'WORKOUT_V2_CANONICAL_READ',
          },
        },
      });
      expect(dispatcher.dispatchStructured).toHaveBeenCalledWith({
        userId: 'user-id',
        legacyIntent: intent,
        decision: expect.objectContaining({ targetPlan: 'WORKOUT' }),
        routeSelection: expect.objectContaining({ workout: 'V2' }),
        currentMessage,
        referenceDate,
      });
      expect(snapshotBuilder.build).not.toHaveBeenCalled();
    },
  );

  it.each(['quero um novo treino', 'adapte meu treino', 'substitua o supino'])(
    'does not route "%s" through the current Workout read fence',
    async (currentMessage) => {
      const dispatcher = { dispatchStructured: jest.fn() };
      const snapshotBuilder = {
        build: jest.fn().mockRejectedValue(new Error('preparation reached')),
      };
      const service = new CoachPlanningExecutionService(
        dispatcher as unknown as CoachPlanningExecutionDispatcherService,
        snapshotBuilder as unknown as CoachProfileSnapshotBuilder,
        { adapt: jest.fn() } as unknown as LegacyCoachIntentAdapter,
        {
          decide: jest.fn(),
        } as unknown as CoachAdaptiveProfileCollectorService,
        { plan: jest.fn() } as unknown as ConversationGoalPlannerService,
      );

      ownedInbound(service, currentMessage);
      const result = await service.executeStructured('user-id', 'WORKOUT', {
        conversationId: 'conversation-id',
        messageId: 'message-id',
        correlationId: 'message-id',
        currentMessage,
        referenceDate: new Date('2026-09-02T12:00:00.000Z'),
      });

      expect(snapshotBuilder.build).toHaveBeenCalledTimes(1);
      expect(result.dispatch.executor).toBe('FAILURE_FALLBACK');
    },
  );

  it('returns a deterministic commercial limit without fallback or shadow', async () => {
    const dispatcher = {
      dispatchStructured: jest
        .fn()
        .mockRejectedValue(
          new UsageLimitExceededException(
            'NUTRITION_PLAN_GENERATION',
            1,
            'Ana',
          ),
        ),
    };
    const service = new CoachPlanningExecutionService(
      dispatcher as unknown as CoachPlanningExecutionDispatcherService,
    );

    const result = await service.executeStructured('user-id', 'DIET', {
      conversationId: 'conversation-id',
      messageId: 'message-id',
      correlationId: 'message-id',
      currentMessage: 'quero outra dieta',
      referenceDate: new Date('2026-09-02T12:00:00.000Z'),
    });

    expect(result).toMatchObject({
      content:
        'Olá, Ana. Você atingiu seu limite de geração de plano alimentar deste mês. No plano Premium você tem acesso ilimitado a tudo que eu posso te ajudar.',
      selectedSource: 'COMMERCIAL_LIMIT',
      dispatch: {
        executor: 'COMMERCIAL_LIMIT',
        generationCompleted: false,
        fallbackApplied: false,
      },
    });
  });

  it('fails closed without dispatching legacy when Workout V2 preparation throws', async () => {
    const dispatcher = { dispatchStructured: jest.fn() };
    const service = new CoachPlanningExecutionService(
      dispatcher as unknown as CoachPlanningExecutionDispatcherService,
      {
        build: jest.fn().mockRejectedValue(new Error('snapshot unavailable')),
      } as unknown as CoachProfileSnapshotBuilder,
      { adapt: jest.fn() } as unknown as LegacyCoachIntentAdapter,
      { decide: jest.fn() } as unknown as CoachAdaptiveProfileCollectorService,
      { plan: jest.fn() } as unknown as ConversationGoalPlannerService,
    );

    const result = await service.executeStructured('user-id', 'WORKOUT', {
      conversationId: 'conversation-id',
      messageId: 'message-id',
      correlationId: 'message-id',
      referenceDate: new Date('2026-08-18T12:00:00.000Z'),
    });

    expect(result).toMatchObject({
      selectedSource: 'WORKOUT_V2',
      dispatch: {
        executor: 'FAILURE_FALLBACK',
        generationCompleted: false,
        fallbackApplied: false,
        workoutDisposition: 'BLOCKED',
      },
      metadata: {
        generationCompleted: false,
        routeSelection: {
          workout: 'V2',
          reason: 'WORKOUT_V2_PRODUCTIVE_GENERATION',
        },
      },
    });
    expect(dispatcher.dispatchStructured).not.toHaveBeenCalled();
  });

  it('fails closed without dispatching legacy when Workout V2 dependencies are unavailable', async () => {
    const dispatcher = { dispatchStructured: jest.fn() };
    const service = new CoachPlanningExecutionService(
      dispatcher as unknown as CoachPlanningExecutionDispatcherService,
    );

    const result = await service.executeStructured('user-id', 'WORKOUT');

    expect(result).toMatchObject({
      selectedSource: 'WORKOUT_V2',
      dispatch: {
        executor: 'FAILURE_FALLBACK',
        generationCompleted: false,
        fallbackApplied: false,
        workoutDisposition: 'BLOCKED',
      },
    });
    expect(dispatcher.dispatchStructured).not.toHaveBeenCalled();
  });

  it('uses the same declared workout context for current-turn readiness and generation', async () => {
    const currentMessage =
      'Quero que você monte um treino de musculação para mim. quero treinar 4 vezes por semana, cerca de 60 minutos por treino, na academia.';
    const unavailableDatum = Object.freeze({
      status: 'UNKNOWN' as const,
      sources: Object.freeze([]),
    });
    const snapshot = Object.freeze({
      completion: Object.freeze({ overall: 'PARTIAL', sections: [] }),
      longitudinal: Object.freeze({
        latestProgressWeightKg: unavailableDatum,
        goalProgression: unavailableDatum,
        nutritionEvolution: unavailableDatum,
      }),
    }) as unknown as CoachProfileSnapshot;
    const decision = Object.freeze({
      recognizedIntent: 'WORKOUT_PLAN_REQUEST',
      goal: 'ASK_PROFILE_INFORMATION',
      reason: 'PROFILE_INFORMATION_REQUIRED',
      targetPlan: 'WORKOUT',
      profileCompletionState: 'PARTIAL',
      canExecute: false,
      confidence: 'HIGH',
      selectedProfileField: 'TRAINING_MODALITY',
      metPreconditions: Object.freeze([]),
      missingPreconditions: Object.freeze([]),
      pendingDependencies: Object.freeze([]),
    }) satisfies ConversationGoalDecision;
    const recognizedContext = Object.freeze({
      modality: Object.freeze({
        status: 'CONFIRMED' as const,
        value: 'GYM_STRENGTH' as const,
      }),
      environment: Object.freeze({
        status: 'CONFIRMED' as const,
        value: 'FULL_GYM' as const,
      }),
      weeklyFrequency: Object.freeze({
        status: 'CONFIRMED' as const,
        value: 4,
      }),
      sessionDurationMinutes: Object.freeze({
        status: 'CONFIRMED' as const,
        value: 60,
      }),
    });
    const generationInput = Object.freeze({
      userId: 'user-id',
      recognizedContext,
    });
    const dispatcher = {
      dispatchStructured: jest.fn().mockResolvedValue({
        content: 'Treino V2',
        executor: 'WORKOUT_V2',
        generationCompleted: true,
        fallbackApplied: false,
        workoutDisposition: 'PLAN',
      }),
    };
    const workoutBuilder = {
      resolveDeclaredContext: jest.fn().mockReturnValue(recognizedContext),
      build: jest.fn().mockResolvedValue({
        generationInput,
        profileId: 'profile-id',
      }),
    };
    const routePolicy = {
      select: jest.fn().mockReturnValue({
        nutrition: null,
        workout: 'V2',
        reason: 'WORKOUT_V2_PRODUCTIVE_GENERATION',
        nutritionPilotStatus: null,
        suppressNutritionShadow: false,
      }),
    };
    const collector = {
      decide: jest.fn().mockReturnValue(Object.freeze({})),
    };
    const service = new CoachPlanningExecutionService(
      dispatcher as unknown as CoachPlanningExecutionDispatcherService,
      {
        build: jest.fn().mockResolvedValue(snapshot),
      } as unknown as CoachProfileSnapshotBuilder,
      {
        adapt: jest.fn().mockReturnValue({
          recognizedIntent: 'WORKOUT_PLAN_REQUEST',
          planTarget: 'WORKOUT',
          acquisitionIntent: Object.freeze({}),
        }),
      } as unknown as LegacyCoachIntentAdapter,
      collector as unknown as CoachAdaptiveProfileCollectorService,
      {
        plan: jest.fn().mockReturnValue(decision),
      } as unknown as ConversationGoalPlannerService,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      routePolicy as unknown as PlanningExecutionRoutePolicyService,
      undefined,
      undefined,
      undefined,
      undefined,
      workoutBuilder as unknown as GenerateWorkoutPlanV2InputBuilder,
    );

    const result = await service.executeStructured('user-id', 'WORKOUT', {
      conversationId: 'conversation-id',
      messageId: 'message-id',
      correlationId: 'message-id',
      profileId: 'profile-id',
      currentMessage,
      referenceDate: new Date('2026-08-18T12:00:00.000Z'),
    });

    expect(result.selectedSource).toBe('WORKOUT_V2');
    const equipmentBaseline = workoutEquipmentBaseline('FULL_GYM');
    if (equipmentBaseline?.status !== 'INFERRED')
      throw new Error('Canonical baseline missing');
    expect(result.profileAcquisitionContext).toEqual({
      modality: { value: 'GYM', evidence: 'EXPLICIT' },
      environment: { value: 'FULL_GYM', evidence: 'EXPLICIT' },
      equipment: {
        value: equipmentBaseline.value,
        evidence: 'INFERRED',
      },
      weeklyFrequency: { value: 4, evidence: 'EXPLICIT' },
      sessionDurationMinutes: { value: 60, evidence: 'EXPLICIT' },
      requiresRunningDistanceProfile: false,
      requiresWorkoutCalendar: true,
    });
    expect(workoutBuilder.resolveDeclaredContext).toHaveBeenCalledWith(
      currentMessage,
    );
    expect(collector.decide).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationContext: {
          modality: { value: 'GYM', evidence: 'EXPLICIT' },
          environment: { value: 'FULL_GYM', evidence: 'EXPLICIT' },
          equipment: {
            value: equipmentBaseline.value,
            evidence: 'INFERRED',
          },
          weeklyFrequency: { value: 4, evidence: 'EXPLICIT' },
          sessionDurationMinutes: { value: 60, evidence: 'EXPLICIT' },
          requiresRunningDistanceProfile: false,
          requiresWorkoutCalendar: true,
        },
      }),
    );
    expect(workoutBuilder.build).not.toHaveBeenCalled();
  });

  it.each([
    {
      objective: 'COMPLETE_DISTANCE' as const,
      currentMessage:
        'Quero treinar corrida para completar 10 km, 3 vezes por semana, 45 minutos por treino, na rua.',
      expectedFlag: true,
    },
    {
      objective: 'CONDITIONING' as const,
      currentMessage:
        'Quero treinar corrida para melhorar meu condicionamento, 3 vezes por semana, 45 minutos por treino, na rua.',
      expectedFlag: false,
    },
  ])(
    'derives the running-distance acquisition flag from the productive workout context: $objective',
    async ({ objective, currentMessage, expectedFlag }) => {
      const unavailableDatum = Object.freeze({
        status: 'UNKNOWN' as const,
        sources: Object.freeze([]),
      });
      const snapshot = Object.freeze({
        completion: Object.freeze({ overall: 'PARTIAL', sections: [] }),
        longitudinal: Object.freeze({
          latestProgressWeightKg: unavailableDatum,
          goalProgression: unavailableDatum,
          nutritionEvolution: unavailableDatum,
        }),
      }) as unknown as CoachProfileSnapshot;
      const decision = Object.freeze({
        recognizedIntent: 'WORKOUT_PLAN_REQUEST',
        goal: 'ASK_PROFILE_INFORMATION',
        reason: 'PROFILE_INFORMATION_REQUIRED',
        targetPlan: 'WORKOUT',
        profileCompletionState: 'PARTIAL',
        canExecute: false,
        confidence: 'HIGH',
        selectedProfileField: 'TRAINING_MODALITY',
        metPreconditions: Object.freeze([]),
        missingPreconditions: Object.freeze([]),
        pendingDependencies: Object.freeze([]),
      }) satisfies ConversationGoalDecision;
      const recognizedContext = Object.freeze({
        modality: Object.freeze({
          status: 'CONFIRMED' as const,
          value: 'RUNNING' as const,
        }),
        objective: Object.freeze({
          status: 'CONFIRMED' as const,
          value: objective,
        }),
        environment: Object.freeze({
          status: 'CONFIRMED' as const,
          value: 'STREET' as const,
        }),
        weeklyFrequency: Object.freeze({
          status: 'CONFIRMED' as const,
          value: 3,
        }),
        sessionDurationMinutes: Object.freeze({
          status: 'CONFIRMED' as const,
          value: 45,
        }),
      });
      const generationInput = Object.freeze({
        userId: 'user-id',
        recognizedContext,
      });
      const dispatcher = {
        dispatchStructured: jest.fn().mockResolvedValue({
          content: 'Treino V2',
          executor: 'WORKOUT_V2',
          generationCompleted: true,
          fallbackApplied: false,
          workoutDisposition: 'PLAN',
        }),
      };
      const workoutBuilder = {
        resolveDeclaredContext: jest.fn().mockReturnValue(recognizedContext),
        build: jest.fn().mockResolvedValue({
          generationInput,
          profileId: 'profile-id',
        }),
      };
      const routePolicy = {
        select: jest.fn().mockReturnValue({
          nutrition: null,
          workout: 'V2',
          reason: 'WORKOUT_V2_PRODUCTIVE_GENERATION',
          nutritionPilotStatus: null,
          suppressNutritionShadow: false,
        }),
      };
      const collector = {
        decide: jest.fn().mockReturnValue(Object.freeze({})),
      };
      const service = new CoachPlanningExecutionService(
        dispatcher as unknown as CoachPlanningExecutionDispatcherService,
        {
          build: jest.fn().mockResolvedValue(snapshot),
        } as unknown as CoachProfileSnapshotBuilder,
        {
          adapt: jest.fn().mockReturnValue({
            recognizedIntent: 'WORKOUT_PLAN_REQUEST',
            planTarget: 'WORKOUT',
            acquisitionIntent: Object.freeze({}),
          }),
        } as unknown as LegacyCoachIntentAdapter,
        collector as unknown as CoachAdaptiveProfileCollectorService,
        {
          plan: jest.fn().mockReturnValue(decision),
        } as unknown as ConversationGoalPlannerService,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        routePolicy as unknown as PlanningExecutionRoutePolicyService,
        undefined,
        undefined,
        undefined,
        undefined,
        workoutBuilder as unknown as GenerateWorkoutPlanV2InputBuilder,
      );

      ownedInbound(
        service,
        currentMessage,
        `running-${objective.toLowerCase()}`,
      );
      const result = await service.executeStructured('user-id', 'WORKOUT', {
        conversationId: 'conversation-id',
        messageId: `running-${objective.toLowerCase()}`,
        correlationId: `running-${objective.toLowerCase()}`,
        profileId: 'profile-id',
        currentMessage,
        referenceDate: new Date('2026-08-18T12:00:00.000Z'),
      });

      expect(result.selectedSource).toBe('WORKOUT_V2');
      expect(result.profileAcquisitionContext).toMatchObject({
        modality: { value: 'RUNNING', evidence: 'EXPLICIT' },
        requiresRunningDistanceProfile: expectedFlag,
      });
      expect(
        result.profileAcquisitionContext.requiresRunningDistanceProfile,
      ).toBe(expectedFlag);
      expect(collector.decide).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationContext: expect.objectContaining({
            modality: { value: 'RUNNING', evidence: 'EXPLICIT' },
            requiresRunningDistanceProfile: expectedFlag,
          }),
        }),
      );
      expect(workoutBuilder.resolveDeclaredContext).toHaveBeenCalledWith(
        currentMessage,
      );
      expect(workoutBuilder.build).not.toHaveBeenCalled();
    },
  );

  it.each([
    'Vou treinar só 3 vezes esta semana',
    'Quero mudar meu treino para 3 vezes por semana',
    'Preciso ajustar meu treino para 3 vezes por semana',
  ])(
    'routes %s with the canonical previous plan and no Legacy fallback',
    async (message) => {
      const unavailableDatum = Object.freeze({
        status: 'UNKNOWN' as const,
        sources: Object.freeze([]),
      });
      const snapshot = Object.freeze({
        completion: Object.freeze({ overall: 'COMPLETE', sections: [] }),
        longitudinal: Object.freeze({
          latestProgressWeightKg: unavailableDatum,
          goalProgression: unavailableDatum,
          nutritionEvolution: unavailableDatum,
        }),
      }) as unknown as CoachProfileSnapshot;
      const previousPlan = Object.freeze({
        modality: 'GYM_STRENGTH',
        strategy: Object.freeze({ authorizedEquipment: ['BODYWEIGHT'] }),
        sessions: Object.freeze([{ sessionKey: 'session-1' }]),
      });
      const declared = Object.freeze({
        weeklyFrequency: Object.freeze({ status: 'CONFIRMED', value: 3 }),
      });
      const mutationContext = Object.freeze({
        ...declared,
        artifactType: 'PLAN_ADAPTATION',
        purpose: 'ADAPTATION',
        mutation: Object.freeze({
          kind: 'PLAN_ADAPTATION',
          sourceActivityKey: null,
          sourceActivityName: null,
          reason: 'FREQUENCY',
        }),
      });
      const generationInput = Object.freeze({ userId: 'user-id' });
      const workoutBuilder = {
        resolveDeclaredContext: jest.fn().mockReturnValue(declared),
        build: jest.fn().mockResolvedValue({
          generationInput,
          profileId: 'profile-id',
        }),
      };
      const mutationResolver = {
        resolve: jest.fn().mockResolvedValue({
          status: 'READY',
          previousPlan,
          recognizedContext: mutationContext,
        }),
      };
      const routePolicy = {
        select: jest.fn().mockReturnValue({
          nutrition: null,
          workout: 'V2',
          reason: 'WORKOUT_V2_PLAN_MUTATION',
          nutritionPilotStatus: null,
          suppressNutritionShadow: false,
        }),
      };
      const dispatcher = {
        dispatchStructured: jest.fn().mockResolvedValue({
          content: 'Plano adaptado V2',
          executor: 'WORKOUT_V2',
          generationCompleted: true,
          fallbackApplied: false,
          workoutDisposition: 'PLAN',
        }),
      };
      const decision = Object.freeze({
        recognizedIntent: 'WORKOUT_PLAN_UPDATE_REQUEST',
        goal: 'UPDATE_WORKOUT_PLAN',
        reason: 'WORKOUT_PROFILE_READY',
        targetPlan: 'WORKOUT',
        profileCompletionState: 'COMPLETE',
        canExecute: true,
        confidence: 'HIGH',
        selectedProfileField: null,
        metPreconditions: Object.freeze([]),
        missingPreconditions: Object.freeze([]),
        pendingDependencies: Object.freeze([]),
      }) satisfies ConversationGoalDecision;
      const service = new CoachPlanningExecutionService(
        dispatcher as unknown as CoachPlanningExecutionDispatcherService,
        {
          build: jest.fn().mockResolvedValue(snapshot),
        } as unknown as CoachProfileSnapshotBuilder,
        {
          adapt: jest.fn().mockReturnValue({
            recognizedIntent: 'WORKOUT_PLAN_REQUEST',
            planTarget: 'WORKOUT',
            acquisitionIntent: Object.freeze({}),
          }),
        } as unknown as LegacyCoachIntentAdapter,
        {
          decide: jest.fn().mockReturnValue(Object.freeze({})),
        } as unknown as CoachAdaptiveProfileCollectorService,
        {
          plan: jest.fn().mockReturnValue(decision),
        } as unknown as ConversationGoalPlannerService,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        routePolicy as unknown as PlanningExecutionRoutePolicyService,
        undefined,
        undefined,
        undefined,
        undefined,
        workoutBuilder as unknown as GenerateWorkoutPlanV2InputBuilder,
        mutationResolver as unknown as WorkoutPlanMutationResolverService,
      );

      ownedInbound(service, message);
      const result = await service.executeStructured('user-id', 'WORKOUT', {
        conversationId: 'conversation-id',
        messageId: 'message-id',
        correlationId: 'message-id',
        profileId: 'profile-id',
        currentMessage: message,
        referenceDate: new Date('2026-08-19T12:00:00.000Z'),
      });

      if (message === 'Vou treinar só 3 vezes esta semana') {
        expect(result.dispatch?.workoutDisposition).toBe('BLOCKED');
        expect(dispatcher.dispatchStructured).not.toHaveBeenCalled();
        return;
      }
      expect(result).toMatchObject({
        selectedSource: 'WORKOUT_V2',
        dispatch: { executor: 'WORKOUT_V2', generationCompleted: true },
      });
      expect(mutationResolver.resolve).toHaveBeenCalledWith(
        'user-id',
        message,
        declared,
        expect.objectContaining({
          userId: 'user-id',
          conversationId: 'conversation-id',
          messageId: 'message-id',
        }),
      );
      expect(workoutBuilder.build).toHaveBeenCalledWith(
        expect.objectContaining({
          declaredContext: mutationContext,
          previousPlan,
        }),
      );
      expect(routePolicy.select).toHaveBeenCalledWith(
        expect.objectContaining({ workoutMutation: true }),
      );
      expect(dispatcher.dispatchStructured).toHaveBeenCalledWith(
        expect.objectContaining({
          legacyIntent: 'WORKOUT',
          workoutV2: expect.objectContaining({ generationInput }),
        }),
      );
    },
  );

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
      routeSelection: {
        nutrition: 'LEGACY',
        workout: null,
        reason: 'LEGACY_INTENT_OR_UNSUPPORTED_GOAL',
        nutritionPilotStatus: null,
        suppressNutritionShadow: false,
      },
      nutritionV2: undefined,
      workoutMutationReady: false,
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

    const currentMessage = 'Monte um plano de dieta e treino para mim.';
    ownedInbound(service, currentMessage);
    const result = await service.executeStructured('user-id', 'BOTH', {
      conversationId: 'conversation-id',
      messageId: 'message-id',
      correlationId: 'correlation-id',
      currentMessage,
      referenceDate: new Date('2026-08-02T12:00:00.000Z'),
    });

    expect(dispatcher.dispatchStructured).toHaveBeenCalledWith(
      expect.objectContaining({
        continuationOperationKey:
          'combined-continuation:conversation-id:message-id:nutrition',
      }),
    );
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

  it('selects the route before dispatch and never executes the old post-Legacy pilot', async () => {
    const dispatcher = {
      dispatchStructured: jest.fn().mockResolvedValue({
        content: 'somente V2',
        executor: 'DIET_V2',
        generationCompleted: true,
        fallbackApplied: false,
      }),
    };
    const oldPilot = { select: jest.fn() };
    const routeSelection = Object.freeze({
      nutrition: 'V2' as const,
      workout: null,
      reason: 'NUTRITION_V2_ELIGIBLE' as const,
      nutritionPilotStatus: 'ELIGIBLE' as const,
      suppressNutritionShadow: true,
    });
    const routePolicy = {
      select: jest.fn().mockReturnValue(routeSelection),
    };
    const service = new CoachPlanningExecutionService(
      dispatcher as unknown as CoachPlanningExecutionDispatcherService,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      oldPilot as unknown as NutritionV2PilotService,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      routePolicy as unknown as PlanningExecutionRoutePolicyService,
    );

    const result = await service.executeStructured('user-id', 'DIET', {
      conversationId: 'conversation-id',
      messageId: 'message-id',
      correlationId: 'correlation-id',
      profileId: 'profile-id',
      referenceDate: new Date('2026-08-07T12:00:00.000Z'),
    });

    expect(routePolicy.select.mock.invocationCallOrder[0]).toBeLessThan(
      dispatcher.dispatchStructured.mock.invocationCallOrder[0],
    );
    expect(dispatcher.dispatchStructured).toHaveBeenCalledTimes(1);
    expect(oldPilot.select).not.toHaveBeenCalled();
    expect(result.content).toBe('somente V2');
    expect(result.selectedSource).toBe('NUTRITION_V2');
    expect(result.metadata.routeSelection).toBe(routeSelection);
  });

  it('persists a simple explicit goal only after route selection with operation fencing', async () => {
    const unavailableDatum = Object.freeze({
      status: 'UNKNOWN' as const,
      sources: Object.freeze([]),
    });
    const snapshot = Object.freeze({
      nutrition: Object.freeze({
        primaryGoal: Object.freeze({
          status: 'KNOWN' as const,
          value: FitnessGoal.MAINTENANCE,
          sources: Object.freeze([]),
        }),
        desiredOutcome: unavailableDatum,
      }),
      training: Object.freeze({
        primaryGoal: Object.freeze({
          status: 'KNOWN' as const,
          value: FitnessGoal.MAINTENANCE,
          sources: Object.freeze([]),
        }),
      }),
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
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([{ locked: true }]),
      fitnessProfile: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      nutritionProfile: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      userGoalClassification: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({ id: 'classification-id' }),
      },
    };
    const prisma = {
      $transaction: jest.fn(
        async (callback: (client: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
    };
    const snapshotBuilder = { build: jest.fn().mockResolvedValue(snapshot) };
    const inputBuilder = { build: jest.fn().mockReturnValue(null) };
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
    const routeSelection = Object.freeze({
      nutrition: 'LEGACY' as const,
      workout: null,
      reason: 'NUTRITION_PILOT_NOT_ELIGIBLE' as const,
      nutritionPilotStatus: 'NOT_ALLOWLISTED' as const,
      suppressNutritionShadow: false,
    });
    const routePolicy = { select: jest.fn().mockReturnValue(routeSelection) };
    const dispatcher = {
      dispatchStructured: jest.fn(
        (input: { decision: ConversationGoalDecision | null }) =>
          Promise.resolve(
            input.decision?.goal === 'REQUEST_CONFIRMATION'
              ? {
                  content: 'confirme o objetivo',
                  executor: 'UNKNOWN_LEGACY',
                  generationCompleted: false,
                  fallbackApplied: false,
                }
              : {
                  content: 'ok',
                  executor: 'DIET_LEGACY',
                  generationCompleted: true,
                  fallbackApplied: false,
                },
          ),
      ),
    };
    const service = new CoachPlanningExecutionService(
      dispatcher as unknown as CoachPlanningExecutionDispatcherService,
      snapshotBuilder as unknown as CoachProfileSnapshotBuilder,
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
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      routePolicy as unknown as PlanningExecutionRoutePolicyService,
      new UserGoalEngineService(),
      prisma as unknown as PrismaService,
    );

    await service.executeStructured('user-id', 'DIET', {
      conversationId: 'conversation-id',
      messageId: 'message-id',
      correlationId: 'message-id',
      currentMessage: 'Agora quero emagrecer. Monte uma dieta.',
      referenceDate: new Date('2026-08-11T12:00:00.000Z'),
    });

    expect(transaction.fitnessProfile.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-id' },
      data: { goal: FitnessGoal.WEIGHT_LOSS },
    });
    expect(transaction.nutritionProfile.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-id' },
      data: { goal: FitnessGoal.WEIGHT_LOSS },
    });
    expect(transaction.userGoalClassification.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          evidence: expect.objectContaining({
            operationKey: 'message-id',
            primaryGoal: FitnessGoal.WEIGHT_LOSS,
          }),
        }),
      }),
    );
    expect(snapshotBuilder.build.mock.invocationCallOrder[0]).toBeLessThan(
      routePolicy.select.mock.invocationCallOrder[0],
    );
    expect(routePolicy.select.mock.invocationCallOrder[0]).toBeLessThan(
      transaction.fitnessProfile.updateMany.mock.invocationCallOrder[0],
    );
    expect(inputBuilder.build).toHaveBeenCalledWith(
      expect.objectContaining({
        snapshot: expect.objectContaining({
          nutrition: expect.objectContaining({
            desiredOutcome: expect.objectContaining({
              value: 'emagrecimento',
            }),
            primaryGoal: expect.objectContaining({
              value: FitnessGoal.WEIGHT_LOSS,
            }),
          }),
        }),
      }),
    );

    jest.clearAllMocks();
    const ambiguous = await service.executeStructured('user-id', 'DIET', {
      conversationId: 'conversation-id',
      messageId: 'ambiguous-message-id',
      correlationId: 'ambiguous-message-id',
      currentMessage: 'Não sei se quero emagrecer ou ganhar massa.',
      referenceDate: new Date('2026-08-11T13:00:00.000Z'),
    });

    expect(ambiguous.decision).toMatchObject({
      goal: 'REQUEST_CONFIRMATION',
      reason: 'CONFIRMATION_REQUIRED',
      canExecute: false,
    });
    expect(ambiguous.dispatch.generationCompleted).toBe(false);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(transaction.fitnessProfile.updateMany).not.toHaveBeenCalled();
    expect(transaction.nutritionProfile.updateMany).not.toHaveBeenCalled();

    jest.clearAllMocks();
    const composite = await service.executeStructured('user-id', 'DIET', {
      conversationId: 'conversation-id',
      messageId: 'composite-message-id',
      correlationId: 'composite-message-id',
      currentMessage: 'Quero perder gordura e ganhar massa muscular.',
      referenceDate: new Date('2026-08-11T14:00:00.000Z'),
    });

    expect(composite.decision?.goal).toBe('REQUEST_CONFIRMATION');
    expect(composite.dispatch.generationCompleted).toBe(false);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(inputBuilder.build).toHaveBeenCalledWith(
      expect.objectContaining({
        snapshot: expect.objectContaining({
          nutrition: expect.objectContaining({
            primaryGoal: expect.objectContaining({
              value: FitnessGoal.MAINTENANCE,
            }),
            desiredOutcome: expect.objectContaining({
              status: 'REQUIRES_CONFIRMATION',
              value: 'perder gordura e ganhar massa muscular',
            }),
          }),
          training: expect.objectContaining({
            primaryGoal: expect.objectContaining({
              value: FitnessGoal.MAINTENANCE,
            }),
          }),
        }),
      }),
    );

    jest.clearAllMocks();
    transaction.userGoalClassification.findUnique.mockResolvedValueOnce({
      classifiedAt: new Date('2026-08-11T12:00:00.000Z'),
      evidence: { operationKey: 'message-id' },
    });
    await service.executeStructured('user-id', 'DIET', {
      conversationId: 'conversation-id',
      messageId: 'message-id',
      correlationId: 'message-id',
      currentMessage: 'Agora quero emagrecer. Monte uma dieta.',
      referenceDate: new Date('2026-08-11T12:00:00.000Z'),
    });
    expect(transaction.$queryRaw).toHaveBeenCalledTimes(1);
    expect(transaction.fitnessProfile.updateMany).not.toHaveBeenCalled();
    expect(transaction.userGoalClassification.upsert).not.toHaveBeenCalled();

    jest.clearAllMocks();
    transaction.userGoalClassification.findUnique.mockResolvedValueOnce({
      classifiedAt: new Date('2026-08-11T15:00:00.000Z'),
      evidence: { operationKey: 'newer-message-id' },
    });
    const stale = await service.executeStructured('user-id', 'DIET', {
      conversationId: 'conversation-id',
      messageId: 'older-message-id',
      correlationId: 'older-message-id',
      currentMessage: 'Agora quero ganhar massa muscular. Monte uma dieta.',
      referenceDate: new Date('2026-08-11T11:00:00.000Z'),
    });
    expect(stale.dispatch.generationCompleted).toBe(false);
    expect(stale.content).toContain('atualização de objetivo mais recente');
    expect(transaction.fitnessProfile.updateMany).not.toHaveBeenCalled();
    expect(transaction.userGoalClassification.upsert).not.toHaveBeenCalled();
    expect(dispatcher.dispatchStructured).not.toHaveBeenCalled();
  });
});
