import { Injectable } from '@nestjs/common';
import {
  PROFILE_ACQUISITION_FIELD,
  ProfileAcquisitionField,
  ProfileAcquisitionPlan,
  ProfileAcquisitionPlanReadiness,
} from './coach-adaptive-profile-collector.contract';
import {
  CONVERSATION_GOAL,
  CONVERSATION_RECOGNIZED_INTENT,
  ConversationGoal,
  ConversationGoalConfidence,
  ConversationGoalDecision,
  ConversationGoalHistoryEntry,
  ConversationGoalPlanTarget,
  ConversationGoalPlannerInput,
  ConversationGoalPrecondition,
  ConversationGoalReason,
} from './conversation-goal-planner.contract';

interface GoalDecisionDraft {
  readonly goal: ConversationGoal;
  readonly reason: ConversationGoalReason;
  readonly targetPlan: ConversationGoalPlanTarget | null;
  readonly canExecute: boolean;
  readonly confidence: ConversationGoalConfidence;
  readonly selectedProfileField?: ProfileAcquisitionField | null;
  readonly metPreconditions?: readonly ConversationGoalPrecondition[];
  readonly missingPreconditions?: readonly ConversationGoalPrecondition[];
}

@Injectable()
export class ConversationGoalPlannerService {
  plan(input: ConversationGoalPlannerInput): ConversationGoalDecision {
    this.validateHistory(input);
    const draft = this.resolve(input);
    const metPreconditions = this.freezePreconditions(
      draft.metPreconditions ?? [],
    );
    const missingPreconditions = this.freezePreconditions(
      draft.missingPreconditions ?? [],
    );

    return Object.freeze({
      recognizedIntent: input.recognizedIntent,
      goal: draft.goal,
      reason: draft.reason,
      targetPlan: draft.targetPlan,
      profileCompletionState: input.completion.overall,
      canExecute: draft.canExecute,
      confidence: draft.confidence,
      selectedProfileField: draft.selectedProfileField ?? null,
      metPreconditions,
      missingPreconditions,
      pendingDependencies: missingPreconditions,
    });
  }

  private resolve(input: ConversationGoalPlannerInput): GoalDecisionDraft {
    switch (input.recognizedIntent) {
      case CONVERSATION_RECOGNIZED_INTENT.COMMON_MESSAGE:
        return this.simple(
          CONVERSATION_GOAL.ANSWER_MESSAGE,
          'DIRECT_MESSAGE_RESPONSE',
        );
      case CONVERSATION_RECOGNIZED_INTENT.NUTRITION_QUESTION:
        return this.simple(
          CONVERSATION_GOAL.GENERAL_GUIDANCE,
          'NUTRITION_GUIDANCE_REQUESTED',
        );
      case CONVERSATION_RECOGNIZED_INTENT.GENERAL_GUIDANCE_REQUEST:
        return this.simple(
          CONVERSATION_GOAL.GENERAL_GUIDANCE,
          'GENERAL_GUIDANCE_REQUESTED',
        );
      case CONVERSATION_RECOGNIZED_INTENT.DIET_PLAN_REQUEST:
        return this.planGeneration(input, 'DIET');
      case CONVERSATION_RECOGNIZED_INTENT.WORKOUT_PLAN_REQUEST:
        return this.planGeneration(input, 'WORKOUT');
      case CONVERSATION_RECOGNIZED_INTENT.COMBINED_PLAN_REQUEST:
        return this.combinedPlanGeneration(input);
      case CONVERSATION_RECOGNIZED_INTENT.DIET_PLAN_UPDATE_REQUEST:
        return this.planUpdate(input, 'DIET');
      case CONVERSATION_RECOGNIZED_INTENT.WORKOUT_PLAN_UPDATE_REQUEST:
        return this.planUpdate(input, 'WORKOUT');
      case CONVERSATION_RECOGNIZED_INTENT.PROGRESS_REVIEW_REQUEST:
        return this.progressReview(input);
      case CONVERSATION_RECOGNIZED_INTENT.CONFIRMATION_REQUIRED:
        return this.confirmation(input);
      case CONVERSATION_RECOGNIZED_INTENT.CURRENT_PLAN_REQUEST:
        return this.currentPlan(input);
      case CONVERSATION_RECOGNIZED_INTENT.PLAN_STATUS_REQUEST:
        return this.simple(
          CONVERSATION_GOAL.SHOW_PLAN_STATUS,
          'PLAN_STATUS_REQUESTED',
          input.conversationContext.planTarget ?? null,
        );
      default:
        return {
          goal: CONVERSATION_GOAL.UNKNOWN,
          reason: 'INTENT_NOT_RECOGNIZED',
          targetPlan: null,
          canExecute: false,
          confidence: 'LOW',
        };
    }
  }

