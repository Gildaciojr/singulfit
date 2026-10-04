import { chunkWorkoutWhatsApp } from '../workout/v2/workout-whatsapp.chunker';
import { Injectable, Optional } from '@nestjs/common';
import { explicitPlanningIntent } from '../conversation/understanding/explicit-planning-intent';
import type { ConversationGoalDecision } from '../context/conversation-goal-planner.contract';
import { CoachPlanningExecutionService } from './coach-planning-execution.service';
import {
  CoachMessageType,
  Prisma,
  ScheduledMessageStatus,
} from '@prisma/client';
import { EventBusService } from '../event-bus/event-bus.service';
import { INTERNAL_EVENT } from '../event-bus/event-bus.constants';
import { PrismaService } from '../prisma/prisma.service';
import { AUTOMATION_RULE_CODES } from './automation.constants';
import { ConversationGoalShadowPipelineService } from './conversation-goal-shadow-pipeline.service';
import {
  ConversationRuntimeIntegrationService,
  type ConversationRuntimePreExecutionDecision,
} from '../conversation/runtime/conversation-runtime-integration.service';
import { CoachPlanningConversationResponseService } from './coach-planning-conversation-response.service';
import { isNutritionPlanningRealizerEligible } from './nutrition-planning-realizer-eligibility.policy';
import { PendingConversationActionService } from './pending-conversation-action.service';
import type {
  PendingGoalConfirmationContext,
  PendingInboundResolution,
} from './pending-conversation-action.contract';
import { ProfileAcquisitionInternalRolloutService } from '../context/profile-acquisition/profile-acquisition-internal-rollout.service';
import { isWorkoutCurrentPlanRead } from '../workout/v2/workout-current-plan-read.policy';
import { CurrentWorkoutPlanReaderService } from '../workout/v2/current-workout-plan-reader.service';
import { CONVERSATION_GOAL } from '../context/conversation-goal-planner.contract';
import { ConversationDailyQueryService } from '../conversation/runtime/conversation-daily-query.service';
import { ConversationProfileConsentService } from '../conversation/runtime/conversation-profile-consent.service';
import { ConversationContinuationService } from '../conversation/runtime/conversation-continuation.service';
import { continuationJson } from '../conversation/runtime/conversation-continuation.contract';
import {
  isIsolatedReminderReply,
  UNCORRELATED_REPLY,
} from '../conversation/understanding/daily-query.policy';

const WORKOUT_SESSION_SELECTION_ACTION = 'WORKOUT_SESSION_SELECTION';
const WORKOUT_SESSION_SELECTION_WINDOW_MS = 24 * 60 * 60 * 1_000;

export type CoachCommandIntent = 'DIET' | 'WORKOUT' | 'BOTH' | 'UNKNOWN';

export interface ProcessCoachCommandInput {
  readonly proactiveReply?: boolean;
  userId: string;
  messageId: string;
  planningContinuation?: Readonly<{
    originalRequestMessageId: string;
    intent: 'DIET' | 'WORKOUT' | 'BOTH';
  }>;
}

export interface ProcessCoachCommandResult {
  handled: boolean;
  duplicated: boolean;
  intent: CoachCommandIntent;
  reason?: string;
}

