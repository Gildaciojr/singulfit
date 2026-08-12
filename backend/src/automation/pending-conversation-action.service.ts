import { Injectable } from '@nestjs/common';
import {
  FitnessGoal,
  PendingConversationActionStatus,
  PendingConversationActionType,
  Prisma,
  UserGoalType,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import type { CoachCommandIntent } from './coach-command.service';
import {
  CurrentGoalCommitService,
  CurrentGoalPersistenceError,
} from './current-goal-commit.service';
import {
  GOAL_CONFIRMATION_ALLOWED_GOALS,
  type GoalConfirmationPayload,
  type PendingGoalConfirmationContext,
  type PendingGoalConsumptionResult,
  type PendingGoalCompletionResult,
  type PendingGoalExecutionClaimResult,
  type PendingGoalExecutionReleaseResult,
  type PendingInboundResolution,
} from './pending-conversation-action.contract';
import type { PlanningExecutionRouteSelection } from './planning-execution-route-policy.service';
import { UserGoalEngineService } from './user-goal-engine.service';

const GOAL_CONFIRMATION_TTL_MS = 24 * 60 * 60 * 1_000;
const GOAL_CONTINUATION_LEASE_MS = 5 * 60 * 1_000;

export interface CreateGoalConfirmationInput {
  readonly userId: string;
  readonly conversationId: string;
  readonly sourceMessageId: string;
  readonly originalIntent: CoachCommandIntent;
  readonly originalMessage: string;
  readonly referenceDate: Date;
  readonly declaredOutcome: string | null;
}

export interface FindPendingForInboundInput {
  readonly userId: string;
  readonly conversationId: string;
  readonly messageId: string;
  readonly text: string;
  readonly receivedAt: Date;
}

export interface ConsumeGoalConfirmationInput {
  readonly userId: string;
  readonly conversationId: string;
  readonly consumerMessageId: string;
  readonly referenceDate: Date;
  readonly context: PendingGoalConfirmationContext;
  readonly routeSelection: PlanningExecutionRouteSelection;
}

@Injectable()
export class PendingConversationActionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly goalEngine: UserGoalEngineService,
    private readonly goalCommit: CurrentGoalCommitService,
  ) {}

  async createGoalConfirmation(
    input: CreateGoalConfirmationInput,
  ): Promise<PendingGoalConfirmationContext> {
    const operationKey = `pending-goal-confirmation:${input.sourceMessageId}`;
    const payload = this.buildPayload(input);

    return this.prisma.$transaction(async (transaction) => {
      await this.acquireLock(transaction, input);
      const replay = await transaction.pendingConversationAction.findUnique({
        where: { operationKey },
      });
      if (replay) return this.context(replay.id, replay.operationKey, payload);

      const active = await transaction.pendingConversationAction.findFirst({
        where: {
          userId: input.userId,
          conversationId: input.conversationId,
          type: PendingConversationActionType.GOAL_CONFIRMATION,
          status: {
            in: [
              PendingConversationActionStatus.AWAITING_PROMPT,
              PendingConversationActionStatus.PENDING,
              PendingConversationActionStatus.CONSUMED_PENDING_EXECUTION,
              PendingConversationActionStatus.EXECUTING,
            ],
          },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      if (active) {
        if (
          active.status ===
            PendingConversationActionStatus.CONSUMED_PENDING_EXECUTION ||
          active.status === PendingConversationActionStatus.EXECUTING
        ) {
          throw new Error('PENDING_GOAL_CONTINUATION_IN_PROGRESS');
        }
        const activePayload = this.parsePayload(active.payload);
        const activeReferenceDate = new Date(
          activePayload.originalReferenceDate,
        );
        if (activeReferenceDate >= input.referenceDate) {
          return this.context(active.id, active.operationKey, activePayload);
        }
        await transaction.pendingConversationAction.update({
          where: { id: active.id },
          data: { status: PendingConversationActionStatus.CANCELLED },
        });
      }

      const created = await transaction.pendingConversationAction.create({
        data: {
          userId: input.userId,
          conversationId: input.conversationId,
          type: PendingConversationActionType.GOAL_CONFIRMATION,
          status: PendingConversationActionStatus.AWAITING_PROMPT,
          sourceMessageId: input.sourceMessageId,
          originalIntent: input.originalIntent,
          payload: this.jsonPayload(payload),
          operationKey,
          expiresAt: new Date(
            input.referenceDate.getTime() + GOAL_CONFIRMATION_TTL_MS,
          ),
        },
      });
      return this.context(created.id, created.operationKey, payload);
    });
  }

  async activateGoalConfirmationForSource(input: {
    readonly userId: string;
    readonly conversationId: string;
    readonly sourceMessageId: string;
    readonly activatedAt: Date;
  }): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await this.acquireLock(transaction, input);
      await transaction.pendingConversationAction.updateMany({
        where: {
          userId: input.userId,
          conversationId: input.conversationId,
          sourceMessageId: input.sourceMessageId,
          type: PendingConversationActionType.GOAL_CONFIRMATION,
          status: PendingConversationActionStatus.AWAITING_PROMPT,
        },
        data: {
          status: PendingConversationActionStatus.PENDING,
          promptActivatedAt: input.activatedAt,
        },
      });
    });
  }

  async findPendingForInbound(
    input: FindPendingForInboundInput,
  ): Promise<PendingInboundResolution> {
    return this.prisma.$transaction(async (transaction) => {
      await this.acquireLock(transaction, input);
      const action = await transaction.pendingConversationAction.findFirst({
        where: {
          userId: input.userId,
          conversationId: input.conversationId,
          type: PendingConversationActionType.GOAL_CONFIRMATION,
        },
        include: { sourceMessage: { select: { timestamp: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      if (!action) return Object.freeze({ status: 'NONE' as const });
      if (action.status === PendingConversationActionStatus.COMPLETED) {
        if (
          action.consumerMessageId === input.messageId &&
          action.resultContent
        ) {
          return Object.freeze({
            status: 'COMPLETED' as const,
            intent: action.originalIntent,
            content: action.resultContent,
          });
        }
        return Object.freeze({ status: 'NONE' as const });
      }
      if (
        action.status === PendingConversationActionStatus.EXECUTING ||
        action.status ===
          PendingConversationActionStatus.CONSUMED_PENDING_EXECUTION
      ) {
        if (action.consumerMessageId !== input.messageId) {
          return Object.freeze({ status: 'NONE' as const });
        }
        const payload = this.parsePayload(action.payload);
        return Object.freeze({
          status: 'ACTIONABLE' as const,
          context: this.resolvedContinuationContext(
            action.id,
            action.operationKey,
            action.originalIntent,
            payload,
          ),
        });
      }
      if (action.status === PendingConversationActionStatus.AWAITING_PROMPT) {
        return Object.freeze({ status: 'NONE' as const });
      }
      if (action.status !== PendingConversationActionStatus.PENDING) {
        return Object.freeze({ status: 'NONE' as const });
      }
      if (action.expiresAt <= input.receivedAt) {
        await transaction.pendingConversationAction.updateMany({
          where: {
            id: action.id,
            status: PendingConversationActionStatus.PENDING,
          },
          data: { status: PendingConversationActionStatus.EXPIRED },
        });
        return Object.freeze({ status: 'EXPIRED' as const });
      }
      if (action.sourceMessage.timestamp >= input.receivedAt) {
        return Object.freeze({ status: 'UNRELATED' as const });
      }

      const payload = this.parsePayload(action.payload);
      const resolution = this.resolveGoalConfirmationResponse(
        input.text,
        payload,
      );
      if (resolution.status === 'NO_CHANGE') {
        return Object.freeze({ status: 'UNRELATED' as const });
      }
      if (
        resolution.status === 'RESOLVED' &&
        !payload.allowedGoals.includes(resolution.primaryGoal)
      ) {
        return Object.freeze({ status: 'UNRELATED' as const });
      }
      return Object.freeze({
        status: 'ACTIONABLE' as const,
        context: Object.freeze({
          actionId: action.id,
          operationKey: action.operationKey,
          originalIntent: action.originalIntent,
          payload,
          resolution,
          continuation: false,
        }),
      });
    });
  }

  async consumeGoalConfirmation(
    input: ConsumeGoalConfirmationInput,
  ): Promise<PendingGoalConsumptionResult> {
    const resolvedGoal = input.context.resolution;
    if (resolvedGoal.status !== 'RESOLVED') {
      throw new Error('PENDING_GOAL_CONFIRMATION_NOT_RESOLVED');
    }

    try {
      return await this.prisma.$transaction(async (transaction) => {
        await this.acquireLock(transaction, input);
        const action = await transaction.pendingConversationAction.findUnique({
          where: { id: input.context.actionId },
          include: { sourceMessage: { select: { timestamp: true } } },
        });
        if (
          !action ||
          action.userId !== input.userId ||
          action.conversationId !== input.conversationId
        ) {
          return 'ALREADY_CONSUMED' as const;
        }
        if (
          action.status ===
            PendingConversationActionStatus.CONSUMED_PENDING_EXECUTION ||
          action.status === PendingConversationActionStatus.EXECUTING
        ) {
          return action.consumerMessageId === input.consumerMessageId
            ? ('CONTINUE' as const)
            : ('ALREADY_CONSUMED' as const);
        }
        if (action.status === PendingConversationActionStatus.COMPLETED) {
          return 'REPLAY' as const;
        }
        if (action.status !== PendingConversationActionStatus.PENDING) {
          return action.status === PendingConversationActionStatus.EXPIRED
            ? ('EXPIRED' as const)
            : ('STALE' as const);
        }
        if (action.expiresAt <= input.referenceDate) {
          await transaction.pendingConversationAction.update({
            where: { id: action.id },
            data: { status: PendingConversationActionStatus.EXPIRED },
          });
          return 'EXPIRED' as const;
        }
        if (action.sourceMessage.timestamp >= input.referenceDate) {
          return 'STALE' as const;
        }

        await this.goalCommit.acquireLock(transaction, input.userId);
        const goalResult = await this.goalCommit.commitInTransaction(
          transaction,
          {
            userId: input.userId,
            operationKey: input.consumerMessageId,
            referenceDate: input.referenceDate,
            resolution: input.context.resolution,
          },
        );
        if (goalResult === 'STALE') {
          await transaction.pendingConversationAction.update({
            where: { id: action.id },
            data: { status: PendingConversationActionStatus.CANCELLED },
          });
          return 'STALE' as const;
        }
        if (goalResult === 'NOT_APPLICABLE') {
          throw new Error('PENDING_GOAL_CONFIRMATION_COMMIT_NOT_APPLICABLE');
        }

        await transaction.pendingConversationAction.update({
          where: { id: action.id },
          data: {
            status: PendingConversationActionStatus.CONSUMED_PENDING_EXECUTION,
            consumerMessageId: input.consumerMessageId,
            consumedAt: input.referenceDate,
            payload: this.jsonPayload({
              ...this.parsePayload(action.payload),
              resolvedGoal: resolvedGoal.primaryGoal,
              selectedRoute: input.routeSelection,
            }),
          },
        });
        return goalResult === 'REPLAY'
          ? ('REPLAY' as const)
          : ('APPLIED' as const);
      });
    } catch (error: unknown) {
      throw new CurrentGoalPersistenceError(error);
    }
  }

  async completeGoalConfirmation(input: {
    readonly userId: string;
    readonly conversationId: string;
    readonly actionId: string;
    readonly consumerMessageId: string;
    readonly content: string;
    readonly completedAt: Date;
    readonly claimToken: string;
  }): Promise<PendingGoalCompletionResult> {
    return this.prisma.$transaction(async (transaction) => {
      await this.acquireLock(transaction, input);
      const action = await transaction.pendingConversationAction.findUnique({
        where: { id: input.actionId },
      });
      if (
        !action ||
        action.userId !== input.userId ||
        action.conversationId !== input.conversationId ||
        action.consumerMessageId !== input.consumerMessageId
      ) {
        return Object.freeze({ status: 'FENCED' as const });
      }
      if (action.status === PendingConversationActionStatus.COMPLETED) {
        return Object.freeze({ status: 'FENCED' as const });
      }
      if (
        action.status !== PendingConversationActionStatus.EXECUTING ||
        action.executionClaimToken !== input.claimToken ||
        !action.executionLeaseExpiresAt ||
        input.completedAt <
          new Date(
            action.executionLeaseExpiresAt.getTime() -
              GOAL_CONTINUATION_LEASE_MS,
          ) ||
        action.executionLeaseExpiresAt <= input.completedAt
      ) {
        return Object.freeze({ status: 'FENCED' as const });
      }
      const completed = await transaction.pendingConversationAction.update({
        where: { id: action.id },
        data: {
          status: PendingConversationActionStatus.COMPLETED,
          completedAt: input.completedAt,
          resultContent: input.content,
          executionLeaseExpiresAt: null,
          executionClaimToken: null,
        },
      });
      return Object.freeze({
        status: 'COMPLETED' as const,
        content: completed.resultContent ?? input.content,
      });
    });
  }

  async claimGoalContinuationExecution(input: {
    readonly userId: string;
    readonly conversationId: string;
    readonly actionId: string;
    readonly consumerMessageId: string;
    readonly claimedAt: Date;
  }): Promise<PendingGoalExecutionClaimResult> {
    return this.prisma.$transaction(async (transaction) => {
      await this.acquireLock(transaction, input);
      const action = await transaction.pendingConversationAction.findUnique({
        where: { id: input.actionId },
      });
      if (
        !action ||
        action.userId !== input.userId ||
        action.conversationId !== input.conversationId ||
        action.consumerMessageId !== input.consumerMessageId
      ) {
        return Object.freeze({ status: 'IN_PROGRESS' as const });
      }
      if (action.status === PendingConversationActionStatus.COMPLETED) {
        return Object.freeze({ status: 'COMPLETED' as const });
      }
      if (
        action.status === PendingConversationActionStatus.EXECUTING &&
        action.executionLeaseExpiresAt &&
        action.executionLeaseExpiresAt > input.claimedAt
      ) {
        return Object.freeze({ status: 'IN_PROGRESS' as const });
      }
      if (
        action.status !==
          PendingConversationActionStatus.CONSUMED_PENDING_EXECUTION &&
        action.status !== PendingConversationActionStatus.EXECUTING
      ) {
        return Object.freeze({ status: 'IN_PROGRESS' as const });
      }
      const claimToken = randomUUID();
      await transaction.pendingConversationAction.update({
        where: { id: action.id },
        data: {
          status: PendingConversationActionStatus.EXECUTING,
          executionLeaseExpiresAt: new Date(
            input.claimedAt.getTime() + GOAL_CONTINUATION_LEASE_MS,
          ),
          executionClaimToken: claimToken,
        },
      });
      return Object.freeze({ status: 'CLAIMED' as const, claimToken });
    });
  }

  async releaseGoalContinuationExecution(input: {
    readonly userId: string;
    readonly conversationId: string;
    readonly actionId: string;
    readonly consumerMessageId: string;
    readonly claimToken: string;
  }): Promise<PendingGoalExecutionReleaseResult> {
    return this.prisma.$transaction(async (transaction) => {
      await this.acquireLock(transaction, input);
      const action = await transaction.pendingConversationAction.findUnique({
        where: { id: input.actionId },
      });
      if (
        !action ||
        action.userId !== input.userId ||
        action.conversationId !== input.conversationId ||
        action.consumerMessageId !== input.consumerMessageId ||
        action.executionClaimToken !== input.claimToken
      ) {
        return 'FENCED';
      }
      if (action.status !== PendingConversationActionStatus.EXECUTING) {
        return 'FENCED';
      }
      await transaction.pendingConversationAction.update({
        where: { id: action.id },
        data: {
          status: PendingConversationActionStatus.CONSUMED_PENDING_EXECUTION,
          executionLeaseExpiresAt: null,
          executionClaimToken: null,
        },
      });
      return 'RELEASED';
    });
  }

  private async acquireLock(
    transaction: Prisma.TransactionClient,
    input: { readonly userId: string; readonly conversationId: string },
  ): Promise<void> {
    const lockKey = `pending-conversation-action:${input.userId}:${input.conversationId}:GOAL_CONFIRMATION`;
    await transaction.$queryRaw`
      WITH advisory_lock AS (
        SELECT pg_advisory_xact_lock(hashtext(${lockKey}))
      )
      SELECT true AS "locked"
      FROM advisory_lock
    `;
  }

  private buildPayload(
    input: CreateGoalConfirmationInput,
  ): GoalConfirmationPayload {
    return Object.freeze({
      schemaVersion: 1 as const,
      declaredOutcome: input.declaredOutcome,
      allowedGoals: GOAL_CONFIRMATION_ALLOWED_GOALS,
      originalIntent: input.originalIntent,
      targetPlan:
        input.originalIntent === 'UNKNOWN' ? null : input.originalIntent,
      originalMessage: input.originalMessage,
      originalReferenceDate: input.referenceDate.toISOString(),
      desiredMealCount: this.desiredMealCount(input.originalMessage),
      resolvedGoal: null,
      selectedRoute: null,
    });
  }

  private context(
    actionId: string,
    operationKey: string,
    payload: GoalConfirmationPayload,
  ): PendingGoalConfirmationContext {
    return Object.freeze({
      actionId,
      operationKey,
      originalIntent: payload.originalIntent,
      payload,
      continuation: false,
      resolution: Object.freeze({
        status: 'REQUIRES_CONFIRMATION' as const,
        reason: 'PENDING_GOAL_CONFIRMATION',
        composite: true,
        declaredOutcome: payload.declaredOutcome,
      }),
    });
  }

  private jsonPayload(
    payload: GoalConfirmationPayload,
  ): Prisma.InputJsonObject {
    return {
      schemaVersion: payload.schemaVersion,
      declaredOutcome: payload.declaredOutcome,
      allowedGoals: [...payload.allowedGoals],
      originalIntent: payload.originalIntent,
      targetPlan: payload.targetPlan,
      originalMessage: payload.originalMessage,
      originalReferenceDate: payload.originalReferenceDate,
      desiredMealCount: payload.desiredMealCount,
      resolvedGoal: payload.resolvedGoal,
      selectedRoute: payload.selectedRoute
        ? this.jsonRoute(payload.selectedRoute)
        : null,
    };
  }

  private parsePayload(value: Prisma.JsonValue): GoalConfirmationPayload {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('PENDING_GOAL_CONFIRMATION_INVALID_PAYLOAD');
    }
    const schemaVersion = Reflect.get(value, 'schemaVersion');
    const declaredOutcome = Reflect.get(value, 'declaredOutcome');
    const allowedGoals = Reflect.get(value, 'allowedGoals');
    const originalIntent = Reflect.get(value, 'originalIntent');
    const targetPlan = Reflect.get(value, 'targetPlan');
    const originalMessage = Reflect.get(value, 'originalMessage');
    const originalReferenceDate = Reflect.get(value, 'originalReferenceDate');
    const desiredMealCount = Reflect.get(value, 'desiredMealCount');
    const resolvedGoal = Reflect.get(value, 'resolvedGoal');
    const selectedRoute = Reflect.get(value, 'selectedRoute');
    if (
      schemaVersion !== 1 ||
      (declaredOutcome !== null && typeof declaredOutcome !== 'string') ||
      !Array.isArray(allowedGoals) ||
      !GOAL_CONFIRMATION_ALLOWED_GOALS.every((goal) =>
        allowedGoals.includes(goal),
      ) ||
      !this.isIntent(originalIntent) ||
      !this.isTargetPlan(targetPlan) ||
      typeof originalMessage !== 'string' ||
      typeof originalReferenceDate !== 'string' ||
      Number.isNaN(new Date(originalReferenceDate).getTime()) ||
      (desiredMealCount !== null &&
        (typeof desiredMealCount !== 'number' ||
          !Number.isInteger(desiredMealCount))) ||
      !this.isFitnessGoalOrNull(resolvedGoal) ||
      !this.isRouteSelectionOrNull(selectedRoute)
    ) {
      throw new Error('PENDING_GOAL_CONFIRMATION_INVALID_PAYLOAD');
    }
    return Object.freeze({
      schemaVersion: 1 as const,
      declaredOutcome,
      allowedGoals: GOAL_CONFIRMATION_ALLOWED_GOALS,
      originalIntent,
      targetPlan,
      originalMessage,
      originalReferenceDate,
      desiredMealCount,
      resolvedGoal,
      selectedRoute,
    });
  }

  private resolvedContinuationContext(
    actionId: string,
    operationKey: string,
    originalIntent: CoachCommandIntent,
    payload: GoalConfirmationPayload,
  ): PendingGoalConfirmationContext {
    if (!payload.resolvedGoal || !payload.selectedRoute) {
      throw new Error('PENDING_GOAL_CONTINUATION_INVALID_PAYLOAD');
    }
    const classificationGoal =
      payload.resolvedGoal === FitnessGoal.MUSCLE_GAIN
        ? UserGoalType.HYPERTROPHY
        : payload.resolvedGoal === FitnessGoal.WEIGHT_LOSS
          ? UserGoalType.WEIGHT_LOSS
          : UserGoalType.MAINTENANCE;
    return Object.freeze({
      actionId,
      operationKey,
      originalIntent,
      payload,
      continuation: true,
      resolution: Object.freeze({
        status: 'RESOLVED' as const,
        reason: 'EXPLICIT_CURRENT_GOAL' as const,
        primaryGoal: payload.resolvedGoal,
        classificationGoal,
        confidence: 0.98,
        declaredOutcome: this.goalOutcome(payload.resolvedGoal),
      }),
    });
  }

  private resolveGoalConfirmationResponse(
    text: string,
    payload: GoalConfirmationPayload,
  ) {
    const resolution = this.goalEngine.resolveCurrentMessage(text);
    if (resolution.status !== 'NO_CHANGE') return resolution;
    const contextualGoal = this.contextualGoalConfirmation(text);
    if (!contextualGoal || !payload.allowedGoals.includes(contextualGoal)) {
      return resolution;
    }
    if (contextualGoal === FitnessGoal.WEIGHT_LOSS) {
      return Object.freeze({
        status: 'RESOLVED' as const,
        reason: 'EXPLICIT_CURRENT_GOAL' as const,
        primaryGoal: contextualGoal,
        classificationGoal: UserGoalType.WEIGHT_LOSS,
        confidence: 0.98,
        declaredOutcome: 'emagrecimento',
      });
    }
    if (contextualGoal === FitnessGoal.MUSCLE_GAIN) {
      return Object.freeze({
        status: 'RESOLVED' as const,
        reason: 'EXPLICIT_CURRENT_GOAL' as const,
        primaryGoal: contextualGoal,
        classificationGoal: UserGoalType.HYPERTROPHY,
        confidence: 0.98,
        declaredOutcome: 'ganho de massa muscular',
      });
    }
    return Object.freeze({
      status: 'RESOLVED' as const,
      reason: 'EXPLICIT_CURRENT_GOAL' as const,
      primaryGoal: contextualGoal,
      classificationGoal: UserGoalType.MAINTENANCE,
      confidence: 0.98,
      declaredOutcome: 'manutenção',
    });
  }

  private contextualGoalConfirmation(text: string): FitnessGoal | null {
    switch (this.normalize(text)) {
      case 'emagrecer':
      case 'perder peso':
        return FitnessGoal.WEIGHT_LOSS;
      case 'ganhar massa':
      case 'ganhar massa muscular':
      case 'hipertrofia':
        return FitnessGoal.MUSCLE_GAIN;
      case 'manter':
      case 'quero manter':
        return FitnessGoal.MAINTENANCE;
      default:
        return null;
    }
  }

  private isFitnessGoalOrNull(value: unknown): value is FitnessGoal | null {
    return (
      value === null ||
      GOAL_CONFIRMATION_ALLOWED_GOALS.some((goal) => goal === value)
    );
  }

  private jsonRoute(
    route: PlanningExecutionRouteSelection,
  ): Prisma.InputJsonObject {
    return {
      nutrition: route.nutrition,
      workout: route.workout,
      reason: route.reason,
      nutritionPilotStatus: route.nutritionPilotStatus,
      suppressNutritionShadow: route.suppressNutritionShadow,
    };
  }

  private isRouteSelectionOrNull(
    value: unknown,
  ): value is PlanningExecutionRouteSelection | null {
    if (value === null) return true;
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return false;
    const nutrition = Reflect.get(value, 'nutrition');
    const workout = Reflect.get(value, 'workout');
    const reason = Reflect.get(value, 'reason');
    const nutritionPilotStatus = Reflect.get(value, 'nutritionPilotStatus');
    const suppressNutritionShadow = Reflect.get(
      value,
      'suppressNutritionShadow',
    );
    return (
      this.isRoute(nutrition) &&
      this.isRoute(workout) &&
      this.isRouteReason(reason) &&
      this.isPilotStatus(nutritionPilotStatus) &&
      typeof suppressNutritionShadow === 'boolean'
    );
  }

  private isRoute(value: unknown): value is 'LEGACY' | 'V2' | null {
    return value === null || value === 'LEGACY' || value === 'V2';
  }

  private isRouteReason(value: unknown): boolean {
    return (
      value === 'NUTRITION_V2_ELIGIBLE' ||
      value === 'NUTRITION_PILOT_NOT_ELIGIBLE' ||
      value === 'NO_WORKOUT_V2_PRODUCTION_ROLLOUT' ||
      value === 'CROSS_DOMAIN_ATOMICITY_PENDING' ||
      value === 'LEGACY_INTENT_OR_UNSUPPORTED_GOAL'
    );
  }

  private isPilotStatus(value: unknown): boolean {
    return (
      value === null ||
      value === 'ELIGIBLE' ||
      value === 'DISABLED' ||
      value === 'INVALID_CONFIG' ||
      value === 'NOT_AUTHORIZED' ||
      value === 'INELIGIBLE_OPERATION' ||
      value === 'MISSING_OWNERSHIP'
    );
  }

  private goalOutcome(goal: FitnessGoal): string {
    if (goal === FitnessGoal.WEIGHT_LOSS) return 'emagrecimento';
    if (goal === FitnessGoal.MUSCLE_GAIN) return 'ganho de massa muscular';
    return 'manutenção';
  }

  private normalize(value: string): string {
    return value
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLocaleLowerCase('pt-BR')
      .replace(/[^a-z0-9 ]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private isIntent(value: unknown): value is CoachCommandIntent {
    return (
      value === 'DIET' ||
      value === 'WORKOUT' ||
      value === 'BOTH' ||
      value === 'UNKNOWN'
    );
  }

  private isTargetPlan(
    value: unknown,
  ): value is 'DIET' | 'WORKOUT' | 'BOTH' | null {
    return (
      value === null ||
      value === 'DIET' ||
      value === 'WORKOUT' ||
      value === 'BOTH'
    );
  }

  private desiredMealCount(message: string): number | null {
    const normalized = message
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLocaleLowerCase('pt-BR');
    const match = /\b(\d{1,2})\s+(?:refeicoes|refeicao)\b/u.exec(normalized);
    if (!match?.[1]) return null;
    const count = Number.parseInt(match[1], 10);
    return count >= 1 && count <= 12 ? count : null;
  }
}
