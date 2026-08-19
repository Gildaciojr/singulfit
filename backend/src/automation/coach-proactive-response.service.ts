import { Injectable } from '@nestjs/common';
import {
  CoachMessageType,
  CoachProactiveWorkoutOutcome,
  MemoryType,
  MessageDirection,
  MessageType,
  Prisma,
  ScheduledMessageStatus,
} from '@prisma/client';
import { EventBusService } from '../event-bus/event-bus.service';
import { INTERNAL_EVENT } from '../event-bus/event-bus.constants';
import { PrismaService } from '../prisma/prisma.service';
import { AUTOMATION_RULE_CODES } from './automation.constants';
import {
  COACH_PROACTIVE_INTENTS,
  COACH_PROACTIVE_SOURCE,
} from './coach-proactive.contract';

const RESPONSE_SOURCE = 'COACH_PROACTIVE_RESPONSE_V1';

export interface CoachProactiveResponseCaptureResult {
  readonly handled: boolean;
  readonly duplicated: boolean;
  readonly outcome: CoachProactiveWorkoutOutcome | null;
}

@Injectable()
export class CoachProactiveResponseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBusService,
  ) {}

  async capture(input: {
    readonly userId: string;
    readonly messageId: string;
  }): Promise<CoachProactiveResponseCaptureResult> {
    const message = await this.prisma.message.findFirst({
      where: {
        id: input.messageId,
        direction: MessageDirection.INBOUND,
        type: MessageType.TEXT,
        conversation: { userId: input.userId, status: 'ACTIVE' },
      },
      select: {
        id: true,
        conversationId: true,
        content: true,
        timestamp: true,
        replyToExternalMessageId: true,
      },
    });
    if (!message?.replyToExternalMessageId) return this.notHandled();
    if (this.isIndependentCommand(message.content)) return this.notHandled();

    const intervention = await this.prisma.scheduledMessage.findFirst({
      where: {
        userId: input.userId,
        conversationId: message.conversationId,
        externalMessageId: message.replyToExternalMessageId,
        status: ScheduledMessageStatus.SENT,
      },
      select: {
        id: true,
        responseExpiresAt: true,
        responseMessageId: true,
        context: true,
      },
    });
    if (!intervention || !this.isWorkoutCheck(intervention.context)) {
      return this.notHandled();
    }
    if (
      !intervention.responseExpiresAt ||
      intervention.responseExpiresAt < message.timestamp
    ) {
      return this.notHandled();
    }

    const outcome = this.classify(message.content);
    return this.persist({
      userId: input.userId,
      message,
      interventionId: intervention.id,
      outcome,
    });
  }

  private persist(input: {
    readonly userId: string;
    readonly interventionId: string;
    readonly outcome: CoachProactiveWorkoutOutcome;
    readonly message: {
      readonly id: string;
      readonly conversationId: string;
      readonly content: string;
      readonly timestamp: Date;
    };
  }): Promise<CoachProactiveResponseCaptureResult> {
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT pg_advisory_xact_lock(
          hashtext(${`coach-proactive-response:${input.interventionId}`})
        )
      `;
      const current = await transaction.scheduledMessage.findUnique({
        where: { id: input.interventionId },
        select: {
          responseMessageId: true,
          responseExpiresAt: true,
          context: true,
        },
      });
      if (!current) return this.notHandled();
      if (current.responseMessageId) {
        return Object.freeze({
          handled: true,
          duplicated: true,
          outcome: input.outcome,
        });
      }
      if (
        !current.responseExpiresAt ||
        current.responseExpiresAt < input.message.timestamp
      ) {
        return this.notHandled();
      }

      await transaction.scheduledMessage.update({
        where: { id: input.interventionId },
        data: {
          responseMessageId: input.message.id,
          responseOutcome: input.outcome,
          respondedAt: input.message.timestamp,
        },
      });
      await transaction.conversationMemory.upsert({
        where: {
          userId_memoryType_sourceKey: {
            userId: input.userId,
            memoryType: MemoryType.SHORT_TERM,
            sourceKey: `proactive-workout:${input.interventionId}`,
          },
        },
        update: {},
        create: {
          userId: input.userId,
          memoryType: MemoryType.SHORT_TERM,
          sourceKey: `proactive-workout:${input.interventionId}`,
          content: {
            source: RESPONSE_SOURCE,
            interventionId: input.interventionId,
            sourceMessageId: input.message.id,
            outcome: input.outcome,
            safetyIssue:
              input.outcome === CoachProactiveWorkoutOutcome.ISSUE_REPORTED,
            interventionContext: current.context,
          },
          summary: this.memorySummary(input.outcome),
          relevanceScore: new Prisma.Decimal('0.9500'),
          generatedAt: input.message.timestamp,
        },
      });

      const content = this.response(input.outcome);
      const coachMessage = await transaction.coachMessage.upsert({
        where: {
          idempotencyKey: `proactive-response:${input.interventionId}`,
        },
        update: {},
        create: {
          userId: input.userId,
          type: CoachMessageType.FOLLOW_UP,
          idempotencyKey: `proactive-response:${input.interventionId}`,
          content,
          context: {
            source: RESPONSE_SOURCE,
            interventionId: input.interventionId,
            sourceMessageId: input.message.id,
            outcome: input.outcome,
          },
          generatedAt: input.message.timestamp,
          scheduledFor: input.message.timestamp,
        },
      });
      const rule = await transaction.automationRule.findUnique({
        where: { code: AUTOMATION_RULE_CODES.DAILY_COACH },
        select: { id: true, enabled: true },
      });
      if (!rule?.enabled) throw new Error('Regra de automação indisponível');
      const scheduledFor = new Date(
        input.message.timestamp.getTime() + this.stableOffset(input.message.id),
      );
      const scheduled = await transaction.scheduledMessage.upsert({
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
          conversationId: input.message.conversationId,
          coachMessageId: coachMessage.id,
          scheduledFor,
          status: ScheduledMessageStatus.PENDING,
          content,
          context: {
            source: RESPONSE_SOURCE,
            interventionId: input.interventionId,
            sourceMessageId: input.message.id,
            outcome: input.outcome,
          },
        },
      });
      await this.eventBus.publish(
        {
          eventType: INTERNAL_EVENT.AUTOMATION_TRIGGERED,
          aggregateType: 'SCHEDULED_MESSAGE',
          aggregateId: scheduled.id,
          payload: {
            scheduledMessageId: scheduled.id,
            userId: input.userId,
            automationRuleId: rule.id,
            ruleCode: AUTOMATION_RULE_CODES.DAILY_COACH,
            source: RESPONSE_SOURCE,
            sourceMessageId: input.message.id,
            outcome: input.outcome,
          },
          availableAt: scheduledFor,
        },
        transaction,
      );
      return Object.freeze({
        handled: true,
        duplicated: false,
        outcome: input.outcome,
      });
    });
  }

  private classify(value: string): CoachProactiveWorkoutOutcome {
    const text = this.normalize(value);
    if (/\b(dor|doeu|doendo|incomodou|machucou|lesionei)\b/u.test(text)) {
      return CoachProactiveWorkoutOutcome.ISSUE_REPORTED;
    }
    if (/\b(metade|so uma parte|fiz parte|nao terminei)\b/u.test(text)) {
      return CoachProactiveWorkoutOutcome.PARTIAL;
    }
    if (/\b(vou fazer|mais tarde|depois eu faco|adiei|adiar)\b/u.test(text)) {
      return CoachProactiveWorkoutOutcome.DEFERRED;
    }
    if (
      /\b(nao treinei|nao fiz|nao consegui|hoje nao deu|pulei)\b/u.test(text)
    ) {
      return CoachProactiveWorkoutOutcome.SKIPPED;
    }
    if (
      /\b(fiz tudo|consegui fazer|completei|treinei|foi otimo)\b/u.test(text)
    ) {
      return CoachProactiveWorkoutOutcome.COMPLETED;
    }
    return CoachProactiveWorkoutOutcome.UNKNOWN;
  }

  private response(outcome: CoachProactiveWorkoutOutcome): string {
    switch (outcome) {
      case CoachProactiveWorkoutOutcome.COMPLETED:
        return 'Boa! Treino concluído e registrado. Como ficou sua energia depois da sessão?';
      case CoachProactiveWorkoutOutcome.PARTIAL:
        return 'Tudo bem ter feito só uma parte. O que mais limitou sua sessão hoje?';
      case CoachProactiveWorkoutOutcome.SKIPPED:
        return 'Sem culpa. Quer ajustar horário, duração ou algum detalhe da rotina para o próximo treino?';
      case CoachProactiveWorkoutOutcome.DEFERRED:
        return 'Combinado. Quando terminar mais tarde, me conte como foi.';
      case CoachProactiveWorkoutOutcome.ISSUE_REPORTED:
        return 'Entendi. Evite movimentos que aumentem o desconforto. Em qual exercício isso aconteceu? Se a dor for forte ou persistente, procure avaliação profissional.';
      case CoachProactiveWorkoutOutcome.UNKNOWN:
        return 'Entendi. Você conseguiu concluir, fez só uma parte ou precisou adiar o treino?';
    }
  }

  private memorySummary(outcome: CoachProactiveWorkoutOutcome): string {
    return outcome === CoachProactiveWorkoutOutcome.ISSUE_REPORTED
      ? 'Usuário relatou desconforto durante a sessão; requer abordagem de segurança, sem diagnóstico.'
      : `Resultado informado para a sessão de treino: ${outcome}.`;
  }

  private isWorkoutCheck(value: Prisma.JsonValue): boolean {
    return (
      this.isRecord(value) &&
      value.source === COACH_PROACTIVE_SOURCE &&
      value.intent === COACH_PROACTIVE_INTENTS.WORKOUT_CHECK
    );
  }

  private isIndependentCommand(value: string): boolean {
    const text = this.normalize(value);
    return /\b(troque|substitua|adapte|mude|monte|crie|gere|qual meu treino|mostre meu treino|quero um treino)\b/u.test(
      text,
    );
  }

  private normalize(value: string): string {
    return value
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLocaleLowerCase('pt-BR')
      .replace(/[^a-z0-9 ]/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();
  }

  private stableOffset(value: string): number {
    let hash = 0;
    for (const character of value) {
      hash = (hash * 31 + character.charCodeAt(0)) % 997;
    }
    return hash;
  }

  private notHandled(): CoachProactiveResponseCaptureResult {
    return Object.freeze({ handled: false, duplicated: false, outcome: null });
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
