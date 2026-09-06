import { Injectable, Optional } from '@nestjs/common';
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
import { ConversationRuntimeIntegrationService } from '../conversation/runtime/conversation-runtime-integration.service';
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
  ) {}

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
    if (!this.pendingActions) return false;
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

    if (!message.conversation.user.onboardingCompleted) {
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
    const intent =
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
      where: {
        idempotencyKey,
      },
    });

    if (existing) {
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
      await this.activatePendingPrompt(
        input.userId,
        message,
        message.timestamp,
      );

      return {
        handled: true,
        duplicated: true,
        intent,
      };
    }

    if (pending.status === 'ALREADY_CONSUMED') {
      return {
        handled: true,
        duplicated: true,
        intent,
        reason: 'PENDING_ACTION_ALREADY_CONSUMED',
      };
    }

    const bypassRuntime =
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
          ...(input.proactiveReply ? { proactiveReply: true } : {}),
          legacyIntent: intent,
        });
    const planningResult =
      pending.status === 'COMPLETED'
        ? { content: pending.content, responseRequired: true }
        : runtimeDecision.source === 'CONVERSATION_RUNTIME'
          ? { content: runtimeDecision.content, responseRequired: true }
          : await this.executePlanning({
              userId: input.userId,
              intent,
              conversationId: message.conversation.id,
              messageId: message.id,
              text: commandText,
              referenceDate: message.timestamp,
              profileId: message.conversation.user.fitnessProfile?.id,
              pendingGoalConfirmation:
                pending.status === 'ACTIONABLE' ? pending.context : undefined,
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
    await this.activatePendingPrompt(input.userId, message, message.timestamp);
    this.conversationGoalShadow.execute({
      userId: input.userId,
      messageId: message.id,
      legacyIntent: intent,
      referenceTimestamp: message.timestamp.toISOString(),
      onboardingActive: false,
      equivalentGenerationInProgress: false,
    });

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
  }): Promise<{
    readonly content: string;
    readonly responseRequired: boolean;
    readonly pendingExecutionClaimToken?: string;
    readonly workoutDisposition?: 'PLAN' | 'CLARIFICATION' | 'BLOCKED';
  }> {
    const runtime = {
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
      return { source: 'LEGACY' as const, reason: 'RUNTIME_FAILURE' as const };
    }
  }

  classify(text: string): CoachCommandIntent {
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
    const wantsWorkout =
      this.includesAny(normalized, [
        'quero treino',
        'monte meu treino',
        'monta meu treino',
        'plano de treino',
        'treino para mim',
        'treino pra mim',
        'academia',
        'quero treinar',
        'quero correr',
        'comecar a correr',
        'corrida',
        'ja corro',
        'crossfit',
        'musculacao',
        'treino funcional',
        'cardio',
        'aerobico',
        'calistenia',
      ]) ||
      /\bprova de \d+ km\b/u.test(normalized) ||
      /\b(?:outro|novo) (?:plano de )?treino\b/u.test(normalized);
    const wantsBoth = this.includesAny(normalized, [
      'quero os dois',
      'dieta e treino',
      'treino e dieta',
      'quero tudo',
      'alimentacao e treino',
      'treino e alimentacao',
    ]);

    if (wantsBoth || (wantsDiet && wantsWorkout)) {
      return 'BOTH';
    }

    if (wantsDiet) {
      return 'DIET';
    }

    if (wantsWorkout) {
      return 'WORKOUT';
    }

    return 'UNKNOWN';
  }

  private async scheduleResponse(input: {
    userId: string;
    conversationId: string;
    messageId: string;
    coachMessageId: string;
    content: string;
    scheduledFor: Date;
    intent: CoachCommandIntent;
    selectionContext: Prisma.InputJsonObject;
  }): Promise<void> {
    const rule = await this.prisma.automationRule.findUnique({
      where: {
        code: AUTOMATION_RULE_CODES.DAILY_COACH,
      },
    });

    if (!rule || !rule.enabled) {
      throw new Error('Regra de automação indisponível');
    }

    await this.prisma.userAutomationPreference.upsert({
      where: {
        userId: input.userId,
      },
      update: {},
      create: {
        userId: input.userId,
      },
    });

    const parts = this.messageParts(input.content);
    await this.prisma.$transaction(async (transaction) => {
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

        await this.eventBus.publish(
          {
            eventType: INTERNAL_EVENT.AUTOMATION_TRIGGERED,
            aggregateType: 'SCHEDULED_MESSAGE',
            aggregateId: scheduledMessage.id,
            payload: {
              scheduledMessageId: scheduledMessage.id,
              userId: input.userId,
              automationRuleId: rule.id,
              ruleCode: AUTOMATION_RULE_CODES.DAILY_COACH,
              source: 'WHATSAPP_COACH_COMMAND',
              sourceMessageId: input.messageId,
              intent: input.intent,
            },
            availableAt: scheduledFor,
          },
          transaction,
        );
      }
    });
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
    const current = await this.currentWorkoutPlanReader.read(userId);
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
    const current = await this.currentWorkoutPlanReader.read(input.userId);
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
  ): readonly string[] {
    const remaining = content.trim();
    if (remaining.length <= maximumLength) return Object.freeze([remaining]);
    const parts: string[] = [];
    let cursor = remaining;
    while (cursor.length > maximumLength) {
      const window = cursor.slice(0, maximumLength + 1);
      const paragraph = window.lastIndexOf('\n\n');
      const line = window.lastIndexOf('\n');
      const space = window.lastIndexOf(' ');
      const boundary =
        paragraph >= maximumLength / 2
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
