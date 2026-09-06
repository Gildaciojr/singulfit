import { Prisma } from '@prisma/client';
import {
  CONVERSATION_GOAL,
  type ConversationGoal,
  type ConversationGoalDecision,
} from '../context/conversation-goal-planner.contract';
import { DietGeneratorService } from '../diet/diet-generator.service';
import { WorkoutGeneratorService } from '../workout/workout-generator.service';
import { CoachPlanningExecutionDispatcherService } from './coach-planning-execution-dispatcher.service';
import type { CoachPlanningBothApplicationExecutorService } from './coach-planning-both-application-executor.service';
import type { NutritionApplicationExecutorService } from '../diet/v2/execution/nutrition-application-executor.service';
import type { NutritionPublicResultFormatter } from '../diet/v2/execution/nutrition-public-result.formatter';
import type { WorkoutApplicationExecutorService } from '../workout/v2/execution/workout-application-executor.service';
import type { WorkoutPlanV2Formatter } from '../workout/v2/workout-plan-v2.formatter';
import type { CurrentWorkoutPlanReaderService } from '../workout/v2/current-workout-plan-reader.service';
import type { CurrentNutritionPlanReaderService } from '../diet/current-nutrition-plan-reader.service';
import type { CanonicalNutritionPlanPresenterService } from '../diet/canonical-nutrition-plan-presenter.service';
import { CoachPlanningExecutionService } from './coach-planning-execution.service';