@Injectable()
export class CoachCommandService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly planningExecution: CoachPlanningExecutionService,
    private readonly eventBus: EventBusService,
    private readonly conversationGoalShadow: ConversationGoalShadowPipelineService,
    @Optional()
    private readonly conversationRuntime?: ConversationRuntimeIntegrationService,
    @Optional()
    private readonly planningConversationResponse?: CoachPlanningConversationResponseService,
    @Optional()
    private readonly pendingActions?: PendingConversationActionService,
    @Optional()
    private readonly profileAcquisitionRollout?: ProfileAcquisitionInternalRolloutService,
    @Optional()
    private readonly currentWorkoutPlanReader?: CurrentWorkoutPlanReaderService,
    @Optional()
    private readonly dailyQueries?: ConversationDailyQueryService,
    @Optional()
    private readonly profileConsent?: ConversationProfileConsentService,
    @Optional()
    private readonly continuations?: ConversationContinuationService,
  ) {}

  async processCanonicalContinuation(
    input: ProcessCoachCommandInput,
  ): Promise<boolean> {
    if (!this.continuations?.enabled(input.userId)) return false;
    const message = await this.continuations.source(
      input.userId,
      input.messageId,
      'TEXT',
    );
    if (!message) return false;
    const idempotencyKey = this.idempotencyKey(input.userId, input.messageId);
    const existing = await this.prisma.coachMessage.findUnique({
      where: { idempotencyKey },
    });
    // An already handled historical turn is not a new canonical response.
    if (
      existing &&
      (!this.isRecord(existing.context) ||
        existing.context.canonicalContinuation !== true)
    )
      return true;
    let reply = existing
      ? null
      : await this.continuations.resolve(input.userId, input.messageId);
    if (reply?.evidence.delegateRuntime) {
      const decision = await this.decideOfficialExecution({
        userId: input.userId,
        conversationId: message.conversationId,
        messageId: message.id,
        text: message.content,
        receivedAt: message.timestamp.toISOString(),
        replyToExternalMessageId: message.replyToExternalMessageId,
        legacyIntent: 'UNKNOWN',
      });
      reply = {
        ...reply,
        content:
          decision.source === 'CONVERSATION_RUNTIME' ||
          decision.source === 'SAFE_RESPONSE'
            ? decision.content
            : 'Não consegui continuar essa resposta com segurança. Pode me dizer a que você está se referindo?',
      };
    }
    if (!existing && !reply) return false;
    if (!this.continuations.enabled(input.userId)) return true;
    if (reply)
      reply = {
        ...reply,
        content: this.continuations.publicText(
          reply.content,
          reply.domain === 'WORKOUT',
        ),
      };
    const intent: CoachCommandIntent =
      reply?.domain === 'WORKOUT'
        ? 'WORKOUT'
        : reply?.domain === 'NUTRITION'
          ? 'DIET'
          : 'UNKNOWN';
    const selectionContext: Prisma.InputJsonObject = reply
      ? {
          continuation: continuationJson(reply.next),
          continuationEvidence: reply.evidence,
        }
      : this.isRecord(existing?.context)
        ? (existing.context as Prisma.InputJsonObject)
        : {};
    const queue = (
      row: { id: string; content: string; context: Prisma.JsonValue },
      transaction?: Prisma.TransactionClient,
    ) => {
      const stored = this.isRecord(row.context) ? row.context : {};
      const storedIntent = stored.canonicalIntent;
      return this.scheduleResponse(
        {
          userId: input.userId,
          conversationId: message.conversationId,
          messageId: message.id,
          coachMessageId: row.id,
          content: row.content,
          scheduledFor: this.scheduledFor(message.timestamp, message.id),
          intent:
            storedIntent === 'WORKOUT' || storedIntent === 'DIET'
              ? storedIntent
              : 'UNKNOWN',
          selectionContext: stored as Prisma.InputJsonObject,
        },
        transaction,
      );
    };
    const coach =
      existing ??
      (await this.prisma.$transaction(async (transaction) => {
        await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${idempotencyKey}))`;
        if (!this.continuations?.enabled(input.userId)) return null;
        const replay = await transaction.coachMessage.findUnique({
          where: { idempotencyKey },
        });
        if (replay) return replay;
        if (!reply || !this.continuations) return null;
        const claimed = await this.continuations.claim(
          transaction,
          input.userId,
          message.conversationId,
          message.id,
          reply,
          message.timestamp,
        );
        if (!this.continuations.enabled(input.userId))
          throw new Error('Continuation runtime disabled before coach commit');
        const persisted = await transaction.coachMessage.create({
          data: {
            userId: input.userId,
            type: CoachMessageType.FOLLOW_UP,
            idempotencyKey,
            content: claimed
              ? reply.content
              : this.continuations.publicText(
                  'Já recebi uma resposta à pergunta anterior. Pode me dizer a que você está se referindo agora?',
                ),
            context: claimed
              ? {
                  ...selectionContext,
                  canonicalIntent: intent,
                  canonicalContinuation: true,
                }
              : { canonicalIntent: 'UNKNOWN', canonicalContinuation: true },
            generatedAt: new Date(),
            scheduledFor: message.timestamp,
          },
        });
        // Consumption, coach, next durable scheduled response and outbox are atomic.
        // Recovery still exposes the next question only after its actual SENT state.
        await queue(persisted, transaction);
        if (!this.continuations.enabled(input.userId))
          throw new Error('Continuation runtime disabled before coach commit');
        return persisted;
      }));
    if (!coach) return true; // A concurrent turn owns this pending question.
    if (!this.continuations.enabled(input.userId)) return true;
    if (existing) await queue(coach);
    return true;
  }

  async processReadOnlyText(input: ProcessCoachCommandInput): Promise<boolean> {
    if (!this.dailyQueries) return false;
    const message = await this.prisma.message.findFirst({
      where: { id: input.messageId, conversation: { userId: input.userId } },
      select: { content: true },
    });
    if (
      !message ||
      !(
        this.dailyQueries.accepts(message.content) ||
        isWorkoutCurrentPlanRead(message.content)
      )
    )
      return false;
    await this.processTextMessage(input);
    return true;
  }

  async processUncorrelatedShortReply(
    input: ProcessCoachCommandInput,
  ): Promise<boolean> {
    if (!this.dailyQueries) return false;
    const message = await this.prisma.message.findFirst({
      where: { id: input.messageId, conversation: { userId: input.userId } },
      select: { content: true, replyToExternalMessageId: true },
    });
    // Quoted replies retain the existing acquisition correlation checks.
    if (
      !message ||
      message.replyToExternalMessageId ||
      !isIsolatedReminderReply(message.content)
    )
      return false;
    await this.processTextMessage(input);
    return true;
  }

  async shouldHandleBeforeProfileAcquisition(
    input: ProcessCoachCommandInput,
  ): Promise<boolean> {
    const message = await this.prisma.message.findFirst({
      where: {
        id: input.messageId,
        conversation: { userId: input.userId },
      },
      select: {
        id: true,
        content: true,
        timestamp: true,
        replyToExternalMessageId: true,
        conversationId: true,
      },
    });
    if (!message) return false;
    if (this.profileConsent?.accepts(message.content)) return true;
    if (
      await this.resolveWorkoutSessionContinuation({
        userId: input.userId,
        conversationId: message.conversationId,
        text: message.content,
        receivedAt: message.timestamp,
        replyToExternalMessageId: message.replyToExternalMessageId,
      })
    ) {
      return true;
    }
    if (!this.pendingActions || message.replyToExternalMessageId) return false;
    const pending = await this.pendingActions.findPendingForInbound({
      userId: input.userId,
      conversationId: message.conversationId,
      messageId: message.id,
      text: message.content,
      receivedAt: message.timestamp,
    });
    return (
      pending.status === 'ACTIONABLE' ||
      pending.status === 'ALREADY_CONSUMED' ||
      pending.status === 'COMPLETED'
    );
  }

  async processTextMessage(
    input: ProcessCoachCommandInput,
  ): Promise<ProcessCoachCommandResult> {
    const message = await this.prisma.message.findFirst({
      where: {
        id: input.messageId,
        conversation: {
          userId: input.userId,
        },
      },
      select: {
        id: true,
        content: true,
        timestamp: true,
        replyToExternalMessageId: true,
        conversation: {
          select: {
            id: true,
            user: {
              select: {
                onboardingCompleted: true,
                fitnessProfile: {
                  select: {
                    id: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!message) {
      return {
        handled: false,
        duplicated: false,
        intent: 'UNKNOWN',
        reason: 'TEXT_MESSAGE_NOT_FOUND',
      };
    }
    if (
      !input.planningContinuation &&
      this.continuations?.enabled(input.userId) &&
      isWorkoutCurrentPlanRead(message.content) &&
      (await this.processCanonicalContinuation(input))
    )
      return { handled: true, duplicated: false, intent: 'WORKOUT' };
    const planningOriginal = input.planningContinuation
      ? await this.prisma.message.findFirst({
          where: {
            id: input.planningContinuation.originalRequestMessageId,
            conversation: { userId: input.userId },
          },
          select: { content: true },
        })
      : null;
    const workoutContinuation = planningOriginal
      ? null
      : await this.resolveWorkoutSessionContinuation({
          userId: input.userId,
          conversationId: message.conversation.id,
          text: message.content,
          receivedAt: message.timestamp,
          replyToExternalMessageId: message.replyToExternalMessageId,
        });
    const commandText =
      planningOriginal?.content ??
      (workoutContinuation
        ? `sessão ${workoutContinuation.sequence}`
        : message.content);

    if (
      !message.conversation.user.onboardingCompleted &&
      !(
        this.dailyQueries?.accepts(commandText) ||
        isWorkoutCurrentPlanRead(commandText)
      )
    ) {
      return {
        handled: false,
        duplicated: false,
        intent: 'UNKNOWN',
        reason: 'ONBOARDING_NOT_COMPLETED',
      };
    }

    const pending = await this.resolvePending({
      userId: input.userId,
      conversationId: message.conversation.id,
      messageId: message.id,
      text: message.content,
      receivedAt: message.timestamp,
    });
    let intent =
      pending.status === 'ACTIONABLE'
        ? pending.context.originalIntent
        : pending.status === 'COMPLETED'
          ? pending.intent
          : pending.status === 'ALREADY_CONSUMED'
            ? pending.intent
            : input.planningContinuation
              ? input.planningContinuation.intent
              : workoutContinuation
                ? 'WORKOUT'
                : this.classify(commandText);

    const selectionContext = await this.workoutSelectionContext(
      input.userId,
      commandText,
    );
    const idempotencyKey = this.idempotencyKey(input.userId, message.id);
    const existing = await this.prisma.coachMessage.findUnique({
      where: { idempotencyKey },
    });
    if (existing) {
      if (
        this.isRecord(existing.context) &&
        existing.context.canonicalContinuation === true &&
        !this.continuations?.enabled(input.userId)
      )
        return { handled: true, duplicated: true, intent };
      await this.scheduleResponse({
        userId: input.userId,
        conversationId: message.conversation.id,
        messageId: message.id,
        coachMessageId: existing.id,
        content: existing.content,
        scheduledFor: this.scheduledFor(message.timestamp, message.id),
        intent,
        selectionContext,
      });
      if (
        !(
          this.dailyQueries?.accepts(commandText) ||
          isIsolatedReminderReply(commandText) ||
          this.profileConsent?.accepts(commandText)
        )
      )
        await this.activatePendingPrompt(
          input.userId,
          message,
          message.timestamp,
        );
      return { handled: true, duplicated: true, intent };
    }
    if (pending.status === 'ALREADY_CONSUMED') {
      return {
        handled: true,
        duplicated: true,
        intent,
        reason: 'PENDING_ACTION_ALREADY_CONSUMED',
      };
    }
    const dailyContent = this.dailyQueries
      ? await this.dailyQueries.answer({
          userId: input.userId,
          conversationId: message.conversation.id,
          messageId: message.id,
          text: commandText,
          referenceDate: message.timestamp,
        })
      : null;
    const profileContent =
      pending.status !== 'ACTIONABLE' &&
      pending.status !== 'COMPLETED' &&
      this.profileConsent?.accepts(commandText)
        ? await this.profileConsent.process({
            userId: input.userId,
            conversationId: message.conversation.id,
            messageId: message.id,
            referenceDate: message.timestamp,
          })
        : null;
    const isolatedReply =
      Boolean(this.dailyQueries) &&
      pending.status !== 'ACTIONABLE' &&
      pending.status !== 'COMPLETED' &&
      isIsolatedReminderReply(commandText);
    const bypassRuntime =
      profileContent !== null ||
      dailyContent !== null ||
      isolatedReply ||
      pending.status === 'ACTIONABLE' ||
      pending.status === 'EXPIRED' ||
      pending.status === 'COMPLETED' ||
      isWorkoutCurrentPlanRead(commandText);
    const runtimeDecision = bypassRuntime
      ? {
          source: 'LEGACY' as const,
          reason: isWorkoutCurrentPlanRead(commandText)
            ? ('CANONICAL_WORKOUT_READ' as const)
            : ('PENDING_ACTION' as const),
        }
      : await this.decideOfficialExecution({
          userId: input.userId,
          conversationId: message.conversation.id,
          messageId: message.id,
          text: commandText,
          receivedAt: message.timestamp.toISOString(),
          replyToExternalMessageId: message.replyToExternalMessageId,
          legacyIntent: intent,
          ...(input.proactiveReply ? { proactiveReply: true } : {}),
        });
    if (
      runtimeDecision.source === 'PLANNING_HANDOFF' &&
      runtimeDecision.reason ===
        'SIDE_EFFECT_ROUTE_REQUIRES_SINGLE_EXECUTION' &&
      runtimeDecision.planningDecision?.targetPlan
    ) {
      intent = runtimeDecision.planningDecision.targetPlan;
    } else if (
      runtimeDecision.source === 'PLANNING_HANDOFF' &&
      runtimeDecision.reason === 'PROFILE_ACQUISITION_REQUIRES_SINGLE_EXECUTION'
    ) {
      intent = runtimeDecision.profileAcquisition.executionRoute.targetPlan;
    }
    const planningResult =
      profileContent !== null || dailyContent !== null || isolatedReply
        ? {
            content: profileContent ?? dailyContent ?? UNCORRELATED_REPLY,
            responseRequired: true,
          }
        : pending.status === 'COMPLETED'
          ? { content: pending.content, responseRequired: true }
          : runtimeDecision.source === 'CONVERSATION_RUNTIME'
            ? { content: runtimeDecision.content, responseRequired: true }
            : runtimeDecision.source === 'SAFE_RESPONSE'
              ? { content: runtimeDecision.content, responseRequired: true }
              : runtimeDecision.source === 'PLANNING_HANDOFF'
                ? runtimeDecision.reason ===
                  'PROFILE_ACQUISITION_REQUIRES_SINGLE_EXECUTION'
                  ? await this.executeProfileAcquisitionHandoff({
                      userId: input.userId,
                      messageId: message.id,
                      referenceDate: message.timestamp,
                      originalRequestMessageId:
                        input.planningContinuation?.originalRequestMessageId,
                      profileAcquisition: runtimeDecision.profileAcquisition,
                    })
                  : await this.executePlanning({
                      userId: input.userId,
                      intent,
                      planningDecision: runtimeDecision.planningDecision,
                      conversationId: message.conversation.id,
                      messageId: message.id,
                      text: commandText,
                      referenceDate: message.timestamp,
                      profileId: message.conversation.user.fitnessProfile?.id,
                      pendingGoalConfirmation:
                        pending.status === 'ACTIONABLE'
                          ? pending.context
                          : undefined,
                      suppressCurrentGoalResolution:
                        pending.status === 'EXPIRED',
                      originalRequestMessageId:
                        input.planningContinuation?.originalRequestMessageId,
                    })
                : await this.executePlanning({
                    userId: input.userId,
                    intent,
                    conversationId: message.conversation.id,
                    messageId: message.id,
                    text: commandText,
                    referenceDate: message.timestamp,
                    profileId: message.conversation.user.fitnessProfile?.id,
                    pendingGoalConfirmation:
                      pending.status === 'ACTIONABLE'
                        ? pending.context
                        : undefined,
                    suppressCurrentGoalResolution: pending.status === 'EXPIRED',
                    originalRequestMessageId:
                      input.planningContinuation?.originalRequestMessageId,
                  });
    if (!planningResult.responseRequired) {
      return {
        handled: true,
        duplicated: true,
        intent,
        reason: 'PENDING_ACTION_FENCED',
      };
    }
    let content = planningResult.content;
    if (
      pending.status === 'ACTIONABLE' &&
      pending.context.resolution.status === 'RESOLVED' &&
      this.pendingActions
    ) {
      if (!planningResult.pendingExecutionClaimToken) {
        throw new Error('PENDING_GOAL_CONFIRMATION_CLAIM_TOKEN_MISSING');
      }
      const completed = await this.pendingActions.completeGoalConfirmation({
        userId: input.userId,
        conversationId: message.conversation.id,
        actionId: pending.context.actionId,
        consumerMessageId: message.id,
        content,
        completedAt: new Date(),
        claimToken: planningResult.pendingExecutionClaimToken,
      });
      if (completed.status === 'FENCED') {
        return {
          handled: true,
          duplicated: true,
          intent,
          reason: 'PENDING_ACTION_FENCED',
        };
      }
      content = completed.content;
    }
    let duplicatedAfterRace = false;
    let coachMessage: { id: string; content: string };
    try {
      coachMessage = await this.prisma.coachMessage.create({
        data: {
          userId: input.userId,
          type: CoachMessageType.FOLLOW_UP,
          idempotencyKey,
          content,
          context: {
            source: 'WHATSAPP_COMMAND',
            messageId: message.id,
            intent,
            ...selectionContext,
          },
          generatedAt: new Date(),
          scheduledFor: message.timestamp,
        },
      });
    } catch (error) {
      if (!this.isUniqueConstraintViolation(error)) throw error;
      const concurrent = await this.prisma.coachMessage.findUnique({
        where: { idempotencyKey },
      });
      if (!concurrent) throw error;
      coachMessage = concurrent;
      content = concurrent.content;
      duplicatedAfterRace = true;
    }
    await this.scheduleResponse({
      userId: input.userId,
      conversationId: message.conversation.id,
      messageId: message.id,
      coachMessageId: coachMessage.id,
      content,
      scheduledFor: this.scheduledFor(message.timestamp, message.id),
      intent,
      selectionContext,
    });
    if (profileContent === null && dailyContent === null && !isolatedReply) {
      await this.activatePendingPrompt(
        input.userId,
        message,
        message.timestamp,
      );
      this.conversationGoalShadow.execute({
        userId: input.userId,
        messageId: message.id,
        legacyIntent: intent,
        referenceTimestamp: message.timestamp.toISOString(),
        onboardingActive: false,
        equivalentGenerationInProgress: false,
      });
    }

    return {
      handled: true,
      duplicated: duplicatedAfterRace,
      intent,
    };
  }

  private isUniqueConstraintViolation(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'P2002'
    );
  }

  private async executePlanning(input: {
    readonly userId: string;
    readonly intent: CoachCommandIntent;
    readonly conversationId: string;
    readonly messageId: string;
    readonly text: string;
    readonly referenceDate: Date;
    readonly profileId?: string;
    readonly pendingGoalConfirmation?: PendingGoalConfirmationContext;
    readonly suppressCurrentGoalResolution: boolean;
    readonly originalRequestMessageId?: string;
    readonly planningDecision?: ConversationGoalDecision;
  }): Promise<{
    readonly content: string;
    readonly responseRequired: boolean;
    readonly pendingExecutionClaimToken?: string;
    readonly workoutDisposition?: 'PLAN' | 'CLARIFICATION' | 'BLOCKED';
  }> {
    const runtime = {
      planningDecision: input.planningDecision,
      conversationId: input.conversationId,
      messageId: input.messageId,
      correlationId: input.messageId,
      referenceDate: input.referenceDate,
      profileId: input.profileId,
      currentMessage:
        input.pendingGoalConfirmation?.payload.originalMessage ?? input.text,
      pendingGoalConfirmation: input.pendingGoalConfirmation,
      suppressCurrentGoalResolution: input.suppressCurrentGoalResolution,
      originalRequestMessageId: input.originalRequestMessageId,
    };
    const execution = await this.planningExecution.executeStructured(
      input.userId,
      input.intent,
      runtime,
    );
    if (!execution.responseRequired) {
      return Object.freeze({ content: '', responseRequired: false });
    }
    const acquisitionIntent =
      execution.decision?.targetPlan === 'DIET'
        ? 'DIET'
        : execution.decision?.targetPlan === 'WORKOUT'
          ? 'WORKOUT'
          : execution.decision?.targetPlan === 'BOTH'
            ? 'BOTH'
            : input.intent === 'DIET' || input.intent === 'WORKOUT'
              ? input.intent
              : input.intent === 'BOTH'
                ? 'BOTH'
                : null;
    const productiveAcquisition =
      (execution.decision?.goal === CONVERSATION_GOAL.ASK_PROFILE_INFORMATION &&
        acquisitionIntent !== null) ||
      ((input.intent === 'WORKOUT' || input.intent === 'BOTH') &&
        execution.dispatch?.workoutDisposition === 'CLARIFICATION');
    if (productiveAcquisition) {
      if (!this.profileAcquisitionRollout) {
        return this.blockedProfileClarification(acquisitionIntent);
      }
      try {
        const clarification =
          acquisitionIntent === 'WORKOUT'
            ? await this.profileAcquisitionRollout.requestWorkoutClarification({
                userId: input.userId,
                sourceMessageId: input.messageId,
                referenceDate: input.referenceDate,
                originalRequestMessageId: input.originalRequestMessageId,
                conversationContext: execution.profileAcquisitionContext,
              })
            : await this.profileAcquisitionRollout.requestProductiveClarification(
                {
                  userId: input.userId,
                  sourceMessageId: input.messageId,
                  referenceDate: input.referenceDate,
                  originalRequestMessageId: input.originalRequestMessageId,
                  conversationContext: execution.profileAcquisitionContext,
                  intent: acquisitionIntent ?? 'DIET',
                },
              );
        if (
          clarification.questionCreated ||
          clarification.reason === 'QUESTION_ALREADY_ACTIVE'
        ) {
          return Object.freeze({ content: '', responseRequired: false });
        }
      } catch {
        return this.blockedProfileClarification(acquisitionIntent);
      }
      return this.blockedProfileClarification(acquisitionIntent);
    }
    const content =
      isNutritionPlanningRealizerEligible(execution) &&
      this.planningConversationResponse
        ? await this.planningConversationResponse.select({
            userId: input.userId,
            conversationId: input.conversationId,
            messageId: input.messageId,
            execution,
          })
        : execution.content;
    return Object.freeze({
      content,
      responseRequired: true,
      pendingExecutionClaimToken: execution.pendingExecutionClaimToken,
      workoutDisposition: execution.dispatch?.workoutDisposition,
    });
  }

  private async executeProfileAcquisitionHandoff(input: {
    readonly userId: string;
    readonly messageId: string;
    readonly referenceDate: Date;
    readonly originalRequestMessageId?: string;
    readonly profileAcquisition: Extract<
      ConversationRuntimePreExecutionDecision,
      {
        readonly source: 'PLANNING_HANDOFF';
        readonly reason: 'PROFILE_ACQUISITION_REQUIRES_SINGLE_EXECUTION';
      }
    >['profileAcquisition'];
  }): Promise<{
    readonly content: string;
    readonly responseRequired: boolean;
    readonly pendingExecutionClaimToken?: string;
    readonly workoutDisposition?: 'PLAN' | 'CLARIFICATION' | 'BLOCKED';
  }> {
    const targetPlan = input.profileAcquisition.executionRoute.targetPlan;
    if (!this.profileAcquisitionRollout) {
      return this.blockedProfileClarification(targetPlan);
    }
    const preselectedQuestion = {
      selectedProfileField:
        input.profileAcquisition.executionRoute.selectedProfileField,
      logicalTurn: input.profileAcquisition.logicalTurn,
    };
    try {
      const clarification =
        targetPlan === 'WORKOUT'
          ? await this.profileAcquisitionRollout.requestWorkoutClarification({
              userId: input.userId,
              sourceMessageId: input.messageId,
              referenceDate: input.referenceDate,
              originalRequestMessageId: input.originalRequestMessageId,
              preselectedQuestion,
            })
          : await this.profileAcquisitionRollout.requestProductiveClarification(
              {
                userId: input.userId,
                sourceMessageId: input.messageId,
                referenceDate: input.referenceDate,
                originalRequestMessageId: input.originalRequestMessageId,
                intent: targetPlan,
                preselectedQuestion,
              },
            );
      if (
        clarification.questionCreated ||
        clarification.reason === 'QUESTION_ALREADY_ACTIVE'
      ) {
        return Object.freeze({ content: '', responseRequired: false });
      }
    } catch {
      return this.blockedProfileClarification(targetPlan);
    }
    return this.blockedProfileClarification(targetPlan);
  }

  private blockedProfileClarification(
    intent: 'DIET' | 'WORKOUT' | 'BOTH' | null,
  ): {
    readonly content: string;
    readonly responseRequired: true;
    readonly workoutDisposition: 'BLOCKED';
  } {
    return Object.freeze({
      content: `Não consegui registrar com segurança a próxima pergunta ${
        intent === 'DIET'
          ? 'do seu plano alimentar'
          : intent === 'WORKOUT'
            ? 'do seu treino'
            : 'dos seus planos'
      }. Tente novamente em instantes para continuarmos sem perder suas respostas.`,
      responseRequired: true,
      workoutDisposition: 'BLOCKED' as const,
    });
  }

  private async resolvePending(input: {
    readonly userId: string;
    readonly conversationId: string;
    readonly messageId: string;
    readonly text: string;
    readonly receivedAt: Date;
  }): Promise<PendingInboundResolution> {
    if (!this.pendingActions) {
      return Object.freeze({ status: 'NONE' as const });
    }
    return this.pendingActions.findPendingForInbound(input);
  }

  private async activatePendingPrompt(
    userId: string,
    message: {
      readonly id: string;
      readonly timestamp: Date;
      readonly conversation: { readonly id: string };
    },
    activatedAt: Date,
  ): Promise<void> {
    if (!this.pendingActions) return;
    await this.pendingActions.activateGoalConfirmationForSource({
      userId,
      conversationId: message.conversation.id,
      sourceMessageId: message.id,
      activatedAt,
    });
  }

  private async decideOfficialExecution(input: {
    userId: string;
    conversationId: string;
    messageId: string;
    text: string;
    receivedAt: string;
    replyToExternalMessageId?: string | null;
    legacyIntent: CoachCommandIntent;
    proactiveReply?: boolean;
  }) {
    if (!this.conversationRuntime) {
      return { source: 'LEGACY' as const, reason: 'RUNTIME_DISABLED' as const };
    }
    try {
      return await this.conversationRuntime.decide(input);
    } catch {
      return {
        source: 'SAFE_RESPONSE' as const,
        reason: 'RUNTIME_FAILURE' as const,
        content:
          'Não consegui concluir isso com segurança agora. Pode tentar novamente em instantes?',
      };
    }
  }

  classify(text: string): CoachCommandIntent {
    const recognized = explicitPlanningIntent(text);
    if (
      recognized === 'WORKOUT_PLAN_REQUEST' ||
      recognized === 'WORKOUT_PLAN_UPDATE_REQUEST'
    )
      return 'WORKOUT';
    if (
      recognized === 'DIET_PLAN_REQUEST' ||
      recognized === 'DIET_PLAN_UPDATE_REQUEST'
    )
      return 'DIET';
    if (recognized === 'COMBINED_PLAN_REQUEST') return 'BOTH';
    const normalized = this.normalize(text);
    const wantsDiet =
      this.includesAny(normalized, [
        'quero uma dieta',
        'preciso de uma dieta',
        'monta uma dieta',
        'monte uma dieta',
        'plano alimentar',
        'alimentacao',
        'me ajuda com alimentacao',
      ]) || /\b(?:outra|nova) dieta\b/u.test(normalized);
    const wantsBoth = this.includesAny(normalized, [
      'quero os dois',
      'dieta e treino',
      'treino e dieta',
      'quero tudo',
      'alimentacao e treino',
      'treino e alimentacao',
    ]);

    if (wantsBoth) {
      return 'BOTH';
    }

    if (wantsDiet) {
      return 'DIET';
    }

    return 'UNKNOWN';
  }

  private async scheduleResponse(
    input: {
      userId: string;
      conversationId: string;
      messageId: string;
      coachMessageId: string;
      content: string;
      scheduledFor: Date;
      intent: CoachCommandIntent;
      selectionContext: Prisma.InputJsonObject;
    },
    client?: Prisma.TransactionClient,
  ): Promise<void> {
    const db = client ?? this.prisma;
    const canonical = input.selectionContext.canonicalContinuation === true;
    if (canonical && !this.continuations?.enabled(input.userId)) return;
    if (canonical && !client) {
      await this.prisma.$transaction((transaction) =>
        this.scheduleResponse(input, transaction),
      );
      return;
    }
    const rule = await db.automationRule.findUnique({
      where: {
        code: AUTOMATION_RULE_CODES.DAILY_COACH,
      },
    });

    if (!rule || !rule.enabled) {
      throw new Error('Regra de automação indisponível');
    }

    await db.userAutomationPreference.upsert({
      where: {
        userId: input.userId,
      },
      update: {},
      create: {
        userId: input.userId,
      },
    });

    const parts = this.messageParts(
      input.content,
      3_400,
      input.intent === 'WORKOUT' || input.intent === 'BOTH',
    );
    const persist = async (transaction: Prisma.TransactionClient) => {
      if (canonical && !this.continuations?.enabled(input.userId)) return;
      const scheduledMessages: {
        id: string;
        scheduledFor: Date;
        context: Prisma.JsonValue;
      }[] = [];
      const existing = await transaction.scheduledMessage.findMany({
        where: {
          userId: input.userId,
          automationRuleId: rule.id,
          context: { path: ['sourceMessageId'], equals: input.messageId },
        },
        orderBy: [{ scheduledFor: 'asc' }, { id: 'asc' }],
        select: { id: true, scheduledFor: true, context: true },
      });
      if (existing.length > 0) {
        await this.publishScheduledResponse(
          transaction,
          existing,
          input,
          rule.id,
        );
        if (canonical && !this.continuations?.enabled(input.userId))
          throw new Error('Continuation runtime disabled before replay commit');
        return;
      }
      for (const [partIndex, content] of parts.entries()) {
        const scheduledFor = new Date(input.scheduledFor.getTime() + partIndex);
        const scheduledMessage = await transaction.scheduledMessage.upsert({
          where: {
            userId_automationRuleId_scheduledFor: {
              userId: input.userId,
              automationRuleId: rule.id,
              scheduledFor,
            },
          },
          update: {},
          create: {
            userId: input.userId,
            automationRuleId: rule.id,
            conversationId: input.conversationId,
            coachMessageId: partIndex === 0 ? input.coachMessageId : undefined,
            scheduledFor,
            status: ScheduledMessageStatus.PENDING,
            content,
            context: {
              source: 'WHATSAPP_COACH_COMMAND',
              sourceMessageId: input.messageId,
              intent: input.intent,
              actionable: input.intent === 'WORKOUT',
              partIndex,
              partCount: parts.length,
              ...input.selectionContext,
              deliveryMode: 'ORDERED_COACH_RESPONSE_BATCH',
            },
            responseExpiresAt:
              input.selectionContext.action === WORKOUT_SESSION_SELECTION_ACTION
                ? new Date(
                    input.scheduledFor.getTime() +
                      WORKOUT_SESSION_SELECTION_WINDOW_MS,
                  )
                : undefined,
          },
          include: {
            automationRule: true,
          },
        });

        scheduledMessages.push(scheduledMessage);
      }
      await this.publishScheduledResponse(
        transaction,
        scheduledMessages,
        input,
        rule.id,
      );
      if (canonical && !this.continuations?.enabled(input.userId))
        throw new Error(
          'Continuation runtime disabled before scheduling commit',
        );
    };
    if (client) await persist(client);
    else await this.prisma.$transaction(persist);
  }

  private async publishScheduledResponse(
    transaction: Prisma.TransactionClient,
    messages: readonly {
      id: string;
      scheduledFor: Date;
      context: Prisma.JsonValue;
    }[],
    input: { userId: string; messageId: string; intent: CoachCommandIntent },
    ruleId: string,
  ): Promise<void> {
    const ordered = messages.every(
      (message) =>
        this.isRecord(message.context) &&
        message.context.deliveryMode === 'ORDERED_COACH_RESPONSE_BATCH',
    );
    const groups = ordered ? [messages] : messages.map((message) => [message]);
    for (const group of groups) {
      await this.eventBus.publish(
        {
          eventType: INTERNAL_EVENT.AUTOMATION_TRIGGERED,
          aggregateType: 'SCHEDULED_MESSAGE',
          aggregateId: group[0].id,
          payload: {
            ...(ordered
              ? { scheduledMessageIds: group.map((message) => message.id) }
              : { scheduledMessageId: group[0].id }),
            userId: input.userId,
            automationRuleId: ruleId,
            ruleCode: AUTOMATION_RULE_CODES.DAILY_COACH,
            source: 'WHATSAPP_COACH_COMMAND',
            sourceMessageId: input.messageId,
            intent: input.intent,
          },
          availableAt: group[0].scheduledFor,
        },
        transaction,
      );
    }
  }

  private async workoutSelectionContext(
    userId: string,
    message: string,
  ): Promise<Prisma.InputJsonObject> {
    if (
      !this.currentWorkoutPlanReader ||
      !isWorkoutCurrentPlanRead(message) ||
      this.sessionOrdinal(message) !== null
    ) {
      return {};
    }
    const current = await this.currentWorkoutPlanReader.read(
      userId,
      this.continuations?.enabled(userId) ?? false,
    );
    if (
      current.status !== 'AVAILABLE' &&
      current.status !== 'LEGACY_RELATIONAL'
    ) {
      return {};
    }
    const allowedSessionSequences =
      current.status === 'AVAILABLE'
        ? current.plan.document.sessions.map((session) => session.sequence)
        : current.plan.sessions.map((session) => session.sequence);
    return {
      action: WORKOUT_SESSION_SELECTION_ACTION,
      workoutPlanId: current.plan.aggregateId,
      allowedSessionSequences,
    };
  }

  private async resolveWorkoutSessionContinuation(input: {
    readonly userId: string;
    readonly conversationId: string;
    readonly text: string;
    readonly receivedAt: Date;
    readonly replyToExternalMessageId?: string | null;
  }): Promise<{ readonly sequence: number } | null> {
    const sequence = this.sessionOrdinal(input.text);
    if (sequence === null) return null;
    const quoted = Boolean(input.replyToExternalMessageId);
    const candidate = await this.prisma.scheduledMessage.findFirst({
      where: {
        userId: input.userId,
        conversationId: input.conversationId,
        status: ScheduledMessageStatus.SENT,
        ...(quoted
          ? { externalMessageId: input.replyToExternalMessageId }
          : {
              scheduledFor: { lte: input.receivedAt },
              responseExpiresAt: { gte: input.receivedAt },
            }),
      },
      select: {
        context: true,
        responseExpiresAt: true,
        scheduledFor: true,
        sentAt: true,
      },
      orderBy: [{ scheduledFor: 'desc' }, { id: 'desc' }],
    });
    if (
      !candidate?.responseExpiresAt ||
      candidate.responseExpiresAt < input.receivedAt ||
      !this.isRecord(candidate.context) ||
      candidate.context.action !== WORKOUT_SESSION_SELECTION_ACTION
    ) {
      return null;
    }
    if (!quoted) {
      const activeProfile =
        await this.prisma.coachProfileAcquisitionCycle.findFirst({
          where: {
            userId: input.userId,
            active: true,
            expiresAt: { gt: input.receivedAt },
            askedAt: { not: null },
          },
          select: { askedAt: true },
          orderBy: [{ askedAt: 'desc' }, { id: 'desc' }],
        });
      const selectionAt = candidate.sentAt ?? candidate.scheduledFor;
      if (activeProfile?.askedAt && activeProfile.askedAt > selectionAt) {
        return null;
      }
    }
    const allowed = candidate.context.allowedSessionSequences;
    const workoutPlanId = candidate.context.workoutPlanId;
    if (
      !this.currentWorkoutPlanReader ||
      typeof workoutPlanId !== 'string' ||
      !workoutPlanId.trim() ||
      !Array.isArray(allowed) ||
      !allowed.every(
        (value) => Number.isInteger(value) && Number(value) >= 1,
      ) ||
      !allowed.includes(sequence)
    ) {
      return null;
    }
    const current = await this.currentWorkoutPlanReader.read(
      input.userId,
      this.continuations?.enabled(input.userId) ?? false,
    );
    if (
      (current.status !== 'AVAILABLE' &&
        current.status !== 'LEGACY_RELATIONAL') ||
      current.plan.aggregateId !== workoutPlanId
    ) {
      return null;
    }
    const currentSequences =
      current.status === 'AVAILABLE'
        ? current.plan.document.sessions.map((session) => session.sequence)
        : current.plan.sessions.map((session) => session.sequence);
    if (!currentSequences.includes(sequence)) return null;
    return Object.freeze({ sequence });
  }

  private sessionOrdinal(value: string): number | null {
    const text = this.normalize(value);
    const match =
      /^(?:(?:mostra|mostre)\s+)?(?:(?:sessao|treino)\s*)?(?:a\s+)?(1|2|3|4|5|6|7|um|dois|tres|quatro|cinco|seis|sete|primeira|primeiro|segundo|terceira|terceiro|quarto|quinto|sexto|setima|setimo)$/u.exec(
        text,
      );
    if (!match) return null;
    const values: Readonly<Record<string, number>> = Object.freeze({
      '1': 1,
      um: 1,
      primeira: 1,
      primeiro: 1,
      '2': 2,
      dois: 2,
      segundo: 2,
      '3': 3,
      tres: 3,
      terceira: 3,
      terceiro: 3,
      '4': 4,
      quatro: 4,
      quarto: 4,
      '5': 5,
      cinco: 5,
      quinto: 5,
      '6': 6,
      seis: 6,
      sexto: 6,
      '7': 7,
      sete: 7,
      setima: 7,
      setimo: 7,
    });
    return values[match[1]] ?? null;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private messageParts(
    content: string,
    maximumLength = 3_400,
    workout = false,
  ): readonly string[] {
    if (workout) return chunkWorkoutWhatsApp(content, maximumLength);
    const remaining = content.trim();
    if (remaining.length <= maximumLength) return Object.freeze([remaining]);
    const parts: string[] = [];
    let cursor = remaining;
    while (cursor.length > maximumLength) {
      const window = cursor.slice(0, maximumLength + 1);
      const paragraph = window.lastIndexOf('\n\n');
      const line = window.lastIndexOf('\n');
      const space = window.lastIndexOf(' ');
      const semantic = workout
        ? ([
            ...window.matchAll(
              /\n(?=\*(?:Sessão \d+|Segunda|Terça|Quarta|Quinta|Sexta|Sábado|Domingo)\b)/gu,
            ),
          ].at(-1)?.index ?? -1)
        : -1;
      const unit = workout
        ? ([...window.matchAll(/\n(?=\*[^\n*]+\*\n)/gu)].at(-1)?.index ?? -1)
        : -1;
      const boundary =
        semantic > 0
          ? semantic
          : unit >= maximumLength / 2
            ? unit
            : paragraph >= maximumLength / 2
              ? paragraph
              : line >= maximumLength / 2
                ? line
                : space >= maximumLength / 2
                  ? space
                  : -1;
      const cut = boundary > 0 ? boundary : maximumLength;
      parts.push(cursor.slice(0, cut).trimEnd());
      cursor = cursor.slice(cut).trimStart();
    }
    if (cursor) parts.push(cursor);
    return Object.freeze(parts);
  }

  private idempotencyKey(userId: string, messageId: string): string {
    return `${userId}:WHATSAPP_COACH_COMMAND:${messageId}`;
  }

  private scheduledFor(timestamp: Date, messageId: string): Date {
    return new Date(timestamp.getTime() + this.stableOffsetMs(messageId));
  }

  private stableOffsetMs(value: string): number {
    let hash = 0;

    for (const char of value) {
      hash = (hash * 31 + char.charCodeAt(0)) % 997;
    }

    return hash;
  }

  private includesAny(text: string, expressions: readonly string[]): boolean {
    return expressions.some((expression) => text.includes(expression));
  }

  private normalize(text: string): string {
    return text
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLocaleLowerCase('pt-BR')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
}
