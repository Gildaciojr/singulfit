import { Injectable } from '@nestjs/common';
import type { CoachProfileSnapshot } from '../context/coach-profile-snapshot.contract';
import {
  CONVERSATION_GOAL,
  ConversationGoalDecision,
} from '../context/conversation-goal-planner.contract';
import type { CoachCommandIntent } from './coach-command.service';
import {
  CONVERSATION_GOAL_SHADOW_COMPARISON_CATEGORY,
  CONVERSATION_GOAL_SHADOW_COMPARATOR_VERSION,
  ConversationGoalShadowComparison,
  ConversationGoalShadowComparisonCategory,
} from './conversation-goal-shadow-comparison.contract';
import type { LegacyCoachIntentAdaptation } from './legacy-coach-intent-adapter.contract';

export const CONVERSATION_GOAL_PLANNER_VERSION = 'conversation-goal-planner:v1';

export interface CompareConversationGoalShadowInput {
  readonly legacyIntent: CoachCommandIntent;
  readonly adaptation: LegacyCoachIntentAdaptation;
  readonly snapshot: Pick<CoachProfileSnapshot, 'completion'>;
  readonly plannerDecision: ConversationGoalDecision;
  readonly referenceTimestamp: string;
}

@Injectable()
export class ConversationGoalShadowComparator {
  compare(
    input: CompareConversationGoalShadowInput,
  ): ConversationGoalShadowComparison {
    const category = this.category(input.legacyIntent, input.plannerDecision);

    return Object.freeze({
      legacyDecision: input.legacyIntent,
      plannerGoal: input.plannerDecision.goal,
      agreement:
        category === CONVERSATION_GOAL_SHADOW_COMPARISON_CATEGORY.EXACT_MATCH ||
        category === CONVERSATION_GOAL_SHADOW_COMPARISON_CATEGORY.COMPATIBLE,
      category,
      canExecute: input.plannerDecision.canExecute,
      missingProfileField: input.plannerDecision.selectedProfileField,
      adaptedIntent: input.adaptation.recognizedIntent,
      targetPlan: input.plannerDecision.targetPlan,
      profileCompletionState: input.snapshot.completion.overall,
      sanitizedReason: input.plannerDecision.reason,
      adapterVersion: input.adaptation.adapterVersion,
      plannerVersion: CONVERSATION_GOAL_PLANNER_VERSION,
      comparatorVersion: CONVERSATION_GOAL_SHADOW_COMPARATOR_VERSION,
      referenceTimestamp: input.referenceTimestamp,
    });
  }

