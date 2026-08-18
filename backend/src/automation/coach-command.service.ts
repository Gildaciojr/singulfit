import { Injectable, Optional } from '@nestjs/common';
import { CoachPlanningExecutionService } from './coach-planning-execution.service';
import { CoachMessageType, ScheduledMessageStatus } from '@prisma/client';
import { EventBusService } from '../event-bus/event-bus.service';
import { INTERNAL_EVENT } from '../event-bus/event-bus.constants';
import { PrismaService } from '../prisma/prisma.service';
import { AUTOMATION_RULE_CODES } from './automation.constants';
import { ConversationGoalShadowPipelineService } from './conversation-goal-shadow-pipeline.service';
import { ConversationRuntimeIntegrationService } from '../conversation/runtime/conversation-runtime-integration.service';
import { CoachPlanningConversationResponseService } from './coach-planning-conversation-response.service';
import { PendingConversationActionService } from './pending-conversation-action.service';
import type {
  PendingGoalConfirmationContext,
  PendingInboundResolution,
} from './pending-conversation-action.contract';
import { ProfileAcquisitionInternalRolloutService } from '../context/profile-acquisition/profile-acquisition-internal-rollout.service';

export type CoachCommandIntent = 'DIET' | 'WORKOUT' | 'BOTH' | 'UNKNOWN';

export interface ProcessCoachCommandInput {
  userId: string;
  messageId: string;
  workoutContinuationMessageId?: string;
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
  ) {}

  async shouldHandleBeforeProfileAcquisition(
    input: ProcessCoachCommandInput,
  ): Promise<boolean> {
    if (!this.pendingActions) return false;
    const message = await this.prisma.message.findFirst({
      where: {
        id: input.messageId,
        conversation: { userId: input.userId },
      },
      select: {
        id: true,
        content: true,
        timestamp: true,
        conversationId: true,
      },
    });
    if (!message) return false;
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
    const workoutOriginal = input.workoutContinuationMessageId
      ? await this.prisma.message.findFirst({
          where: {
            id: input.workoutContinuationMessageId,
            conversation: { userId: input.userId },
          },
          select: { content: true },
        })
      : null;
    const commandText = workoutOriginal?.content ?? message.content;

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
            : input.workoutContinuationMessageId
              ? 'WORKOUT'
              : this.classify(commandText);
    const idempotencyKey = this.idempotencyKey(input.userId, message.id);
    const existing = await this.prisma.coachMessage.findUnique({
      where: {
        idempotencyKey,
      },
    });

    if (existing) {
      await this.scheduleResponse({
        userId: input.userId,
        messageId: message.id,
        content: existing.content,
        scheduledFor: this.scheduledFor(message.timestamp, message.id),
        intent,
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
      pending.status === 'COMPLETED';
    const runtimeDecision = bypassRuntime
      ? { source: 'LEGACY' as const, reason: 'PENDING_ACTION' as const }
      : await this.decideOfficialExecution({
          userId: input.userId,
          conversationId: message.conversation.id,
          messageId: message.id,
          text: commandText,
          receivedAt: message.timestamp.toISOString(),
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
              originalRequestMessageId: input.workoutContinuationMessageId,
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
    await this.prisma.coachMessage.create({
      data: {
        userId: input.userId,
        type: CoachMessageType.FOLLOW_UP,
        idempotencyKey,
        content,
        context: {
          source: 'WHATSAPP_COMMAND',
          messageId: message.id,
          intent,
        },
        generatedAt: new Date(),
        scheduledFor: message.timestamp,
      },
    });
    await this.scheduleResponse({
      userId: input.userId,
      messageId: message.id,
      content,
      scheduledFor: this.scheduledFor(message.timestamp, message.id),
      intent,
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
      duplicated: false,
      intent,
    };
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
    };
    const execution = await this.planningExecution.executeStructured(
      input.userId,
      input.intent,
      runtime,
    );
    if (!execution.responseRequired) {
      return Object.freeze({ content: '', responseRequired: false });
    }
    if (
      execution.dispatch?.workoutDisposition === 'CLARIFICATION' &&
      this.profileAcquisitionRollout
    ) {
      const clarification =
        await this.profileAcquisitionRollout.requestWorkoutClarification({
          userId: input.userId,
          sourceMessageId: input.messageId,
          referenceDate: input.referenceDate,
          originalRequestMessageId: input.originalRequestMessageId,
        });
      if (clarification.questionCreated) {
        return Object.freeze({ content: '', responseRequired: false });
      }
    }
    const content =
      execution.selectedSource === 'LEGACY' && this.planningConversationResponse
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
    legacyIntent: CoachCommandIntent;
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
    const wantsDiet = this.includesAny(normalized, [
      'quero uma dieta',
      'preciso de uma dieta',
      'monta uma dieta',
      'monte uma dieta',
      'plano alimentar',
      'alimentacao',
      'me ajuda com alimentacao',
    ]);
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
      ]) || /\bprova de \d+ km\b/u.test(normalized);
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
    messageId: string;
    content: string;
    scheduledFor: Date;
    intent: CoachCommandIntent;
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

    await this.prisma.$transaction(async (transaction) => {
      const scheduledMessage = await transaction.scheduledMessage.upsert({
        where: {
          userId_automationRuleId_scheduledFor: {
            userId: input.userId,
            automationRuleId: rule.id,
            scheduledFor: input.scheduledFor,
          },
        },
        update: {},
        create: {
          userId: input.userId,
          automationRuleId: rule.id,
          scheduledFor: input.scheduledFor,
          status: ScheduledMessageStatus.PENDING,
          content: input.content,
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
          availableAt: input.scheduledFor,
        },
        transaction,
      );
    });
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