  private planGeneration(
    input: ConversationGoalPlannerInput,
    plan: ProfileAcquisitionPlan,
  ): GoalDecisionDraft {
    const readiness = this.readiness(input, plan);

    if (!readiness.ready)
      return this.profileAcquisition(input, plan, readiness);

    const goal =
      plan === 'DIET'
        ? CONVERSATION_GOAL.GENERATE_DIET_PLAN
        : CONVERSATION_GOAL.GENERATE_WORKOUT_PLAN;
    const pending = this.pendingGoal(input, goal);

    if (pending) return this.alreadyPending(goal, plan);

    return {
      goal,
      reason: plan === 'DIET' ? 'DIET_PROFILE_READY' : 'WORKOUT_PROFILE_READY',
      targetPlan: plan,
      canExecute: true,
      confidence: 'HIGH',
      metPreconditions: [
        this.planReady(plan),
        this.noPendingEquivalentGoal(goal),
      ],
    };
  }

  private combinedPlanGeneration(
    input: ConversationGoalPlannerInput,
  ): GoalDecisionDraft {
    const diet = this.readiness(input, 'DIET');
    const workout = this.readiness(input, 'WORKOUT');

    if (!diet.ready || !workout.ready) {
      return this.profileAcquisition(
        input,
        'BOTH',
        Object.freeze({
          plan: !diet.ready ? 'DIET' : 'WORKOUT',
          ready: false,
          blockingFields: Object.freeze([
            ...diet.blockingFields,
            ...workout.blockingFields.filter(
              (field) => !diet.blockingFields.includes(field),
            ),
          ]),
        }),
      );
    }

    const goal = CONVERSATION_GOAL.GENERATE_COMBINED_PLANS;
    if (this.pendingGoal(input, goal)) return this.alreadyPending(goal, 'BOTH');

    return {
      goal,
      reason: 'COMBINED_PROFILE_READY',
      targetPlan: 'BOTH',
      canExecute: true,
      confidence: 'HIGH',
      metPreconditions: [
        this.planReady('DIET'),
        this.planReady('WORKOUT'),
        this.noPendingEquivalentGoal(goal),
      ],
    };
  }

  private planUpdate(
    input: ConversationGoalPlannerInput,
    plan: ProfileAcquisitionPlan,
  ): GoalDecisionDraft {
    const readiness = this.readiness(input, plan);
    if (!readiness.ready)
      return this.profileAcquisition(input, plan, readiness);

    if (!this.currentPlanAvailable(input, plan)) {
      const generationGoal =
        plan === 'DIET'
          ? CONVERSATION_GOAL.GENERATE_DIET_PLAN
          : CONVERSATION_GOAL.GENERATE_WORKOUT_PLAN;

      if (this.pendingGoal(input, generationGoal)) {
        return this.alreadyPending(generationGoal, plan);
      }

      return {
        goal: generationGoal,
        reason:
          plan === 'DIET'
            ? 'DIET_PLAN_MISSING_GENERATION_REQUIRED'
            : 'WORKOUT_PLAN_MISSING_GENERATION_REQUIRED',
        targetPlan: plan,
        canExecute: true,
        confidence: 'HIGH',
        metPreconditions: [
          this.planReady(plan),
          this.noPendingEquivalentGoal(generationGoal),
        ],
        missingPreconditions: [this.currentPlanPrecondition(plan)],
      };
    }

    const goal =
      plan === 'DIET'
        ? CONVERSATION_GOAL.UPDATE_DIET_PLAN
        : CONVERSATION_GOAL.UPDATE_WORKOUT_PLAN;
    if (this.pendingGoal(input, goal)) return this.alreadyPending(goal, plan);

    return {
      goal,
      reason:
        plan === 'DIET'
          ? 'CURRENT_DIET_READY_FOR_UPDATE'
          : 'CURRENT_WORKOUT_READY_FOR_UPDATE',
      targetPlan: plan,
      canExecute: true,
      confidence: 'HIGH',
      metPreconditions: [
        this.planReady(plan),
        this.currentPlanPrecondition(plan),
        this.noPendingEquivalentGoal(goal),
      ],
    };
  }

