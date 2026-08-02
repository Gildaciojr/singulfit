import { Prisma } from '@prisma/client';
import {
  CONVERSATION_GOAL,
  type ConversationGoal,
  type ConversationGoalDecision,
} from '../context/conversation-goal-planner.contract';
import { DietGeneratorService } from '../diet/diet-generator.service';
import { WorkoutGeneratorService } from '../workout/workout-generator.service';
import { CoachPlanningExecutionDispatcherService } from './coach-planning-execution-dispatcher.service';

describe('CoachPlanningExecutionDispatcherService', () => {
  const unsupportedGoals: readonly ConversationGoal[] = [
    CONVERSATION_GOAL.ANSWER_MESSAGE,
    CONVERSATION_GOAL.ASK_PROFILE_INFORMATION,
    CONVERSATION_GOAL.UPDATE_DIET_PLAN,
    CONVERSATION_GOAL.UPDATE_WORKOUT_PLAN,
    CONVERSATION_GOAL.REVIEW_PROGRESS,
    CONVERSATION_GOAL.REQUEST_CONFIRMATION,
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
    const dietGenerator = {
      generate: jest.fn().mockResolvedValue({
        title: 'Dieta legado',
        objective: 'WEIGHT_LOSS',
        dailyCaloriesTarget: new Prisma.Decimal(1800),
        proteinTarget: new Prisma.Decimal(140),
        carbsTarget: new Prisma.Decimal(180),
        fatTarget: new Prisma.Decimal(60),
        meals: [],
      }),
    };
    const workoutGenerator = {
      generate: jest.fn().mockResolvedValue({
        title: 'Treino legado',
        objective: 'MUSCLE_GAIN',
        days: [],
      }),
    };
    const dispatcher = new CoachPlanningExecutionDispatcherService(
      dietGenerator as unknown as DietGeneratorService,
      workoutGenerator as unknown as WorkoutGeneratorService,
    );

    return { dispatcher, dietGenerator, workoutGenerator };
  }

  it.each([
    [CONVERSATION_GOAL.GENERATE_DIET_PLAN, 1, 0],
    [CONVERSATION_GOAL.GENERATE_WORKOUT_PLAN, 0, 1],
    [CONVERSATION_GOAL.GENERATE_COMBINED_PLANS, 1, 1],
  ] as const)(
    'dispatches %s through legacy generators',
    async (goal, diets, workouts) => {
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
      subject.dietGenerator.generate.mock.invocationCallOrder[0],
    ).toBeLessThan(
      subject.workoutGenerator.generate.mock.invocationCallOrder[0],
    );
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
});
