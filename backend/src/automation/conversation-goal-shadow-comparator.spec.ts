import {
  CONVERSATION_GOAL,
  CONVERSATION_RECOGNIZED_INTENT,
  ConversationGoal,
  ConversationGoalDecision,
} from '../context/conversation-goal-planner.contract';
import type { CoachCommandIntent } from './coach-command.service';
import { ConversationGoalShadowComparator } from './conversation-goal-shadow-comparator';
import { CONVERSATION_GOAL_SHADOW_COMPARISON_CATEGORY } from './conversation-goal-shadow-comparison.contract';
import { LegacyCoachIntentAdapter } from './legacy-coach-intent.adapter';

describe('ConversationGoalShadowComparator', () => {
  const comparator = new ConversationGoalShadowComparator();
  const adapter = new LegacyCoachIntentAdapter();

  function decision(
    goal: ConversationGoal,
    options: {
      readonly canExecute?: boolean;
      readonly field?: 'PRIMARY_GOAL';
    } = {},
  ): ConversationGoalDecision {
    return Object.freeze({
      recognizedIntent: CONVERSATION_RECOGNIZED_INTENT.UNKNOWN,
      goal,
      reason:
        goal === CONVERSATION_GOAL.ASK_PROFILE_INFORMATION
          ? 'PROFILE_INFORMATION_REQUIRED'
          : goal === CONVERSATION_GOAL.REQUEST_CONFIRMATION
            ? 'CONFIRMATION_REQUIRED'
            : goal === CONVERSATION_GOAL.UNKNOWN
              ? 'INTENT_NOT_RECOGNIZED'
              : 'DIRECT_MESSAGE_RESPONSE',
      targetPlan: null,
      profileCompletionState: 'PARTIAL',
      canExecute: options.canExecute ?? true,
      confidence: 'HIGH',
      selectedProfileField: options.field ?? null,
      metPreconditions: Object.freeze([]),
      missingPreconditions: Object.freeze([]),
      pendingDependencies: Object.freeze([]),
    });
  }

  function compare(legacyIntent: CoachCommandIntent, goal: ConversationGoal) {
    return comparator.compare({
      legacyIntent,
      adaptation: adapter.adapt(legacyIntent),
      snapshot: Object.freeze({
        completion: Object.freeze({
          overall: 'PARTIAL' as const,
          sections: Object.freeze([]),
        }),
      }),
      plannerDecision: decision(goal),
      referenceTimestamp: '2026-07-15T12:00:00.000Z',
    });
  }

  it.each([
    ['DIET', CONVERSATION_GOAL.GENERATE_DIET_PLAN],
    ['WORKOUT', CONVERSATION_GOAL.GENERATE_WORKOUT_PLAN],
    ['BOTH', CONVERSATION_GOAL.GENERATE_COMBINED_PLANS],
  ] as const)('classifies %s equivalence as EXACT_MATCH', (legacy, goal) => {
    expect(compare(legacy, goal).category).toBe(
      CONVERSATION_GOAL_SHADOW_COMPARISON_CATEGORY.EXACT_MATCH,
    );
  });

  it.each([
    [
      'UNKNOWN',
      CONVERSATION_GOAL.GENERAL_GUIDANCE,
      CONVERSATION_GOAL_SHADOW_COMPARISON_CATEGORY.COMPATIBLE,
    ],
    [
      'DIET',
      CONVERSATION_GOAL.UPDATE_DIET_PLAN,
      CONVERSATION_GOAL_SHADOW_COMPARISON_CATEGORY.PLANNER_MORE_SPECIFIC,
    ],
    [
      'DIET',
      CONVERSATION_GOAL.GENERAL_GUIDANCE,
      CONVERSATION_GOAL_SHADOW_COMPARISON_CATEGORY.LEGACY_MORE_SPECIFIC,
    ],
    [
      'DIET',
      CONVERSATION_GOAL.ASK_PROFILE_INFORMATION,
      CONVERSATION_GOAL_SHADOW_COMPARISON_CATEGORY.PROFILE_GAP,
    ],
    [
      'WORKOUT',
      CONVERSATION_GOAL.REQUEST_CONFIRMATION,
      CONVERSATION_GOAL_SHADOW_COMPARISON_CATEGORY.CONFIRMATION_GAP,
    ],
    [
      'DIET',
      CONVERSATION_GOAL.GENERATE_WORKOUT_PLAN,
      CONVERSATION_GOAL_SHADOW_COMPARISON_CATEGORY.CONFLICT,
    ],
    [
      'UNKNOWN',
      CONVERSATION_GOAL.UNKNOWN,
      CONVERSATION_GOAL_SHADOW_COMPARISON_CATEGORY.UNKNOWN,
    ],
  ] as const)('classifies %s / %s as %s', (legacy, goal, expected) => {
    expect(compare(legacy, goal).category).toBe(expected);
  });

  it('returns deterministic immutable sanitized metadata', () => {
    const input = {
      legacyIntent: 'DIET' as const,
      adaptation: adapter.adapt('DIET'),
      snapshot: Object.freeze({
        completion: Object.freeze({
          overall: 'PARTIAL' as const,
          sections: Object.freeze([]),
        }),
      }),
      plannerDecision: decision(CONVERSATION_GOAL.ASK_PROFILE_INFORMATION, {
        canExecute: false,
        field: 'PRIMARY_GOAL',
      }),
      referenceTimestamp: '2026-07-15T12:00:00.000Z',
    };
    const first = comparator.compare(input);
    const second = comparator.compare(input);

    expect(second).toEqual(first);
    expect(first.missingProfileField).toBe('PRIMARY_GOAL');
    expect(first.sanitizedReason).toBe('PROFILE_INFORMATION_REQUIRED');
    expect(Object.isFrozen(first)).toBe(true);
  });
});