  private category(
    legacyIntent: CoachCommandIntent,
    plannerDecision: ConversationGoalDecision,
  ): ConversationGoalShadowComparisonCategory {
    if (this.exactMatch(legacyIntent, plannerDecision.goal)) {
      return CONVERSATION_GOAL_SHADOW_COMPARISON_CATEGORY.EXACT_MATCH;
    }

    if (plannerDecision.goal === CONVERSATION_GOAL.ASK_PROFILE_INFORMATION) {
      return CONVERSATION_GOAL_SHADOW_COMPARISON_CATEGORY.PROFILE_GAP;
    }

    if (plannerDecision.goal === CONVERSATION_GOAL.REQUEST_CONFIRMATION) {
      return CONVERSATION_GOAL_SHADOW_COMPARISON_CATEGORY.CONFIRMATION_GAP;
    }

    if (
      legacyIntent === 'UNKNOWN' &&
      (plannerDecision.goal === CONVERSATION_GOAL.ANSWER_MESSAGE ||
        plannerDecision.goal === CONVERSATION_GOAL.GENERAL_GUIDANCE)
    ) {
      return CONVERSATION_GOAL_SHADOW_COMPARISON_CATEGORY.COMPATIBLE;
    }

    if (this.plannerMoreSpecific(legacyIntent, plannerDecision.goal)) {
      return CONVERSATION_GOAL_SHADOW_COMPARISON_CATEGORY.PLANNER_MORE_SPECIFIC;
    }

    if (
      legacyIntent !== 'UNKNOWN' &&
      (plannerDecision.goal === CONVERSATION_GOAL.ANSWER_MESSAGE ||
        plannerDecision.goal === CONVERSATION_GOAL.GENERAL_GUIDANCE)
    ) {
      return CONVERSATION_GOAL_SHADOW_COMPARISON_CATEGORY.LEGACY_MORE_SPECIFIC;
    }

    if (
      legacyIntent === 'UNKNOWN' &&
      plannerDecision.goal !== CONVERSATION_GOAL.UNKNOWN
    ) {
      return CONVERSATION_GOAL_SHADOW_COMPARISON_CATEGORY.UNSUPPORTED_LEGACY_INTENT;
    }

    if (
      legacyIntent !== 'UNKNOWN' &&
      plannerDecision.goal === CONVERSATION_GOAL.UNKNOWN
    ) {
      return CONVERSATION_GOAL_SHADOW_COMPARISON_CATEGORY.UNSUPPORTED_PLANNER_GOAL;
    }

    if (this.conflicts(legacyIntent, plannerDecision.goal)) {
      return CONVERSATION_GOAL_SHADOW_COMPARISON_CATEGORY.CONFLICT;
    }

    return CONVERSATION_GOAL_SHADOW_COMPARISON_CATEGORY.UNKNOWN;
  }

  private exactMatch(
    legacyIntent: CoachCommandIntent,
    goal: ConversationGoalDecision['goal'],
  ): boolean {
    return (
      (legacyIntent === 'DIET' &&
        goal === CONVERSATION_GOAL.GENERATE_DIET_PLAN) ||
      (legacyIntent === 'WORKOUT' &&
        goal === CONVERSATION_GOAL.GENERATE_WORKOUT_PLAN) ||
      (legacyIntent === 'BOTH' &&
        goal === CONVERSATION_GOAL.GENERATE_COMBINED_PLANS)
    );
  }

  private plannerMoreSpecific(
    legacyIntent: CoachCommandIntent,
    goal: ConversationGoalDecision['goal'],
  ): boolean {
    return (
      (legacyIntent === 'DIET' &&
        goal === CONVERSATION_GOAL.UPDATE_DIET_PLAN) ||
      (legacyIntent === 'WORKOUT' &&
        goal === CONVERSATION_GOAL.UPDATE_WORKOUT_PLAN) ||
      ((legacyIntent === 'DIET' ||
        legacyIntent === 'WORKOUT' ||
        legacyIntent === 'BOTH') &&
        (goal === CONVERSATION_GOAL.SHOW_CURRENT_PLAN ||
          goal === CONVERSATION_GOAL.SHOW_PLAN_STATUS))
    );
  }

  private conflicts(
    legacyIntent: CoachCommandIntent,
    goal: ConversationGoalDecision['goal'],
  ): boolean {
    return (
      (legacyIntent === 'DIET' &&
        (goal === CONVERSATION_GOAL.GENERATE_WORKOUT_PLAN ||
          goal === CONVERSATION_GOAL.UPDATE_WORKOUT_PLAN)) ||
      (legacyIntent === 'WORKOUT' &&
        (goal === CONVERSATION_GOAL.GENERATE_DIET_PLAN ||
          goal === CONVERSATION_GOAL.UPDATE_DIET_PLAN)) ||
      (legacyIntent === 'BOTH' &&
        (goal === CONVERSATION_GOAL.GENERATE_DIET_PLAN ||
          goal === CONVERSATION_GOAL.GENERATE_WORKOUT_PLAN ||
          goal === CONVERSATION_GOAL.UPDATE_DIET_PLAN ||
          goal === CONVERSATION_GOAL.UPDATE_WORKOUT_PLAN))
    );
  }
}
