import type { ProfileAcquisitionField } from '../../context/coach-adaptive-profile-collector.contract';
import type {
  ConversationGoalDecision,
  ConversationGoalPlanTarget,
  ConversationGoalPrecondition,
} from '../../context/conversation-goal-planner.contract';
import type { NutritionArtifactType } from '../../diet/v2/nutrition-planning-artifact.contract';
import type {
  WorkoutArtifactType,
  WorkoutModality,
} from '../../workout/v2/workout-planning-artifact.contract';
import type { ConversationReference } from './conversation-entity.contract';
import type { ConversationOperation } from './conversation-intent.contract';
import type {
  ConversationSafety,
  ConversationUnderstandingResult,
} from './conversation-understanding.contract';

export const CONVERSATION_EXECUTION_ROUTER_VERSION =
  'conversation-execution-router:v1' as const;

export type ConversationExecutionRouteReason =
  | 'PLANNER_GOAL_ROUTED'
  | 'SAFETY_PRECEDENCE'
  | 'GOAL_NOT_EXECUTABLE'
  | 'MISSING_UPDATE_CONTEXT'
  | 'MISSING_TARGET_PLAN'
  | 'DECISION_INTENT_MISMATCH'
  | 'UNKNOWN_GOAL'
  | 'UNSUPPORTED_GUIDANCE_DOMAIN';

export type ConversationSafetyAction =
  | 'CONTINUE'
  | 'CAUTION_GUIDANCE'
  | 'PROFESSIONAL_GUIDANCE'
  | 'URGENT_GUIDANCE';

export interface ConversationSafetyRoutingDecision {
  readonly action: ConversationSafetyAction;
  readonly routeRequired: boolean;
  readonly reasonCodes: readonly string[];
}

export interface ConversationExecutionRouterInput {
  readonly understanding: ConversationUnderstandingResult;
  readonly goalDecision: ConversationGoalDecision;
}

interface ConversationExecutionRouteEnvelope {
  readonly routerVersion: typeof CONVERSATION_EXECUTION_ROUTER_VERSION;
  readonly goalDecision: ConversationGoalDecision;
  readonly reasonCodes: readonly ConversationExecutionRouteReason[];
  readonly canExecute: boolean;
  readonly missingPreconditions: readonly ConversationGoalPrecondition[];
}

export type ConversationExecutionRoute =
  | (ConversationExecutionRouteEnvelope &
      Readonly<{
        kind: 'PROFILE_ACQUISITION';
        targetPlan: ConversationGoalPlanTarget;
        selectedProfileField: ProfileAcquisitionField;
      }>)
  | (ConversationExecutionRouteEnvelope &
      Readonly<{ kind: 'ANSWER_MESSAGE'; operation: ConversationOperation }>)
  | (ConversationExecutionRouteEnvelope &
      Readonly<{
        kind: 'NUTRITION_GUIDANCE';
        operation: ConversationOperation;
        artifactType: NutritionArtifactType | null;
        references: readonly ConversationReference[];
      }>)
  | (ConversationExecutionRouteEnvelope &
      Readonly<{
        kind: 'NUTRITION_PLAN_GENERATION';
        targetPlan: 'DIET';
        artifactType: NutritionArtifactType | null;
      }>)
  | (ConversationExecutionRouteEnvelope &
      Readonly<{
        kind: 'NUTRITION_PLAN_UPDATE';
        targetPlan: 'DIET';
        artifactType: NutritionArtifactType | null;
        references: readonly ConversationReference[];
      }>)
  | (ConversationExecutionRouteEnvelope &
      Readonly<{
        kind: 'WORKOUT_PLAN_GENERATION';
        targetPlan: 'WORKOUT';
        artifactType: WorkoutArtifactType | null;
        modality: WorkoutModality | null;
      }>)
  | (ConversationExecutionRouteEnvelope &
      Readonly<{
        kind: 'WORKOUT_PLAN_UPDATE';
        targetPlan: 'WORKOUT';
        artifactType: WorkoutArtifactType | null;
        modality: WorkoutModality | null;
        references: readonly ConversationReference[];
      }>)
  | (ConversationExecutionRouteEnvelope &
      Readonly<{ kind: 'COMBINED_PLAN_GENERATION'; targetPlan: 'BOTH' }>)
  | (ConversationExecutionRouteEnvelope &
      Readonly<{
        kind: 'CURRENT_PLAN_PRESENTATION';
        targetPlan: ConversationGoalPlanTarget;
        references: readonly ConversationReference[];
      }>)
  | (ConversationExecutionRouteEnvelope &
      Readonly<{
        kind: 'PLAN_STATUS';
        targetPlan: ConversationGoalPlanTarget;
      }>)
  | (ConversationExecutionRouteEnvelope &
      Readonly<{
        kind: 'PROGRESS_REVIEW';
        targetPlan: ConversationGoalPlanTarget | null;
      }>)
  | (ConversationExecutionRouteEnvelope &
      Readonly<{
        kind: 'CONFIRMATION';
        targetPlan: ConversationGoalPlanTarget | null;
        references: readonly ConversationReference[];
      }>)
  | (ConversationExecutionRouteEnvelope &
      Readonly<{
        kind: 'SAFETY_RESPONSE';
        safety: ConversationSafety;
        action: Exclude<ConversationSafetyAction, 'CONTINUE'>;
      }>)
  | (ConversationExecutionRouteEnvelope &
      Readonly<{
        kind: 'LEGACY_FALLBACK';
        fallbackReason: Exclude<
          ConversationExecutionRouteReason,
          'PLANNER_GOAL_ROUTED' | 'SAFETY_PRECEDENCE'
        >;
      }>);

export const CONVERSATION_ROUTING_DECISION_VERSION =
  'conversation-routing-decision:v1' as const;

export interface ConversationRoutingDecision {
  readonly decisionVersion: typeof CONVERSATION_ROUTING_DECISION_VERSION;
  readonly understanding: ConversationUnderstandingResult;
  readonly plannerSummary: {
    readonly recognizedIntent: ConversationGoalDecision['recognizedIntent'];
    readonly targetPlan: ConversationGoalPlanTarget | null;
    readonly profileCompletionState: ConversationGoalDecision['profileCompletionState'];
    readonly progressContextAvailable: boolean;
    readonly confirmationRequired: boolean;
    readonly currentLogicalTurn: number;
  };
  readonly goalDecision: ConversationGoalDecision;
  readonly executionRoute: ConversationExecutionRoute;
  readonly versions: {
    readonly preparation: 'conversation-goal-preparation:v1';
    readonly router: typeof CONVERSATION_EXECUTION_ROUTER_VERSION;
    readonly decision: typeof CONVERSATION_ROUTING_DECISION_VERSION;
  };
}
