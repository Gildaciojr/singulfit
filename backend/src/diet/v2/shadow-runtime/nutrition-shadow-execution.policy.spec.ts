import { ConfigService } from '@nestjs/config';
import {
  CONVERSATION_GOAL,
  type ConversationGoalDecision,
} from '../../../context/conversation-goal-planner.contract';
import { NutritionShadowExecutionPolicy } from './nutrition-shadow-execution.policy';

describe(NutritionShadowExecutionPolicy.name, () => {
  function decision(
    goal: ConversationGoalDecision['goal'],
  ): ConversationGoalDecision {
    return {
      recognizedIntent:
        goal === CONVERSATION_GOAL.GENERATE_WORKOUT_PLAN
          ? 'WORKOUT_PLAN_REQUEST'
          : 'DIET_PLAN_REQUEST',
      goal,
      reason:
        goal === CONVERSATION_GOAL.GENERATE_WORKOUT_PLAN
          ? 'WORKOUT_PROFILE_READY'
          : 'DIET_PROFILE_READY',
      targetPlan:
        goal === CONVERSATION_GOAL.GENERATE_WORKOUT_PLAN ? 'WORKOUT' : 'DIET',
      profileCompletionState: 'COMPLETE',
      canExecute: true,
      confidence: 'HIGH',
      selectedProfileField: null,
      metPreconditions: [],
      missingPreconditions: [],
      pendingDependencies: [],
    };
  }

  function policy(value?: string) {
    const config = {
      get: jest.fn(() => value),
    };
    return {
      policy: new NutritionShadowExecutionPolicy(
        config as unknown as ConfigService,
      ),
      config,
    };
  }

  it.each([undefined, '', 'false', '0', 'invalid'])(
    'fails closed when configured as %s',
    (value) => {
      expect(
        policy(value).policy.evaluate(
          decision(CONVERSATION_GOAL.GENERATE_DIET_PLAN),
        ),
      ).toEqual({ enabled: false, reason: 'DISABLED' });
    },
  );

  it.each(['1', 'true', 'YES', 'on'])(
    'enables internal nutrition execution for %s',
    (value) => {
      expect(
        policy(value).policy.evaluate(
          decision(CONVERSATION_GOAL.GENERATE_DIET_PLAN),
        ),
      ).toEqual({ enabled: true });
    },
  );

  it('does not turn the binary activation into workout or user rollout', () => {
    expect(
      policy('true').policy.evaluate(
        decision(CONVERSATION_GOAL.GENERATE_WORKOUT_PLAN),
      ),
    ).toEqual({ enabled: false, reason: 'NON_NUTRITION_GOAL' });
  });
});