  private profileAcquisition(
    input: ConversationGoalPlannerInput,
    target: ConversationGoalPlanTarget,
    readiness: ProfileAcquisitionPlanReadiness,
  ): GoalDecisionDraft {
    const selected = input.adaptiveDecision.selectedCandidate;
    const selectedApplies =
      selected !== null &&
      (target === 'BOTH'
        ? selected.blocksPlans.length > 0
        : selected.blocksPlans.includes(target));
    const selectedField = selectedApplies ? selected.field : null;
    const missing = readiness.blockingFields.map((field) =>
      this.profileField(field),
    );

    return {
      goal: CONVERSATION_GOAL.ASK_PROFILE_INFORMATION,
      reason: 'PROFILE_INFORMATION_REQUIRED',
      targetPlan: target,
      canExecute: selectedField !== null,
      confidence: selectedField !== null ? 'HIGH' : 'MEDIUM',
      selectedProfileField: selectedField,
      missingPreconditions: missing,
    };
  }

  private progressReview(
    input: ConversationGoalPlannerInput,
  ): GoalDecisionDraft {
    const progress = Object.freeze({
      kind: 'PROGRESS_CONTEXT_AVAILABLE' as const,
    });

    return {
      goal: CONVERSATION_GOAL.REVIEW_PROGRESS,
      reason: input.conversationContext.progressContextAvailable
        ? 'PROGRESS_REVIEW_REQUESTED'
        : 'PROGRESS_CONTEXT_MISSING',
      targetPlan: null,
      canExecute: input.conversationContext.progressContextAvailable,
      confidence: input.conversationContext.progressContextAvailable
        ? 'HIGH'
        : 'MEDIUM',
      metPreconditions: input.conversationContext.progressContextAvailable
        ? [progress]
        : [],
      missingPreconditions: input.conversationContext.progressContextAvailable
        ? []
        : [progress],
    };
  }

  private confirmation(input: ConversationGoalPlannerInput): GoalDecisionDraft {
    if (!input.conversationContext.confirmationRequired) {
      return {
        goal: CONVERSATION_GOAL.ANSWER_MESSAGE,
        reason: 'CONFIRMATION_NOT_PENDING',
        targetPlan: input.conversationContext.planTarget ?? null,
        canExecute: true,
        confidence: 'MEDIUM',
        missingPreconditions: [
          Object.freeze({ kind: 'CONFIRMATION_CONTEXT_AVAILABLE' }),
        ],
      };
    }

    return {
      goal: CONVERSATION_GOAL.REQUEST_CONFIRMATION,
      reason: 'CONFIRMATION_REQUIRED',
      targetPlan: input.conversationContext.planTarget ?? null,
      canExecute: true,
      confidence: 'HIGH',
      metPreconditions: [
        Object.freeze({ kind: 'CONFIRMATION_CONTEXT_AVAILABLE' }),
      ],
    };
  }

  private currentPlan(input: ConversationGoalPlannerInput): GoalDecisionDraft {
    const target = this.resolveCurrentPlanTarget(input);

    if (target === null) {
      const hasDiet = this.currentPlanAvailable(input, 'DIET');
      const hasWorkout = this.currentPlanAvailable(input, 'WORKOUT');

      if (!hasDiet && !hasWorkout) {
        return {
          goal: CONVERSATION_GOAL.SHOW_PLAN_STATUS,
          reason: 'CURRENT_PLAN_MISSING',
          targetPlan: null,
          canExecute: true,
          confidence: 'HIGH',
        };
      }

      return {
        goal: CONVERSATION_GOAL.REQUEST_CONFIRMATION,
        reason: 'PLAN_TARGET_REQUIRED',
        targetPlan: null,
        canExecute: true,
        confidence: 'HIGH',
        missingPreconditions: [
          Object.freeze({ kind: 'PLAN_TARGET_AVAILABLE' }),
        ],
      };
    }

    const plans = target === 'BOTH' ? (['DIET', 'WORKOUT'] as const) : [target];
    const available = plans.filter((plan) =>
      this.currentPlanAvailable(input, plan),
    );

    if (available.length !== plans.length) {
      return {
        goal: CONVERSATION_GOAL.SHOW_PLAN_STATUS,
        reason: 'CURRENT_PLAN_MISSING',
        targetPlan: target,
        canExecute: true,
        confidence: 'HIGH',
        metPreconditions: available.map((plan) =>
          this.currentPlanPrecondition(plan),
        ),
        missingPreconditions: plans
          .filter((plan) => !available.includes(plan))
          .map((plan) => this.currentPlanPrecondition(plan)),
      };
    }

    return {
      goal: CONVERSATION_GOAL.SHOW_CURRENT_PLAN,
      reason: 'CURRENT_PLAN_AVAILABLE',
      targetPlan: target,
      canExecute: true,
      confidence: 'HIGH',
      metPreconditions: plans.map((plan) => this.currentPlanPrecondition(plan)),
    };
  }

