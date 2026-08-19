import type { ConversationGoalDecision } from '../context/conversation-goal-planner.contract';
import type { LongitudinalCoachingDecision } from '../longitudinal-coaching/longitudinal-coaching.contract';
import type { NutritionReasoningResult } from '../nutrition-reasoning/nutrition-reasoning.contract';
import type { WorkoutReasoningResult } from '../workout-reasoning/workout-reasoning.contract';
import type { CoachConversationHumanContext } from '../context/coach-conversation-human-context.contract';
import type { PlanningExecutionRouteSelection } from './planning-execution-route-policy.service';
import type { ProfileAcquisitionConversationContext } from '../context/coach-adaptive-profile-collector.contract';

export type CoachPlanningExecutor =
  | 'DIET_LEGACY'
  | 'DIET_V2'
  | 'WORKOUT_LEGACY'
  | 'WORKOUT_V2'
  | 'COMBINED_LEGACY'
  | 'UNKNOWN_LEGACY'
  | 'FAILURE_FALLBACK';

export interface CoachPlanningDispatchResult {
  readonly content: string;
  readonly executor: CoachPlanningExecutor;
  readonly generationCompleted: boolean;
  readonly fallbackApplied: boolean;
  readonly workoutDisposition?: 'PLAN' | 'CLARIFICATION' | 'BLOCKED';
}

export type CoachPlanningSelectedSource =
  | 'LEGACY'
  | 'NUTRITION_V2'
  | 'WORKOUT_V2';

export interface CoachPlanningReasoningState {
  readonly reasoningAppliedToGeneration: boolean;
  readonly reasoningObservedOnly: boolean;
  readonly reasoningUnavailable: boolean;
  readonly unavailableReason:
    | 'CONVERSATION_LAYER_OFF'
    | 'DOMAIN_NOT_REQUESTED'
    | 'CANONICAL_INPUT_UNAVAILABLE'
    | 'PRODUCTION_FAILED'
    | null;
}

export interface CoachPlanningExecutionMetadata {
  readonly correlationId: string | null;
  readonly operationKey: string | null;
  readonly executor: CoachPlanningExecutor;
  readonly fallbackApplied: boolean;
  readonly generationCompleted: boolean;
  readonly routeSelection: PlanningExecutionRouteSelection;
}

export interface CoachPlanningExecutionResult {
  readonly content: string;
  readonly responseRequired: boolean;
  readonly pendingExecutionClaimToken?: string;
  readonly profileAcquisitionContext?: ProfileAcquisitionConversationContext;
  readonly selectedSource: CoachPlanningSelectedSource;
  readonly decision: ConversationGoalDecision | null;
  readonly nutritionReasoning: NutritionReasoningResult | null;
  readonly workoutReasoning: WorkoutReasoningResult | null;
  readonly longitudinalDecision: LongitudinalCoachingDecision | null;
  readonly humanContext: CoachConversationHumanContext | null;
  readonly reasoning: {
    readonly nutrition: CoachPlanningReasoningState;
    readonly workout: CoachPlanningReasoningState;
    readonly longitudinal: CoachPlanningReasoningState;
  };
  readonly dispatch: CoachPlanningDispatchResult;
  readonly metadata: CoachPlanningExecutionMetadata;
}
