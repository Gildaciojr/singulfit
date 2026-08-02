import type { ConversationGoalDecision } from '../context/conversation-goal-planner.contract';
import type { LongitudinalCoachingDecision } from '../longitudinal-coaching/longitudinal-coaching.contract';
import type { NutritionReasoningResult } from '../nutrition-reasoning/nutrition-reasoning.contract';
import type { WorkoutReasoningResult } from '../workout-reasoning/workout-reasoning.contract';

export type CoachPlanningExecutor =
  | 'DIET_LEGACY'
  | 'WORKOUT_LEGACY'
  | 'COMBINED_LEGACY'
  | 'UNKNOWN_LEGACY'
  | 'FAILURE_FALLBACK';

export interface CoachPlanningDispatchResult {
  readonly content: string;
  readonly executor: CoachPlanningExecutor;
  readonly generationCompleted: boolean;
  readonly fallbackApplied: boolean;
}

export type CoachPlanningSelectedSource = 'LEGACY' | 'NUTRITION_V2';

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
}

export interface CoachPlanningExecutionResult {
  readonly content: string;
  readonly selectedSource: CoachPlanningSelectedSource;
  readonly decision: ConversationGoalDecision | null;
  readonly nutritionReasoning: NutritionReasoningResult | null;
  readonly workoutReasoning: WorkoutReasoningResult | null;
  readonly longitudinalDecision: LongitudinalCoachingDecision | null;
  readonly reasoning: {
    readonly nutrition: CoachPlanningReasoningState;
    readonly workout: CoachPlanningReasoningState;
    readonly longitudinal: CoachPlanningReasoningState;
  };
  readonly dispatch: CoachPlanningDispatchResult;
  readonly metadata: CoachPlanningExecutionMetadata;
}