  private resolveCurrentPlanTarget(
    input: ConversationGoalPlannerInput,
  ): ConversationGoalPlanTarget | null {
    if (input.conversationContext.planTarget) {
      return input.conversationContext.planTarget;
    }

    const hasDiet = this.currentPlanAvailable(input, 'DIET');
    const hasWorkout = this.currentPlanAvailable(input, 'WORKOUT');
    if (hasDiet && !hasWorkout) return 'DIET';
    if (hasWorkout && !hasDiet) return 'WORKOUT';

    return null;
  }

  private readiness(
    input: ConversationGoalPlannerInput,
    plan: ProfileAcquisitionPlan,
  ): ProfileAcquisitionPlanReadiness {
    return (
      input.adaptiveDecision.readiness.find((item) => item.plan === plan) ??
      Object.freeze({
        plan,
        ready: false,
        blockingFields: Object.freeze([PROFILE_ACQUISITION_FIELD.PRIMARY_GOAL]),
      })
    );
  }

  private currentPlanAvailable(
    input: ConversationGoalPlannerInput,
    plan: ProfileAcquisitionPlan,
  ): boolean {
    const datum =
      plan === 'DIET'
        ? (input.snapshot.plans.currentNutritionPlan ??
          input.snapshot.plans.currentDiet)
        : input.snapshot.plans.currentWorkout;

    return 'value' in datum;
  }

  private pendingGoal(
    input: ConversationGoalPlannerInput,
    goal: ConversationGoal,
  ): boolean {
    const latest = input.recentHistory.entries
      .filter((entry) => entry.goal === goal)
      .reduce<ConversationGoalHistoryEntry | null>((current, entry) => {
        if (!current || entry.logicalTurn > current.logicalTurn) return entry;
        if (
          entry.logicalTurn === current.logicalTurn &&
          this.historyStatusOrder(entry.status) >
            this.historyStatusOrder(current.status)
        ) {
          return entry;
        }
        return current;
      }, null);

    return latest?.status === 'PLANNED' || latest?.status === 'EXECUTING';
  }

  private alreadyPending(
    goal: ConversationGoal,
    targetPlan: ConversationGoalPlanTarget,
  ): GoalDecisionDraft {
    return {
      goal: CONVERSATION_GOAL.SHOW_PLAN_STATUS,
      reason: 'EQUIVALENT_GOAL_ALREADY_PENDING',
      targetPlan,
      canExecute: true,
      confidence: 'HIGH',
      missingPreconditions: [this.noPendingEquivalentGoal(goal)],
    };
  }

  private simple(
    goal: ConversationGoal,
    reason: ConversationGoalReason,
    targetPlan: ConversationGoalPlanTarget | null = null,
  ): GoalDecisionDraft {
    return {
      goal,
      reason,
      targetPlan,
      canExecute: true,
      confidence: 'HIGH',
    };
  }

  private planReady(
    plan: ProfileAcquisitionPlan,
  ): ConversationGoalPrecondition {
    return Object.freeze({ kind: 'PLAN_PROFILE_READY', plan });
  }

  private profileField(
    field: ProfileAcquisitionField,
  ): ConversationGoalPrecondition {
    return Object.freeze({ kind: 'PROFILE_FIELD_AVAILABLE', field });
  }

  private currentPlanPrecondition(
    plan: ProfileAcquisitionPlan,
  ): ConversationGoalPrecondition {
    return Object.freeze({ kind: 'CURRENT_PLAN_AVAILABLE', plan });
  }

  private noPendingEquivalentGoal(
    goal: ConversationGoal,
  ): ConversationGoalPrecondition {
    return Object.freeze({ kind: 'NO_PENDING_EQUIVALENT_GOAL', goal });
  }

  private freezePreconditions(
    preconditions: readonly ConversationGoalPrecondition[],
  ): readonly ConversationGoalPrecondition[] {
    return Object.freeze(
      preconditions.map((precondition) => Object.freeze({ ...precondition })),
    );
  }

  private historyStatusOrder(
    status: ConversationGoalHistoryEntry['status'],
  ): number {
    switch (status) {
      case 'COMPLETED':
      case 'FAILED':
        return 3;
      case 'EXECUTING':
        return 2;
      default:
        return 1;
    }
  }

  private validateHistory(input: ConversationGoalPlannerInput): void {
    if (
      !Number.isInteger(input.recentHistory.currentLogicalTurn) ||
      input.recentHistory.currentLogicalTurn < 0
    ) {
      throw new Error('Turno lógico do Conversation Goal inválido');
    }

    for (const entry of input.recentHistory.entries) {
      if (
        !Number.isInteger(entry.logicalTurn) ||
        entry.logicalTurn < 0 ||
        entry.logicalTurn > input.recentHistory.currentLogicalTurn
      ) {
        throw new Error('Histórico lógico do Conversation Goal inválido');
      }
    }
  }
}
