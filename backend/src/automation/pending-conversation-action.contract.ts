import { FitnessGoal } from '@prisma/client';
import type { CoachCommandIntent } from './coach-command.service';
import type { CurrentGoalResolution } from './user-goal-engine.service';
import type { PlanningExecutionRouteSelection } from './planning-execution-route-policy.service';

export const GOAL_CONFIRMATION_ALLOWED_GOALS = Object.freeze([
  FitnessGoal.WEIGHT_LOSS,
  FitnessGoal.MUSCLE_GAIN,
  FitnessGoal.MAINTENANCE,
] as const);

export interface GoalConfirmationPayload {
  readonly schemaVersion: 1;
  readonly declaredOutcome: string | null;
  readonly allowedGoals: readonly FitnessGoal[];
  readonly originalIntent: CoachCommandIntent;
  readonly targetPlan: 'DIET' | 'WORKOUT' | 'BOTH' | null;
  readonly originalMessage: string;
  readonly originalReferenceDate: string;
  readonly desiredMealCount: number | null;
  readonly resolvedGoal: FitnessGoal | null;
  readonly selectedRoute: PlanningExecutionRouteSelection | null;
}

export interface PendingGoalConfirmationContext {
  readonly actionId: string;
  readonly operationKey: string;
  readonly originalIntent: CoachCommandIntent;
  readonly payload: GoalConfirmationPayload;
  readonly continuation: boolean;
  readonly resolution: Extract<
    CurrentGoalResolution,
    { status: 'RESOLVED' | 'REQUIRES_CONFIRMATION' }
  >;
}

export type PendingInboundResolution =
  | Readonly<{ status: 'NONE' | 'UNRELATED' | 'EXPIRED' }>
  | Readonly<{ status: 'ALREADY_CONSUMED'; intent: CoachCommandIntent }>
  | Readonly<{
      status: 'COMPLETED';
      intent: CoachCommandIntent;
      content: string;
    }>
  | Readonly<{
      status: 'ACTIONABLE';
      context: PendingGoalConfirmationContext;
    }>;

export type PendingGoalConsumptionResult =
  | 'APPLIED'
  | 'CONTINUE'
  | 'REPLAY'
  | 'ALREADY_CONSUMED'
  | 'EXPIRED'
  | 'STALE';

export type PendingGoalCompletionResult =
  | Readonly<{ status: 'COMPLETED'; content: string }>
  | Readonly<{ status: 'FENCED' }>;

export type PendingGoalExecutionClaimResult =
  | Readonly<{ status: 'CLAIMED'; claimToken: string }>
  | Readonly<{ status: 'IN_PROGRESS' }>
  | Readonly<{ status: 'COMPLETED' }>;

export type PendingGoalExecutionReleaseResult = 'RELEASED' | 'FENCED';
