import { Injectable } from '@nestjs/common';
import { CONVERSATION_GOAL } from '../../context/conversation-goal-planner.contract';
import type { NutritionArtifactType } from '../../diet/v2/nutrition-planning-artifact.contract';
import type {
  WorkoutArtifactType,
  WorkoutModality,
} from '../../workout/v2/workout-planning-artifact.contract';
import type { ConversationReference } from '../contracts/conversation-entity.contract';
import {
  CONVERSATION_EXECUTION_ROUTER_VERSION,
  type ConversationExecutionRoute,
  type ConversationExecutionRouteReason,
  type ConversationExecutionRouterInput,
} from '../contracts/conversation-execution-route.contract';
import { ConversationUnderstandingValidator } from '../validators/conversation-understanding.validator';
import { evaluateConversationSafety } from './conversation-safety-routing.policy';

@Injectable()
export class ConversationExecutionRouterService {
  constructor(private readonly validator: ConversationUnderstandingValidator) {}

  route(input: ConversationExecutionRouterInput): ConversationExecutionRoute {
    this.validator.assertValid(input.understanding);
    const safety = evaluateConversationSafety(input.understanding.safety);
    if (safety.routeRequired && safety.action !== 'CONTINUE') {
      return Object.freeze({
        ...this.envelope(input, 'SAFETY_PRECEDENCE'),
        kind: 'SAFETY_RESPONSE',
        safety: input.understanding.safety,
        action: safety.action,
      });
    }
    if (input.goalDecision.recognizedIntent !== input.understanding.intent) {
      return this.fallback(input, 'DECISION_INTENT_MISMATCH');
    }
    if (!input.goalDecision.canExecute) {
      return this.fallback(input, 'GOAL_NOT_EXECUTABLE');
    }

    switch (input.goalDecision.goal) {
      case CONVERSATION_GOAL.ASK_PROFILE_INFORMATION:
        return this.profileAcquisition(input);
      case CONVERSATION_GOAL.ANSWER_MESSAGE:
        return Object.freeze({
          ...this.envelope(input),
          kind: 'ANSWER_MESSAGE',
          operation: input.understanding.operation,
        });
      case CONVERSATION_GOAL.GENERATE_DIET_PLAN:
        return Object.freeze({
          ...this.envelope(input),
          kind: 'NUTRITION_PLAN_GENERATION',
          targetPlan: 'DIET',
          artifactType: this.nutritionArtifact(input),
        });
      case CONVERSATION_GOAL.GENERATE_WORKOUT_PLAN:
        return Object.freeze({
          ...this.envelope(input),
          kind: 'WORKOUT_PLAN_GENERATION',
          targetPlan: 'WORKOUT',
          artifactType: this.workoutArtifact(input),
          modality: this.workoutModality(input),
        });
      case CONVERSATION_GOAL.GENERATE_COMBINED_PLANS:
        return Object.freeze({
          ...this.envelope(input),
          kind: 'COMBINED_PLAN_GENERATION',
          targetPlan: 'BOTH',
        });
      case CONVERSATION_GOAL.UPDATE_DIET_PLAN:
        return this.nutritionUpdate(input);
      case CONVERSATION_GOAL.UPDATE_WORKOUT_PLAN:
        return this.workoutUpdate(input);
      case CONVERSATION_GOAL.REVIEW_PROGRESS:
        return Object.freeze({
          ...this.envelope(input),
          kind: 'PROGRESS_REVIEW',
          targetPlan: input.goalDecision.targetPlan,
        });
      case CONVERSATION_GOAL.REQUEST_CONFIRMATION:
        return this.confirmation(input, 'PLANNER_GOAL_ROUTED');
      case CONVERSATION_GOAL.SHOW_CURRENT_PLAN:
        return this.currentPlan(input);
      case CONVERSATION_GOAL.SHOW_PLAN_STATUS:
        return this.planStatus(input);
      case CONVERSATION_GOAL.GENERAL_GUIDANCE:
        return this.guidance(input);
      case CONVERSATION_GOAL.UNKNOWN:
        return this.fallback(input, 'UNKNOWN_GOAL');
    }
  }

  private profileAcquisition(
    input: ConversationExecutionRouterInput,
  ): ConversationExecutionRoute {
    if (
      !input.goalDecision.selectedProfileField ||
      !input.goalDecision.targetPlan
    ) {
      return this.fallback(input, 'GOAL_NOT_EXECUTABLE');
    }
    return Object.freeze({
      ...this.envelope(input),
      kind: 'PROFILE_ACQUISITION',
      targetPlan: input.goalDecision.targetPlan,
      selectedProfileField: input.goalDecision.selectedProfileField,
    });
  }

  private nutritionUpdate(
    input: ConversationExecutionRouterInput,
  ): ConversationExecutionRoute {
    if (!this.hasUpdateContext(input, 'DIET')) {
      return this.confirmation(input, 'MISSING_UPDATE_CONTEXT');
    }
    return Object.freeze({
      ...this.envelope(input),
      kind: 'NUTRITION_PLAN_UPDATE',
      targetPlan: 'DIET',
      artifactType: this.nutritionArtifact(input),
      references: this.references(input),
    });
  }

