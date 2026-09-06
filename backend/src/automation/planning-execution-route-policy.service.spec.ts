import type { ConversationGoalDecision } from '../context/conversation-goal-planner.contract';
import type { GenerateNutritionPlanV2Input } from '../diet/v2/nutrition-planning-generation.contract';
import type { NutritionV2PilotService } from './nutrition-v2-pilot.service';
import { PlanningExecutionRoutePolicyService } from './planning-execution-route-policy.service';

describe('PlanningExecutionRoutePolicyService', () => {
  function decision(goal: string): ConversationGoalDecision {
    return Object.freeze({ goal }) as unknown as ConversationGoalDecision;
  }

  function setup(
    status:
      | 'DISABLED'
      | 'INVALID_CONFIG'
      | 'NOT_AUTHORIZED'
      | 'INELIGIBLE_OPERATION'
      | 'MISSING_OWNERSHIP'
      | 'ELIGIBLE',
  ) {
    const nutritionPilot = {
      evaluate: jest.fn().mockReturnValue({
        status,
        eligible: status === 'ELIGIBLE',
      }),
    };
    return {
      nutritionPilot,
      policy: new PlanningExecutionRoutePolicyService(
        nutritionPilot as unknown as NutritionV2PilotService,
      ),
    };
  }

  it.each([
    'DISABLED',
    'INVALID_CONFIG',
    'NOT_AUTHORIZED',
    'INELIGIBLE_OPERATION',
    'MISSING_OWNERSHIP',
    'ELIGIBLE',
  ] as const)(
    'selects public Nutrition V2 independently of pilot status %s',
    (status) => {
      const subject = setup(status);
      const planningDecision = decision('GENERATE_DIET_PLAN');
      const generationInput = Object.freeze({
        explicitArtifactType: 'DAILY_STRUCTURE',
      }) as unknown as GenerateNutritionPlanV2Input;

      expect(
        subject.policy.select({
          userId: 'user-id',
          profileId: 'profile-id',
          decision: planningDecision,
          generationInput,
        }),
      ).toEqual({
        nutrition: 'V2',
        workout: null,
        reason: 'NUTRITION_V2_OFFICIAL_ROUTE',
        nutritionPilotStatus: status,
        suppressNutritionShadow: true,
      });
      expect(subject.nutritionPilot.evaluate).toHaveBeenCalledTimes(1);
    },
  );

  it('selects Workout V2 before any productive effect', () => {
    const subject = setup('ELIGIBLE');

    expect(
      subject.policy.select({
        userId: 'user-id',
        profileId: 'profile-id',
        decision: decision('GENERATE_WORKOUT_PLAN'),
        generationInput: null,
        workoutGenerationInput: { userId: 'user-id' } as never,
      }),
    ).toEqual({
      nutrition: null,
      workout: 'V2',
      reason: 'WORKOUT_V2_PRODUCTIVE_GENERATION',
      nutritionPilotStatus: null,
      suppressNutritionShadow: false,
    });
    expect(subject.nutritionPilot.evaluate).not.toHaveBeenCalled();
  });

  it('routes missing Nutrition profile to productive V2 acquisition', () => {
    const subject = setup('NOT_AUTHORIZED');
    expect(
      subject.policy.select({
        userId: 'ordinary-user',
        profileId: 'profile-id',
        decision: {
          ...decision('ASK_PROFILE_INFORMATION'),
          targetPlan: 'DIET',
        },
        generationInput: null,
      }),
    ).toEqual({
      nutrition: 'V2',
      workout: null,
      reason: 'NUTRITION_V2_PROFILE_ACQUISITION',
      nutritionPilotStatus: null,
      suppressNutritionShadow: false,
    });
    expect(subject.nutritionPilot.evaluate).not.toHaveBeenCalled();
  });

  it('keeps BOTH on productive V2 acquisition when profiles are incomplete', () => {
    const subject = setup('NOT_AUTHORIZED');
    expect(
      subject.policy.select({
        userId: 'ordinary-user',
        profileId: 'profile-id',
        decision: {
          ...decision('ASK_PROFILE_INFORMATION'),
          targetPlan: 'BOTH',
        },
        generationInput: null,
      }),
    ).toMatchObject({
      nutrition: 'V2',
      workout: 'V2',
      reason: 'COMBINED_V2_PROFILE_ACQUISITION',
    });
  });

  it('selects the canonical V2 reader for current Workout queries for every user', () => {
    const subject = setup('NOT_AUTHORIZED');
    expect(
      subject.policy.select({
        userId: 'ordinary-user',
        profileId: 'profile-id',
        decision: {
          ...decision('SHOW_CURRENT_PLAN'),
          targetPlan: 'WORKOUT',
        },
        generationInput: null,
      }),
    ).toEqual({
      nutrition: null,
      workout: 'V2',
      reason: 'WORKOUT_V2_CANONICAL_READ',
      nutritionPilotStatus: null,
      suppressNutritionShadow: false,
    });
    expect(subject.nutritionPilot.evaluate).not.toHaveBeenCalled();
  });

  it('selects Workout V2 for plan mutations without an admin or pilot gate', () => {
    const subject = setup('NOT_AUTHORIZED');

    expect(
      subject.policy.select({
        userId: 'ordinary-user',
        profileId: 'profile-id',
        decision: decision('UPDATE_WORKOUT_PLAN'),
        generationInput: null,
        workoutMutation: true,
      }),
    ).toEqual({
      nutrition: null,
      workout: 'V2',
      reason: 'WORKOUT_V2_PLAN_MUTATION',
      nutritionPilotStatus: null,
      suppressNutritionShadow: false,
    });
    expect(subject.nutritionPilot.evaluate).not.toHaveBeenCalled();
  });

  it('decomposes BOTH into V2 flows without selecting legacy', () => {
    const subject = setup('ELIGIBLE');

    expect(
      subject.policy.select({
        userId: 'user-id',
        profileId: 'profile-id',
        decision: decision('GENERATE_COMBINED_PLANS'),
        generationInput: null,
      }),
    ).toEqual({
      nutrition: 'V2',
      workout: 'V2',
      reason: 'CROSS_DOMAIN_V2_DECOMPOSITION_REQUIRED',
      nutritionPilotStatus: null,
      suppressNutritionShadow: false,
    });
    expect(subject.nutritionPilot.evaluate).not.toHaveBeenCalled();
  });
});
