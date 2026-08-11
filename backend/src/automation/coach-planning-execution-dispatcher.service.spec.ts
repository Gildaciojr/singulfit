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

describe('CoachPlanningExecutionDispatcherService', () => {
  const unsupportedGoals: readonly ConversationGoal[] = [
    CONVERSATION_GOAL.ANSWER_MESSAGE,
    CONVERSATION_GOAL.ASK_PROFILE_INFORMATION,
    CONVERSATION_GOAL.UPDATE_DIET_PLAN,
    CONVERSATION_GOAL.UPDATE_WORKOUT_PLAN,
    CONVERSATION_GOAL.REVIEW_PROGRESS,
    CONVERSATION_GOAL.SHOW_CURRENT_PLAN,
    CONVERSATION_GOAL.SHOW_PLAN_STATUS,
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
    const dispatcher = new CoachPlanningExecutionDispatcherService(
      dietGenerator as unknown as DietGeneratorService,
      workoutGenerator as unknown as WorkoutGeneratorService,
      bothExecutor as unknown as CoachPlanningBothApplicationExecutorService,
      nutritionV2Executor as unknown as NutritionApplicationExecutorService,
      nutritionV2Formatter as unknown as NutritionPublicResultFormatter,
    );

    return {
      dispatcher,
      dietGenerator,
      workoutGenerator,
      bothExecutor,
      nutritionV2Executor,
      nutritionV2Formatter,
    };
  }

  it.each([
    [CONVERSATION_GOAL.GENERATE_DIET_PLAN, 1, 0, 0, 0],
    [CONVERSATION_GOAL.GENERATE_WORKOUT_PLAN, 0, 1, 0, 0],
    [CONVERSATION_GOAL.GENERATE_COMBINED_PLANS, 0, 0, 1, 1],
  ] as const)(
    'dispatches %s through legacy generators',
    async (goal, diets, workouts, dietCandidates, workoutCandidates) => {
      const subject = createSubject();

      await expect(
        subject.dispatcher.dispatch({
          userId: 'user-id',
          legacyIntent: 'UNKNOWN',
          decision: decision(goal),
        }),
      ).resolves.toEqual(expect.any(String));
      expect(subject.dietGenerator.generate).toHaveBeenCalledTimes(diets);
      expect(subject.workoutGenerator.generate).toHaveBeenCalledTimes(workouts);
      expect(subject.dietGenerator.generateCandidate).toHaveBeenCalledTimes(
        dietCandidates,
      );
      expect(subject.workoutGenerator.generateCandidate).toHaveBeenCalledTimes(
        workoutCandidates,
      );
    },
  );

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
          generationInput: { userId: 'user-id' } as never,
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
    expect(subject.dietGenerator.generate).not.toHaveBeenCalled();
    expect(subject.dietGenerator.generateCandidate).not.toHaveBeenCalled();
  });

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
    'keeps legacy behavior explicitly for unsupported goal %s',
    async (goal) => {
      const subject = createSubject();

      await expect(
        subject.dispatcher.dispatch({
          userId: 'user-id',
          legacyIntent: 'DIET',
          decision: decision(goal),
        }),
      ).resolves.toContain('Montei Dieta legado');
      expect(subject.dietGenerator.generate).toHaveBeenCalledWith('user-id');
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
      executor: 'UNKNOWN_LEGACY',
      generationCompleted: false,
    });
    expect(result.content).toContain('confirmar seu objetivo atual');
    expect(subject.dietGenerator.generate).not.toHaveBeenCalled();
    expect(subject.workoutGenerator.generate).not.toHaveBeenCalled();
  });

  it('falls back to the combined legacy execution when no planner decision is available', async () => {
    const subject = createSubject();

    await expect(
      subject.dispatcher.dispatch({
        userId: 'user-id',
        legacyIntent: 'BOTH',
        decision: null,
      }),
    ).resolves.toMatch(/^🥗[\s\S]+\n\n🏋️/);
    expect(
      subject.dietGenerator.generateCandidate.mock.invocationCallOrder[0],
    ).toBeLessThan(
      subject.workoutGenerator.generateCandidate.mock.invocationCallOrder[0],
    );
    expect(
      subject.workoutGenerator.generateCandidate.mock.invocationCallOrder[0],
    ).toBeLessThan(subject.bothExecutor.execute.mock.invocationCallOrder[0]);
  });

  it('returns structured execution metadata without executing generators twice', async () => {
    const subject = createSubject();

    const result = await subject.dispatcher.dispatchStructured({
      userId: 'user-id',
      legacyIntent: 'DIET',
      decision: decision(CONVERSATION_GOAL.GENERATE_DIET_PLAN),
    });

    expect(result).toMatchObject({
      executor: 'DIET_LEGACY',
      generationCompleted: true,
      fallbackApplied: false,
    });
    expect(result.content).toContain('Montei Dieta legado');
    expect(subject.dietGenerator.generate).toHaveBeenCalledTimes(1);
    expect(subject.workoutGenerator.generate).not.toHaveBeenCalled();
  });

  it('fails the ready Diet candidate when Workout generation aborts BOTH before commit', async () => {
    const subject = createSubject();
    const failure = new Error('workout provider failed');
    subject.workoutGenerator.generateCandidate.mockRejectedValue(failure);

    await expect(
      subject.dispatcher.dispatch({
        userId: 'user-id',
        legacyIntent: 'BOTH',
        decision: null,
      }),
    ).rejects.toThrow('workout provider failed');
    expect(subject.dietGenerator.failCandidate).toHaveBeenCalledWith(
      { domain: 'DIET' },
      expect.objectContaining({
        message: expect.stringContaining(
          'Planejamento combinado abortado antes do commit',
        ),
      }),
    );
    expect(subject.bothExecutor.execute).not.toHaveBeenCalled();
  });
});