  private workoutUpdate(
    input: ConversationExecutionRouterInput,
  ): ConversationExecutionRoute {
    if (!this.hasUpdateContext(input, 'WORKOUT')) {
      return this.confirmation(input, 'MISSING_UPDATE_CONTEXT');
    }
    return Object.freeze({
      ...this.envelope(input),
      kind: 'WORKOUT_PLAN_UPDATE',
      targetPlan: 'WORKOUT',
      artifactType: this.workoutArtifact(input),
      modality: this.workoutModality(input),
      references: this.references(input),
    });
  }

  private currentPlan(
    input: ConversationExecutionRouterInput,
  ): ConversationExecutionRoute {
    if (!input.goalDecision.targetPlan) {
      return this.confirmation(input, 'MISSING_TARGET_PLAN');
    }
    return Object.freeze({
      ...this.envelope(input),
      kind: 'CURRENT_PLAN_PRESENTATION',
      targetPlan: input.goalDecision.targetPlan,
      references: this.references(input),
    });
  }

  private planStatus(
    input: ConversationExecutionRouterInput,
  ): ConversationExecutionRoute {
    if (!input.goalDecision.targetPlan) {
      return this.confirmation(input, 'MISSING_TARGET_PLAN');
    }
    return Object.freeze({
      ...this.envelope(input),
      kind: 'PLAN_STATUS',
      targetPlan: input.goalDecision.targetPlan,
    });
  }

  private guidance(
    input: ConversationExecutionRouterInput,
  ): ConversationExecutionRoute {
    if (input.understanding.domain === 'NUTRITION') {
      return Object.freeze({
        ...this.envelope(input),
        kind: 'NUTRITION_GUIDANCE',
        operation: input.understanding.operation,
        artifactType: this.nutritionArtifact(input),
        references: this.references(input),
      });
    }
    if (input.understanding.domain === 'GENERAL') {
      return Object.freeze({
        ...this.envelope(input),
        kind: 'ANSWER_MESSAGE',
        operation: input.understanding.operation,
      });
    }
    return this.fallback(input, 'UNSUPPORTED_GUIDANCE_DOMAIN');
  }

  private confirmation(
    input: ConversationExecutionRouterInput,
    reason: ConversationExecutionRouteReason,
  ): ConversationExecutionRoute {
    return Object.freeze({
      ...this.envelope(input, reason),
      kind: 'CONFIRMATION',
      targetPlan: input.goalDecision.targetPlan,
      references: this.references(input),
    });
  }

  private fallback(
    input: ConversationExecutionRouterInput,
    fallbackReason: Exclude<
      ConversationExecutionRouteReason,
      'PLANNER_GOAL_ROUTED' | 'SAFETY_PRECEDENCE'
    >,
  ): ConversationExecutionRoute {
    return Object.freeze({
      ...this.envelope(input, fallbackReason),
      kind: 'LEGACY_FALLBACK',
      fallbackReason,
    });
  }

  private envelope(
    input: ConversationExecutionRouterInput,
    reason: ConversationExecutionRouteReason = 'PLANNER_GOAL_ROUTED',
  ) {
    return Object.freeze({
      routerVersion: CONVERSATION_EXECUTION_ROUTER_VERSION,
      goalDecision: input.goalDecision,
      reasonCodes: Object.freeze([reason]),
      canExecute: input.goalDecision.canExecute,
      missingPreconditions: Object.freeze([
        ...input.goalDecision.missingPreconditions,
      ]),
    });
  }

  private hasUpdateContext(
    input: ConversationExecutionRouterInput,
    targetPlan: 'DIET' | 'WORKOUT',
  ): boolean {
    const expectedDomain = targetPlan === 'DIET' ? 'NUTRITION' : 'WORKOUT';
    return (
      input.understanding.references.some(
        (reference) =>
          reference.kind === 'PLAN' &&
          reference.resolution === 'RESOLVED' &&
          (reference.domain === expectedDomain || reference.domain === 'BOTH'),
      ) ||
      input.goalDecision.metPreconditions.some(
        (precondition) =>
          precondition.kind === 'CURRENT_PLAN_AVAILABLE' &&
          precondition.plan === targetPlan,
      )
    );
  }

  private references(
    input: ConversationExecutionRouterInput,
  ): readonly ConversationReference[] {
    return Object.freeze([...input.understanding.references]);
  }

  private nutritionArtifact(
    input: ConversationExecutionRouterInput,
  ): NutritionArtifactType | null {
    return (
      input.understanding.entities.find(
        (entity) => entity.kind === 'NUTRITION_ARTIFACT',
      )?.value ?? null
    );
  }

  private workoutArtifact(
    input: ConversationExecutionRouterInput,
  ): WorkoutArtifactType | null {
    return (
      input.understanding.entities.find(
        (entity) => entity.kind === 'WORKOUT_ARTIFACT',
      )?.value ?? null
    );
  }

  private workoutModality(
    input: ConversationExecutionRouterInput,
  ): WorkoutModality | null {
    return (
      input.understanding.entities.find(
        (entity) => entity.kind === 'WORKOUT_MODALITY',
      )?.value ?? null
    );
  }
}
