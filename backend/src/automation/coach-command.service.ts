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

export type CoachCommandIntent = 'DIET' | 'WORKOUT' | 'BOTH' | 'UNKNOWN';

export interface ProcessCoachCommandInput {
  userId: string;
  messageId: string;
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
  ) {}

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

    if (!message.conversation.user.onboardingCompleted) {
      return {
        handled: false,
        duplicated: false,
        intent: 'UNKNOWN',
        reason: 'ONBOARDING_NOT_COMPLETED',
      };
    }

    const intent = this.classify(message.content);
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

      return {
        handled: true,
        duplicated: true,
        intent,
      };
    }

    const runtimeDecision = await this.decideOfficialExecution({
      userId: input.userId,
      conversationId: message.conversation.id,
      messageId: message.id,
      text: message.content,
      receivedAt: message.timestamp.toISOString(),
      legacyIntent: intent,
    });
    const content =
      runtimeDecision.source === 'CONVERSATION_RUNTIME'
        ? runtimeDecision.content
        : await this.executePlanning({
            userId: input.userId,
            intent,
            conversationId: message.conversation.id,
            messageId: message.id,
            text: message.content,
            referenceDate: message.timestamp,
            profileId: message.conversation.user.fitnessProfile?.id,
          });
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
  }): Promise<string> {
    const runtime = {
      conversationId: input.conversationId,
      messageId: input.messageId,
      correlationId: input.messageId,
      referenceDate: input.referenceDate,
      profileId: input.profileId,
      currentMessage: input.text,
    };
    if (!this.planningConversationResponse) {
      return this.planningExecution.execute(
        input.userId,
        input.intent,
        runtime,
      );
    }
    const execution = await this.planningExecution.executeStructured(
      input.userId,
      input.intent,
      runtime,
    );
    return this.planningConversationResponse.select({
      userId: input.userId,
      conversationId: input.conversationId,
      messageId: input.messageId,
      execution,
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
    const wantsWorkout = this.includesAny(normalized, [
      'quero treino',
      'monte meu treino',
      'monta meu treino',
      'plano de treino',
      'treino para mim',
      'treino pra mim',
      'academia',
      'quero treinar',
    ]);
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
