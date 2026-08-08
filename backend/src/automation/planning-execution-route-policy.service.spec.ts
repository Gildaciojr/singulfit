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
    ['DISABLED', 'NUTRITION_PILOT_NOT_ELIGIBLE'],
    ['INVALID_CONFIG', 'NUTRITION_PILOT_NOT_ELIGIBLE'],
    ['NOT_AUTHORIZED', 'NUTRITION_PILOT_NOT_ELIGIBLE'],
    ['INELIGIBLE_OPERATION', 'NUTRITION_PILOT_NOT_ELIGIBLE'],
    ['MISSING_OWNERSHIP', 'NUTRITION_PILOT_NOT_ELIGIBLE'],
    ['ELIGIBLE', 'NUTRITION_V2_ELIGIBLE'],
  ] as const)(
    'selects exactly one DIET route for pilot status %s',
    (status, reason) => {
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
        nutrition: status === 'ELIGIBLE' ? 'V2' : 'LEGACY',
        workout: null,
        reason,
        nutritionPilotStatus: status,
        suppressNutritionShadow: status === 'ELIGIBLE',
      });
      expect(subject.nutritionPilot.evaluate).toHaveBeenCalledTimes(1);
    },
  );

  it('keeps WORKOUT Legacy because no production V2 rollout exists', () => {
    const subject = setup('ELIGIBLE');

    expect(
      subject.policy.select({
        userId: 'user-id',
        profileId: 'profile-id',
        decision: decision('GENERATE_WORKOUT_PLAN'),
        generationInput: null,
      }),
    ).toEqual({
      nutrition: null,
      workout: 'LEGACY',
      reason: 'NO_WORKOUT_V2_PRODUCTION_ROLLOUT',
      nutritionPilotStatus: null,
      suppressNutritionShadow: false,
    });
    expect(subject.nutritionPilot.evaluate).not.toHaveBeenCalled();
  });

  it('keeps BOTH entirely Legacy while cross-domain atomicity is pending', () => {
    const subject = setup('ELIGIBLE');

    expect(
      subject.policy.select({
        userId: 'user-id',
        profileId: 'profile-id',
        decision: decision('GENERATE_COMBINED_PLANS'),
        generationInput: null,
      }),
    ).toEqual({
      nutrition: 'LEGACY',
      workout: 'LEGACY',
      reason: 'CROSS_DOMAIN_ATOMICITY_PENDING',
      nutritionPilotStatus: null,
      suppressNutritionShadow: false,
    });
    expect(subject.nutritionPilot.evaluate).not.toHaveBeenCalled();
  });
});
