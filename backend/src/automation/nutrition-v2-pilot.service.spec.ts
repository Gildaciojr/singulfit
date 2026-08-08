import type { ConversationGoalDecision } from '../context/conversation-goal-planner.contract';
import type { GenerateNutritionPlanV2Input } from '../diet/v2/nutrition-planning-generation.contract';
import type {
  NutritionV2PilotAuthorization,
  NutritionV2PilotConfigService,
} from './nutrition-v2-pilot-config.service';
import { NutritionV2PilotService } from './nutrition-v2-pilot.service';

const USER_ID = '123e4567-e89b-42d3-a456-426614174000';

function decision(goal = 'GENERATE_DIET_PLAN'): ConversationGoalDecision {
  return Object.freeze({ goal }) as unknown as ConversationGoalDecision;
}

function generationInput(
  artifactType = 'DAILY_STRUCTURE',
): GenerateNutritionPlanV2Input {
  return Object.freeze({
    userId: USER_ID,
    decision: decision(),
    snapshot: Object.freeze({}),
    referenceDate: new Date('2026-07-30T12:00:00.000Z'),
    explicitArtifactType: artifactType,
  }) as unknown as GenerateNutritionPlanV2Input;
}

describe('NutritionV2PilotService', () => {
  function setup(
    authorization: NutritionV2PilotAuthorization = { status: 'AUTHORIZED' },
  ) {
    const config = { authorize: jest.fn().mockReturnValue(authorization) };
    return {
      config,
      service: new NutritionV2PilotService(
        config as unknown as NutritionV2PilotConfigService,
      ),
    };
  }

  it.each([['DISABLED'], ['INVALID_CONFIG'], ['NOT_AUTHORIZED']] as const)(
    'fails closed for authorization status %s',
    (status) => {
      const test = setup({ status });
      expect(
        test.service.evaluate({
          userId: USER_ID,
          profileId: 'profile-id',
          decision: decision(),
          generationInput: generationInput(),
        }),
      ).toEqual({ status, eligible: false });
    },
  );

  it.each([
    ['GENERATE_COMBINED_PLANS', 'DAILY_STRUCTURE'],
    ['UPDATE_DIET_PLAN', 'DAILY_STRUCTURE'],
    ['GENERAL_GUIDANCE', 'POINT_GUIDANCE'],
    ['GENERATE_DIET_PLAN', 'WEEKLY_PLAN'],
  ])('rejects ineligible goal %s or artifact %s', (goal, artifactType) => {
    const test = setup();
    expect(
      test.service.evaluate({
        userId: USER_ID,
        profileId: 'profile-id',
        decision: decision(goal),
        generationInput: generationInput(artifactType),
      }),
    ).toEqual({ status: 'INELIGIBLE_OPERATION', eligible: false });
  });

  it('rejects missing profile ownership prerequisites', () => {
    const test = setup();
    expect(
      test.service.evaluate({
        userId: USER_ID,
        profileId: null,
        decision: decision(),
        generationInput: generationInput(),
      }),
    ).toEqual({ status: 'MISSING_OWNERSHIP', eligible: false });
  });

  it('authorizes only the existing daily-plan cohort without side effects', () => {
    const test = setup();
    expect(
      test.service.evaluate({
        userId: USER_ID,
        profileId: 'profile-id',
        decision: decision(),
        generationInput: generationInput(),
      }),
    ).toEqual({ status: 'ELIGIBLE', eligible: true });
    expect(test.config.authorize).toHaveBeenCalledTimes(1);
  });
});