describe('CoachPlanningExecutionDispatcherService', () => {
  const unsupportedGoals: readonly ConversationGoal[] = [
    CONVERSATION_GOAL.ANSWER_MESSAGE,
    CONVERSATION_GOAL.ASK_PROFILE_INFORMATION,
    CONVERSATION_GOAL.UPDATE_WORKOUT_PLAN,
    CONVERSATION_GOAL.REVIEW_PROGRESS,
    CONVERSATION_GOAL.GENERAL_GUIDANCE,
    CONVERSATION_GOAL.UNKNOWN,
  ];

  function decision(goal: ConversationGoal): ConversationGoalDecision {
    return Object.freeze({
      recognizedIntent: 'DIET_PLAN_REQUEST',
      goal,
      reason: 'DIET_PROFILE_READY',
      targetPlan: null,
      profileCompletionState: 'COMPLETE',
      canExecute: true,
      confidence: 'HIGH',
      selectedProfileField: null,
      metPreconditions: Object.freeze([]),
      missingPreconditions: Object.freeze([]),
      pendingDependencies: Object.freeze([]),
    });
  }

  function createSubject() {
    const dietPlan = {
      title: 'Dieta legado',
      objective: 'WEIGHT_LOSS',
      dailyCaloriesTarget: new Prisma.Decimal(1800),
      proteinTarget: new Prisma.Decimal(140),
      carbsTarget: new Prisma.Decimal(180),
      fatTarget: new Prisma.Decimal(60),
      meals: [],
    };
    const workoutPlan = {
      title: 'Treino legado',
      objective: 'MUSCLE_GAIN',
      days: [],
    };
    const dietGenerator = {
      generate: jest.fn().mockResolvedValue(dietPlan),
      generateCandidate: jest.fn().mockResolvedValue({ domain: 'DIET' }),
      failCandidate: jest.fn().mockResolvedValue(undefined),
    };
    const workoutGenerator = {
      generate: jest.fn().mockResolvedValue(workoutPlan),
      generateCandidate: jest.fn().mockResolvedValue({ domain: 'WORKOUT' }),
    };
    const bothExecutor = {
      execute: jest.fn().mockResolvedValue({ dietPlan, workoutPlan }),
    };
    const nutritionV2Executor = {
      execute: jest.fn().mockResolvedValue({
        kind: 'PLAN',
        artifactType: 'DAILY_STRUCTURE',
        aiJobCompleted: true,
        document: { title: 'Plano V2' },
      }),
    };
    const nutritionV2Formatter = {
      format: jest.fn().mockReturnValue('Resposta oficial V2'),
    };
    const workoutV2Executor = {
      preflight: jest.fn().mockReturnValue({ kind: 'READY' }),
      execute: jest.fn().mockResolvedValue({
        kind: 'PLAN',
        document: { artifactType: 'WEEKLY_PLAN' },
        aiJobCompleted: true,
      }),
    };
    const workoutV2Formatter = {
      format: jest.fn().mockReturnValue(['Treino oficial V2']),
    };
    const currentWorkoutPlanReader = {
      present: jest.fn().mockResolvedValue('Plano atual oficial V2'),
    };
    const currentNutritionPlanReader = {
      getCurrent: jest.fn().mockResolvedValue({
        implementation: 'LEGACY',
        title: 'Plano alimentar atual',
      }),
    };
    const currentNutritionPresenter = {
      present: jest.fn().mockReturnValue('Plano nutricional canônico atual'),
    };
    const dispatcher = new CoachPlanningExecutionDispatcherService(
      dietGenerator as unknown as DietGeneratorService,
      workoutGenerator as unknown as WorkoutGeneratorService,
      bothExecutor as unknown as CoachPlanningBothApplicationExecutorService,
      nutritionV2Executor as unknown as NutritionApplicationExecutorService,
      nutritionV2Formatter as unknown as NutritionPublicResultFormatter,
      workoutV2Executor as unknown as WorkoutApplicationExecutorService,
      workoutV2Formatter as unknown as WorkoutPlanV2Formatter,
      currentWorkoutPlanReader as unknown as CurrentWorkoutPlanReaderService,
      currentNutritionPlanReader as unknown as CurrentNutritionPlanReaderService,
      currentNutritionPresenter as unknown as CanonicalNutritionPlanPresenterService,
    );

    return {
      dispatcher,
      dietGenerator,
      workoutGenerator,
      bothExecutor,
      nutritionV2Executor,
      nutritionV2Formatter,
      workoutV2Executor,
      workoutV2Formatter,
      currentWorkoutPlanReader,
      currentNutritionPlanReader,
      currentNutritionPresenter,
    };
  }

  it.each([
    [CONVERSATION_GOAL.SHOW_CURRENT_PLAN, 'Plano nutricional canônico atual'],
    [
      CONVERSATION_GOAL.SHOW_PLAN_STATUS,
      'Seu plano alimentar ativo é *Plano alimentar atual*.',
    ],
  ] as const)(
    'reads canonical Nutrition for %s without generation',
    async (goal, content) => {
      const subject = createSubject();
      await expect(
        subject.dispatcher.dispatchStructured({
          userId: 'user-id',
          legacyIntent: 'DIET',
          decision: { ...decision(goal), targetPlan: 'DIET' },
        }),
      ).resolves.toMatchObject({
        content,
        executor: 'NUTRITION_CANONICAL_READER',
        generationCompleted: false,
      });
      expect(
        subject.currentNutritionPlanReader.getCurrent,
      ).toHaveBeenCalledWith('user-id');
      expect(subject.dietGenerator.generate).not.toHaveBeenCalled();
      expect(subject.dietGenerator.generateCandidate).not.toHaveBeenCalled();
      expect(subject.nutritionV2Executor.execute).not.toHaveBeenCalled();
    },
  );

  it('fails a legacy Nutrition update closed without a new legacy generation', async () => {
    const subject = createSubject();
    const previousPlan = await subject.currentNutritionPlanReader.getCurrent();
    subject.currentNutritionPlanReader.getCurrent.mockClear();

    await expect(
      subject.dispatcher.dispatchStructured({
        userId: 'user-id',
        legacyIntent: 'DIET',
        decision: {
          ...decision(CONVERSATION_GOAL.UPDATE_DIET_PLAN),
          targetPlan: 'DIET',
        },
        currentMessage: 'Quero mais proteína',
        continuationOperationKey: 'operation-key',
      }),
    ).resolves.toMatchObject({
      executor: 'NUTRITION_CANONICAL_READER',
      generationCompleted: false,
    });
    expect(previousPlan).toBeDefined();
    expect(subject.dietGenerator.generate).not.toHaveBeenCalled();
  });

  it('reads current Workout V2 without legacy generation or provider execution', async () => {
    const subject = createSubject();
    await expect(
      subject.dispatcher.dispatchStructured({
        userId: 'user-id',
        legacyIntent: 'WORKOUT',
        decision: {
          ...decision(CONVERSATION_GOAL.SHOW_CURRENT_PLAN),
          targetPlan: 'WORKOUT',
        },
        routeSelection: {
          nutrition: null,
          workout: 'V2',
          reason: 'WORKOUT_V2_CANONICAL_READ',
          nutritionPilotStatus: null,
          suppressNutritionShadow: false,
        },
        currentMessage: 'O que treino hoje?',
        referenceDate: new Date('2026-08-17T02:30:00.000Z'),
      }),
    ).resolves.toMatchObject({
      content: 'Plano atual oficial V2',
      executor: 'WORKOUT_V2_READER',
      generationCompleted: false,
    });
    expect(subject.currentWorkoutPlanReader.present).toHaveBeenCalledTimes(1);
    expect(subject.currentWorkoutPlanReader.present).toHaveBeenCalledWith(
      'user-id',
      'O que treino hoje?',
      new Date('2026-08-17T02:30:00.000Z'),
    );
    expect(subject.workoutV2Executor.execute).not.toHaveBeenCalled();
    expect(subject.workoutGenerator.generate).not.toHaveBeenCalled();
    expect(subject.workoutGenerator.generateCandidate).not.toHaveBeenCalled();
    expect(subject.dietGenerator.generate).not.toHaveBeenCalled();
    expect(subject.dietGenerator.generateCandidate).not.toHaveBeenCalled();
    expect(subject.nutritionV2Executor.execute).not.toHaveBeenCalled();
    expect(subject.bothExecutor.execute).not.toHaveBeenCalled();
  });

  it('takes the real UNKNOWN Workout read phrase through the canonical reader chain', async () => {
    const subject = createSubject();
    const execution = new CoachPlanningExecutionService(subject.dispatcher);
    const referenceDate = new Date('2026-09-02T12:00:00.000Z');

    await expect(
      execution.executeStructured('user-id', 'UNKNOWN', {
        conversationId: 'conversation-id',
        messageId: 'message-id',
        correlationId: 'message-id',
        currentMessage: 'Qual é meu treino atual?',
        referenceDate,
      }),
    ).resolves.toMatchObject({
      content: 'Plano atual oficial V2',
      responseRequired: true,
      selectedSource: 'WORKOUT_V2',
      dispatch: {
        executor: 'WORKOUT_V2_READER',
        generationCompleted: false,
      },
    });
    expect(subject.currentWorkoutPlanReader.present).toHaveBeenCalledWith(
      'user-id',
      'Qual é meu treino atual?',
      referenceDate,
    );
    expect(subject.workoutV2Executor.execute).not.toHaveBeenCalled();
    expect(subject.workoutGenerator.generate).not.toHaveBeenCalled();
    expect(subject.workoutGenerator.generateCandidate).not.toHaveBeenCalled();
    expect(subject.dietGenerator.generate).not.toHaveBeenCalled();
    expect(subject.dietGenerator.generateCandidate).not.toHaveBeenCalled();
    expect(subject.nutritionV2Executor.execute).not.toHaveBeenCalled();
    expect(subject.bothExecutor.execute).not.toHaveBeenCalled();
  });

  it('returns a mutation clarification without invoking V2 generation or Legacy', async () => {
    const subject = createSubject();

    await expect(
      subject.dispatcher.dispatchStructured({
        userId: 'user-id',
        legacyIntent: 'WORKOUT',
        decision: decision(CONVERSATION_GOAL.UPDATE_WORKOUT_PLAN),
        routeSelection: {
          nutrition: null,
          workout: 'V2',
          reason: 'WORKOUT_V2_PLAN_MUTATION',
          nutritionPilotStatus: null,
          suppressNutritionShadow: false,
        },
        workoutV2Response: 'Qual exercício exato você quer trocar?',
      }),
    ).resolves.toMatchObject({
      content: 'Qual exercício exato você quer trocar?',
      executor: 'WORKOUT_V2',
      workoutDisposition: 'CLARIFICATION',
      generationCompleted: false,
    });
    expect(subject.workoutV2Executor.execute).not.toHaveBeenCalled();
    expect(subject.workoutGenerator.generate).not.toHaveBeenCalled();
    expect(subject.workoutGenerator.generateCandidate).not.toHaveBeenCalled();
  });

  it.each([
    CONVERSATION_GOAL.GENERATE_DIET_PLAN,
    CONVERSATION_GOAL.GENERATE_WORKOUT_PLAN,
  ] as const)(
    'fails %s closed when its V2 infrastructure input is absent',
    async (goal) => {
      const subject = createSubject();

      await expect(
        subject.dispatcher.dispatch({
          userId: 'user-id',
          legacyIntent: 'UNKNOWN',
          decision: decision(goal),
        }),
      ).rejects.toThrow(/V2/u);
      expect(subject.dietGenerator.generate).not.toHaveBeenCalled();
      expect(subject.workoutGenerator.generate).not.toHaveBeenCalled();
      expect(subject.dietGenerator.generateCandidate).not.toHaveBeenCalled();
      expect(subject.workoutGenerator.generateCandidate).not.toHaveBeenCalled();
    },
  );

  it('decomposes combined generation without invoking either legacy generator', async () => {
    const subject = createSubject();
    const combinedInput = {
      userId: 'user-id',
      legacyIntent: 'BOTH' as const,
      decision: decision(CONVERSATION_GOAL.GENERATE_COMBINED_PLANS),
      routeSelection: {
        nutrition: 'V2' as const,
        workout: 'V2' as const,
        reason: 'CROSS_DOMAIN_V2_DECOMPOSITION_REQUIRED' as const,
        nutritionPilotStatus: null,
        suppressNutritionShadow: true,
      },
      nutritionV2: {
        generationInput: { userId: 'user-id', snapshot: {} } as never,
        profileId: 'profile-id',
        correlationId: 'combined-correlation-id',
        continuationOperationKey: 'combined-nutrition-operation-id',
      },
      workoutV2: {
        generationInput: { userId: 'user-id' } as never,
        profileId: 'profile-id',
        correlationId: 'combined-correlation-id',
      },
    };
    for (const kind of ['CLARIFICATION', 'BLOCKED'] as const) {
      subject.workoutV2Executor.preflight.mockReturnValueOnce({
        kind,
        missingFields: ['EQUIPMENT'],
        confirmationRequiredFields: [],
      });
      await expect(
        subject.dispatcher.dispatchStructured(combinedInput),
      ).resolves.toMatchObject({
        executor: 'V2_DECOMPOSITION',
        generationCompleted: false,
        workoutDisposition: kind,
      });
      expect(subject.nutritionV2Executor.execute).not.toHaveBeenCalled();
      expect(subject.workoutV2Executor.execute).not.toHaveBeenCalled();
      expect(subject.dietGenerator.generate).not.toHaveBeenCalled();
      expect(subject.workoutGenerator.generate).not.toHaveBeenCalled();
    }
    subject.workoutV2Executor.preflight.mockClear();
    await expect(
      subject.dispatcher.dispatchStructured(combinedInput),
    ).resolves.toMatchObject({
      content: 'Resposta oficial V2\n\nTreino oficial V2',
      executor: 'V2_DECOMPOSITION',
      generationCompleted: true,
      workoutDisposition: 'PLAN',
    });
    expect(subject.nutritionV2Executor.execute).toHaveBeenCalledTimes(1);
    expect(subject.workoutV2Executor.execute).toHaveBeenCalledTimes(1);
    expect(subject.dietGenerator.generateCandidate).not.toHaveBeenCalled();
    expect(subject.workoutGenerator.generateCandidate).not.toHaveBeenCalled();
    expect(subject.bothExecutor.execute).not.toHaveBeenCalled();

    expect(
      subject.nutritionV2Executor.execute.mock.invocationCallOrder[0],
    ).toBeLessThan(
      subject.workoutV2Executor.execute.mock.invocationCallOrder[0],
    );
    subject.workoutV2Executor.execute.mockRejectedValueOnce(
      new Error('Workout V2 failed after Nutrition persisted'),
    );
    await expect(
      subject.dispatcher.dispatchStructured(combinedInput),
    ).rejects.toThrow('Workout V2 failed after Nutrition persisted');
    await expect(
      subject.dispatcher.dispatchStructured(combinedInput),
    ).resolves.toMatchObject({ generationCompleted: true });
    expect(subject.nutritionV2Executor.execute).toHaveBeenCalledTimes(3);
    expect(subject.workoutV2Executor.execute).toHaveBeenCalledTimes(3);
    for (const [execution] of subject.nutritionV2Executor.execute.mock.calls) {
      expect(execution).toMatchObject({
        continuationOperationKey: 'combined-nutrition-operation-id',
      });
    }
    expect(subject.nutritionV2Executor.execute).toHaveBeenLastCalledWith(
      expect.objectContaining({
        continuationOperationKey: 'combined-nutrition-operation-id',
      }),
    );
    expect(subject.dietGenerator.generate).not.toHaveBeenCalled();
    expect(subject.workoutGenerator.generate).not.toHaveBeenCalled();
  });

  it('executes Nutrition V2 once without invoking the Legacy provider or commit', async () => {
    const subject = createSubject();
    await expect(
      subject.dispatcher.dispatchStructured({
        userId: 'user-id',
        legacyIntent: 'DIET',
        decision: decision(CONVERSATION_GOAL.GENERATE_DIET_PLAN),
        routeSelection: {
          nutrition: 'V2',
          workout: null,
          reason: 'NUTRITION_V2_ELIGIBLE',
          nutritionPilotStatus: 'ELIGIBLE',
          suppressNutritionShadow: true,
        },
        nutritionV2: {
          generationInput: {
            userId: 'user-id',
            snapshot: {
              identity: {
                displayName: { status: 'KNOWN', value: 'Ana Souza' },
              },
            },
          } as never,
          profileId: 'profile-id',
          correlationId: 'correlation-id',
        },
      }),
    ).resolves.toMatchObject({
      content: 'Resposta oficial V2',
      executor: 'DIET_V2',
      generationCompleted: true,
    });
    expect(subject.nutritionV2Executor.execute).toHaveBeenCalledTimes(1);
    expect(subject.nutritionV2Formatter.format).toHaveBeenCalledTimes(1);
    expect(subject.nutritionV2Formatter.format).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'PLAN' }),
      { userDisplayName: 'Ana Souza' },
    );
    expect(subject.dietGenerator.generate).not.toHaveBeenCalled();
    expect(subject.dietGenerator.generateCandidate).not.toHaveBeenCalled();
  });

  it('executes Workout V2 once and never calls the Legacy generator', async () => {
    const subject = createSubject();
    await expect(
      subject.dispatcher.dispatchStructured({
        userId: 'user-id',
        legacyIntent: 'WORKOUT',
        decision: decision(CONVERSATION_GOAL.GENERATE_WORKOUT_PLAN),
        routeSelection: {
          nutrition: null,
          workout: 'V2',
          reason: 'WORKOUT_V2_PRODUCTIVE_GENERATION',
          nutritionPilotStatus: null,
          suppressNutritionShadow: false,
        },
        workoutV2: {
          generationInput: { userId: 'user-id' } as never,
          profileId: 'profile-id',
          correlationId: 'correlation-id',
        },
      }),
    ).resolves.toMatchObject({
      content: 'Treino oficial V2',
      executor: 'WORKOUT_V2',
      workoutDisposition: 'PLAN',
      generationCompleted: true,
    });
    expect(subject.workoutV2Executor.execute).toHaveBeenCalledTimes(1);
    expect(subject.workoutGenerator.generate).not.toHaveBeenCalled();
    expect(subject.workoutGenerator.generateCandidate).not.toHaveBeenCalled();
  });

  it('returns Workout V2 clarification without invoking Legacy', async () => {
    const subject = createSubject();
    subject.workoutV2Executor.execute.mockResolvedValueOnce({
      kind: 'CLARIFICATION',
      missingFields: ['WEEKLY_FREQUENCY'],
      confirmationRequiredFields: [],
      aiJobCompleted: false,
    });
    const result = await subject.dispatcher.dispatchStructured({
      userId: 'user-id',
      legacyIntent: 'WORKOUT',
      decision: decision(CONVERSATION_GOAL.GENERATE_WORKOUT_PLAN),
      routeSelection: {
        nutrition: null,
        workout: 'V2',
        reason: 'WORKOUT_V2_PRODUCTIVE_GENERATION',
        nutritionPilotStatus: null,
        suppressNutritionShadow: false,
      },
      workoutV2: {
        generationInput: { userId: 'user-id' } as never,
        profileId: 'profile-id',
        correlationId: 'correlation-id',
      },
    });

    expect(result).toMatchObject({
      executor: 'WORKOUT_V2',
      workoutDisposition: 'CLARIFICATION',
      generationCompleted: false,
    });
    expect(result.content).toContain('dias da semana');
    expect(subject.workoutGenerator.generate).not.toHaveBeenCalled();
  });

  it.each([
    ['INFERRED', { status: 'INFERRED', value: 'Nome inferido' }],
    [
      'REQUIRES_CONFIRMATION',
      { status: 'REQUIRES_CONFIRMATION', value: 'Nome não confirmado' },
    ],
    ['UNKNOWN', { status: 'UNKNOWN' }],
    ['NOT_APPLICABLE', { status: 'NOT_APPLICABLE' }],
  ] as const)(
    'does not trust a %s display name',
    async (_status, displayName) => {
      const subject = createSubject();

      await subject.dispatcher.dispatchStructured({
        userId: 'user-id',
        legacyIntent: 'DIET',
        decision: decision(CONVERSATION_GOAL.GENERATE_DIET_PLAN),
        routeSelection: {
          nutrition: 'V2',
          workout: null,
          reason: 'NUTRITION_V2_ELIGIBLE',
          nutritionPilotStatus: 'ELIGIBLE',
          suppressNutritionShadow: true,
        },
        nutritionV2: {
          generationInput: {
            userId: 'user-id',
            snapshot: { identity: { displayName } },
          } as never,
          profileId: 'profile-id',
          correlationId: 'correlation-id',
        },
      });

      expect(subject.nutritionV2Formatter.format).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'PLAN' }),
        { userDisplayName: undefined },
      );
    },
  );

  it.each(['Operação V2 em andamento', 'Provider V2 indisponível'])(
    'never crosses to Legacy after the V2 route starts: %s',
    async (message) => {
      const subject = createSubject();
      subject.nutritionV2Executor.execute.mockRejectedValueOnce(
        new Error(message),
      );
      await expect(
        subject.dispatcher.dispatchStructured({
          userId: 'user-id',
          legacyIntent: 'DIET',
          decision: decision(CONVERSATION_GOAL.GENERATE_DIET_PLAN),
          routeSelection: {
            nutrition: 'V2',
            workout: null,
            reason: 'NUTRITION_V2_ELIGIBLE',
            nutritionPilotStatus: 'ELIGIBLE',
            suppressNutritionShadow: true,
          },
          nutritionV2: {
            generationInput: { userId: 'user-id' } as never,
            profileId: 'profile-id',
            correlationId: 'correlation-id',
          },
        }),
      ).rejects.toThrow(message);
      expect(subject.nutritionV2Executor.execute).toHaveBeenCalledTimes(1);
      expect(subject.dietGenerator.generate).not.toHaveBeenCalled();
      expect(subject.dietGenerator.generateCandidate).not.toHaveBeenCalled();
    },
  );

  it.each(unsupportedGoals)(
    'does not generate legacy content for unsupported goal %s',
    async (goal) => {
      const subject = createSubject();

      await expect(
        subject.dispatcher.dispatch({
          userId: 'user-id',
          legacyIntent: 'DIET',
          decision: decision(goal),
        }),
      ).resolves.toEqual(expect.any(String));
      expect(subject.dietGenerator.generate).not.toHaveBeenCalled();
      expect(subject.workoutGenerator.generate).not.toHaveBeenCalled();
    },
  );

  it('requests confirmation without invoking a goal-dependent generator', async () => {
    const subject = createSubject();

    const result = await subject.dispatcher.dispatchStructured({
      userId: 'user-id',
      legacyIntent: 'DIET',
      decision: decision(CONVERSATION_GOAL.REQUEST_CONFIRMATION),
    });

    expect(result).toMatchObject({
      executor: 'NO_GENERATION',
      generationCompleted: false,
    });
    expect(result.content).toContain('confirmar seu objetivo atual');
    expect(subject.dietGenerator.generate).not.toHaveBeenCalled();
    expect(subject.workoutGenerator.generate).not.toHaveBeenCalled();
  });

  it('fails closed without legacy generation when no planner decision is available', async () => {
    const subject = createSubject();

    await expect(
      subject.dispatcher.dispatch({
        userId: 'user-id',
        legacyIntent: 'BOTH',
        decision: null,
      }),
    ).resolves.toContain('Nenhum plano foi criado');
    expect(subject.dietGenerator.generateCandidate).not.toHaveBeenCalled();
    expect(subject.workoutGenerator.generateCandidate).not.toHaveBeenCalled();
    expect(subject.bothExecutor.execute).not.toHaveBeenCalled();
  });

  it('returns structured execution metadata without executing generators twice', async () => {
    const subject = createSubject();

    await expect(
      subject.dispatcher.dispatchStructured({
        userId: 'user-id',
        legacyIntent: 'DIET',
        decision: decision(CONVERSATION_GOAL.GENERATE_DIET_PLAN),
      }),
    ).rejects.toThrow(/V2/u);
    expect(subject.dietGenerator.generate).not.toHaveBeenCalled();
    expect(subject.workoutGenerator.generate).not.toHaveBeenCalled();
  });

  it('never prepares legacy candidates for a combined fallback', async () => {
    const subject = createSubject();
    const failure = new Error('workout provider failed');
    subject.workoutGenerator.generateCandidate.mockRejectedValue(failure);

    await expect(
      subject.dispatcher.dispatch({
        userId: 'user-id',
        legacyIntent: 'BOTH',
        decision: null,
      }),
    ).resolves.toContain('Nenhum plano foi criado');
    expect(subject.dietGenerator.failCandidate).not.toHaveBeenCalled();
    expect(subject.bothExecutor.execute).not.toHaveBeenCalled();
  });
});
