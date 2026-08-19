import { Injectable } from '@nestjs/common';
import type { ConversationGoalDecision } from '../context/conversation-goal-planner.contract';
import { CONVERSATION_GOAL } from '../context/conversation-goal-planner.contract';
import type { GenerateNutritionPlanV2Input } from '../diet/v2/nutrition-planning-generation.contract';
import type { GenerateWorkoutPlanV2Input } from '../workout/v2/workout-planning-generation.contract';
import {
  NutritionV2PilotService,
  type NutritionV2PilotEligibilityStatus,
} from './nutrition-v2-pilot.service';

export type PlanningImplementationRoute = 'LEGACY' | 'V2';

export type PlanningRouteSelectionReason =
  | 'NUTRITION_V2_ELIGIBLE'
  | 'NUTRITION_PILOT_NOT_ELIGIBLE'
  | 'WORKOUT_V2_PRODUCTIVE_GENERATION'
  | 'WORKOUT_V2_CANONICAL_READ'
  | 'CROSS_DOMAIN_ATOMICITY_PENDING'
  | 'LEGACY_INTENT_OR_UNSUPPORTED_GOAL';

export interface PlanningExecutionRoutePolicyInput {
  readonly userId: string;
  readonly profileId: string | null;
  readonly decision: ConversationGoalDecision | null;
  readonly generationInput: GenerateNutritionPlanV2Input | null;
  readonly workoutGenerationInput?: GenerateWorkoutPlanV2Input | null;
}

export interface PlanningExecutionRouteSelection {
  readonly nutrition: PlanningImplementationRoute | null;
  readonly workout: PlanningImplementationRoute | null;
  readonly reason: PlanningRouteSelectionReason;
  readonly nutritionPilotStatus: NutritionV2PilotEligibilityStatus | null;
  readonly suppressNutritionShadow: boolean;
}

@Injectable()
export class PlanningExecutionRoutePolicyService {
  constructor(private readonly nutritionPilot: NutritionV2PilotService) {}

  select(
    input: PlanningExecutionRoutePolicyInput,
  ): PlanningExecutionRouteSelection {
    const decision = input.decision;
    const goal = decision?.goal;
    if (goal === CONVERSATION_GOAL.GENERATE_COMBINED_PLANS) {
      return this.selection(
        'LEGACY',
        'LEGACY',
        'CROSS_DOMAIN_ATOMICITY_PENDING',
      );
    }
    if (
      decision?.targetPlan === 'WORKOUT' &&
      (goal === CONVERSATION_GOAL.SHOW_CURRENT_PLAN ||
        goal === CONVERSATION_GOAL.SHOW_PLAN_STATUS)
    ) {
      return this.selection(null, 'V2', 'WORKOUT_V2_CANONICAL_READ');
    }
    if (
      goal === CONVERSATION_GOAL.GENERATE_WORKOUT_PLAN ||
      input.workoutGenerationInput
    ) {
      return this.selection(null, 'V2', 'WORKOUT_V2_PRODUCTIVE_GENERATION');
    }
    if (decision && goal === CONVERSATION_GOAL.GENERATE_DIET_PLAN) {
      const pilot = this.nutritionPilot.evaluate({
        userId: input.userId,
        profileId: input.profileId,
        decision,
        generationInput: input.generationInput,
      });
      return this.selection(
        pilot.eligible ? 'V2' : 'LEGACY',
        null,
        pilot.eligible
          ? 'NUTRITION_V2_ELIGIBLE'
          : 'NUTRITION_PILOT_NOT_ELIGIBLE',
        pilot.status,
        pilot.eligible,
      );
    }
    return this.selection('LEGACY', null, 'LEGACY_INTENT_OR_UNSUPPORTED_GOAL');
  }

  private selection(
    nutrition: PlanningImplementationRoute | null,
    workout: PlanningImplementationRoute | null,
    reason: PlanningRouteSelectionReason,
    nutritionPilotStatus: NutritionV2PilotEligibilityStatus | null = null,
    suppressNutritionShadow = false,
  ): PlanningExecutionRouteSelection {
    return Object.freeze({
      nutrition,
      workout,
      reason,
      nutritionPilotStatus,
      suppressNutritionShadow,
    });
  }
}
