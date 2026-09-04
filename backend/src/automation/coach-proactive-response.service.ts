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
  type CoachProactiveIntent,
} from './coach-proactive.contract';

const RESPONSE_SOURCE = 'COACH_PROACTIVE_RESPONSE_V1';

type HydrationEvidence = 'GOAL_COMPLETED' | 'WATER_CONSUMED' | null;

interface ProactiveResponseClassification {
  readonly outcome: CoachProactiveWorkoutOutcome;
  readonly hydrationEvidence: HydrationEvidence;
}

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
        conversation: {
          select: { user: { select: { name: true } } },
        },
      },
    });
    if (!message) return this.notHandled();
    if (this.isIndependentCommand(message.content)) return this.notHandled();

    const quoted = Boolean(message.replyToExternalMessageId);
    const intervention = await this.prisma.scheduledMessage.findFirst({
      where: {
        userId: input.userId,
        conversationId: message.conversationId,
        status: ScheduledMessageStatus.SENT,
        ...(quoted
          ? { externalMessageId: message.replyToExternalMessageId }
          : {
              scheduledFor: { lte: message.timestamp },
              responseExpiresAt: { gte: message.timestamp },
              context: { path: ['source'], equals: COACH_PROACTIVE_SOURCE },
            }),
      },
      select: {
        id: true,
        scheduledFor: true,
        sentAt: true,
        responseExpiresAt: true,
        responseMessageId: true,
        context: true,
      },
      orderBy: [{ scheduledFor: 'desc' }, { id: 'desc' }],
    });
    const intent = intervention
      ? this.proactiveIntent(intervention.context)
      : null;
    if (!intervention || !intent) {
      return this.notHandled();
    }
    if (
      !intervention.responseExpiresAt ||
      intervention.responseExpiresAt < message.timestamp
    ) {
      return this.notHandled();
    }
    if (
      !quoted &&
      intervention.responseMessageId &&
      intervention.responseMessageId !== message.id
    ) {
      return this.notHandled();
    }

    if (!quoted) {
      const activeProfile =
        await this.prisma.coachProfileAcquisitionCycle.findFirst({
          where: {
            userId: input.userId,
            active: true,
            expiresAt: { gt: message.timestamp },
            askedAt: { not: null },
          },
          select: { askedAt: true },
          orderBy: [{ askedAt: 'desc' }, { id: 'desc' }],
        });
      const proactiveAt = intervention.sentAt ?? intervention.scheduledFor;
      if (activeProfile?.askedAt && activeProfile.askedAt > proactiveAt) {
        return this.notHandled();
      }
    }

    const classification = this.classify(intent, message.content);
    if (classification === null) return this.notHandled();
    return this.persist({
      userId: input.userId,
      message,
      interventionId: intervention.id,
      intent,
      outcome: classification.outcome,
      hydrationEvidence: classification.hydrationEvidence,
      preferredName: this.preferredName(message.conversation.user.name),
    });
  }

  private persist(input: {
    readonly userId: string;
    readonly interventionId: string;
    readonly intent: CoachProactiveIntent;
    readonly outcome: CoachProactiveWorkoutOutcome;
    readonly hydrationEvidence: HydrationEvidence;
    readonly preferredName: string | null;
    readonly message: {
      readonly id: string;
      readonly conversationId: string;
      readonly content: string;
      readonly timestamp: Date;
    };
  }): Promise<CoachProactiveResponseCaptureResult> {
    return this.prisma.$transaction(async (transaction) => {
      const hydrationContext =
        input.intent === COACH_PROACTIVE_INTENTS.HYDRATION_CHECK &&
        input.hydrationEvidence
          ? { hydrationEvidence: input.hydrationEvidence }
          : {};
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
            ...hydrationContext,
            safetyIssue:
              input.outcome === CoachProactiveWorkoutOutcome.ISSUE_REPORTED,
            interventionContext: current.context,
          },
          summary: this.memorySummary(
            input.intent,
            input.outcome,
            input.hydrationEvidence,
          ),
          relevanceScore: new Prisma.Decimal('0.9500'),
          generatedAt: input.message.timestamp,
        },
      });

      const content = this.response(
        input.intent,
        input.outcome,
        input.hydrationEvidence,
        input.preferredName,
      );
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
            intent: input.intent,
            outcome: input.outcome,
            ...hydrationContext,
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
            intent: input.intent,
            outcome: input.outcome,
            ...hydrationContext,
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
            ...hydrationContext,
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

  private classify(
    intent: CoachProactiveIntent,
    value: string,
  ): ProactiveResponseClassification | null {
    const text = this.normalize(value);
    if (!text) return null;
    if (/\b(dor|doeu|doendo|incomodou|machucou|lesionei)\b/u.test(text)) {
      return intent === COACH_PROACTIVE_INTENTS.WORKOUT_CHECK
        ? this.classification(CoachProactiveWorkoutOutcome.ISSUE_REPORTED)
        : null;
    }
    if (
      /\b(metade|so uma parte|fiz parte|nao terminei|bebi pouco|pouca agua)\b/u.test(
        text,
      )
    ) {
      return this.classification(CoachProactiveWorkoutOutcome.PARTIAL);
    }
    if (/\b(vou fazer|mais tarde|depois eu faco|adiei|adiar)\b/u.test(text)) {
      return this.classification(CoachProactiveWorkoutOutcome.DEFERRED);
    }
    if (
      /\b(ainda nao|nao consegui|hoje nao|nao fiz|nao treinei|nao jantei|nao almoco|nao almocei|pulei)\b/u.test(
        text,
      )
    ) {
      return this.classification(CoachProactiveWorkoutOutcome.SKIPPED);
    }
    if (
      intent === COACH_PROACTIVE_INTENTS.HYDRATION_CHECK &&
      /\b(ja bati a meta|bati (?:a|minha) meta|completei a meta|alcancei (?:a|minha) meta|ja cheguei na meta)\b/u.test(
        text,
      )
    ) {
      return this.classification(
        CoachProactiveWorkoutOutcome.COMPLETED,
        'GOAL_COMPLETED',
      );
    }
    if (
      intent === COACH_PROACTIVE_INTENTS.HYDRATION_CHECK &&
      /\b(sim|ja|ja bebi|bebi agua|estou bebendo|to bebendo|consegui beber)\b/u.test(
        text,
      )
    ) {
      return this.classification(
        CoachProactiveWorkoutOutcome.COMPLETED,
        'WATER_CONSUMED',
      );
    }
    if (
      /\b(sim|ja|fiz tudo|ja fiz|consegui|completei|treinei|foi otimo|bati a meta|almocei|jantei|estou bem|to bem|bom dia)\b/u.test(
        text,
      )
    ) {
      return this.classification(CoachProactiveWorkoutOutcome.COMPLETED);
    }
    if (/\b(cansad[oa]|exaust[oa]|sem energia)\b/u.test(text)) {
      return this.classification(CoachProactiveWorkoutOutcome.PARTIAL);
    }
    return null;
  }

  private response(
    intent: CoachProactiveIntent,
    outcome: CoachProactiveWorkoutOutcome,
    hydrationEvidence: HydrationEvidence,
    preferredName: string | null,
  ): string {
    if (intent === COACH_PROACTIVE_INTENTS.HYDRATION_CHECK) {
      if (
        outcome === CoachProactiveWorkoutOutcome.COMPLETED &&
        hydrationEvidence === 'GOAL_COMPLETED'
      )
        return `${this.acknowledgment('Boa', preferredName)} Meta de hidratação concluída hoje. Continue distribuindo a água ao longo do dia 💧`;
      if (outcome === CoachProactiveWorkoutOutcome.COMPLETED)
        return `${this.acknowledgment('Boa', preferredName)} Continue mantendo a hidratação distribuída ao longo do dia 💧`;
      if (outcome === CoachProactiveWorkoutOutcome.PARTIAL)
        return `${this.acknowledgment('Entendi', preferredName)} Vale deixar a garrafa por perto e seguir com pequenos goles ao longo do dia, sem tentar compensar tudo de uma vez.`;
      return 'Tudo bem. Comece com alguns goles quando puder e deixe a garrafa por perto; constância costuma funcionar melhor que beber muito de uma vez.';
    }
    if (intent === COACH_PROACTIVE_INTENTS.MEAL_PLAN_CHECK) {
      return outcome === CoachProactiveWorkoutOutcome.COMPLETED
        ? `${this.acknowledgment('Boa', preferredName)} Continue seguindo o plano alimentar ao longo do restante do dia.`
        : `${this.acknowledgment('Entendi', preferredName)} Vamos retomar o plano na próxima refeição possível, sem compensações exageradas.`;
    }
    if (
      intent === COACH_PROACTIVE_INTENTS.LUNCH_CHECK ||
      intent === COACH_PROACTIVE_INTENTS.DINNER_CHECK
    ) {
      const meal =
        intent === COACH_PROACTIVE_INTENTS.DINNER_CHECK ? 'jantar' : 'almoço';
      return outcome === CoachProactiveWorkoutOutcome.COMPLETED
        ? `${meal === 'jantar' ? 'Boa, jantar feito' : 'Boa, almoço feito'}! Siga o restante do dia com tranquilidade e consistência.`
        : `Tranquilo. Quando conseguir parar, priorize seu ${meal} sem culpa e sem tentar compensar de forma exagerada.`;
    }
    if (
      intent === COACH_PROACTIVE_INTENTS.DAILY_CHECK_IN ||
      intent === COACH_PROACTIVE_INTENTS.GOOD_MORNING
    ) {
      return outcome === CoachProactiveWorkoutOutcome.PARTIAL
        ? 'Entendi. Vamos respeitar seu ritmo hoje e focar no próximo passo que couber de forma realista.'
        : 'Que bom! Vamos manter esse ritmo com um passo de cada vez ao longo do dia.';
    }
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

  private classification(
    outcome: CoachProactiveWorkoutOutcome,
    hydrationEvidence: HydrationEvidence = null,
  ): ProactiveResponseClassification {
    return Object.freeze({ outcome, hydrationEvidence });
  }

  private acknowledgment(
    value: 'Boa' | 'Entendi',
    name: string | null,
  ): string {
    return name ? `${value}, ${name}!` : `${value}!`;
  }

  private preferredName(value: string | null): string | null {
    return value?.trim().split(/\s+/u, 1)[0] || null;
  }

  private memorySummary(
    intent: CoachProactiveIntent,
    outcome: CoachProactiveWorkoutOutcome,
    hydrationEvidence: HydrationEvidence,
  ): string {
    if (
      intent === COACH_PROACTIVE_INTENTS.HYDRATION_CHECK &&
      hydrationEvidence === 'WATER_CONSUMED'
    ) {
      return 'Usuário confirmou consumo de água, sem confirmar que atingiu a meta diária de hidratação.';
    }
    if (
      intent === COACH_PROACTIVE_INTENTS.HYDRATION_CHECK &&
      hydrationEvidence === 'GOAL_COMPLETED'
    ) {
      return 'Usuário confirmou explicitamente que concluiu a meta diária de hidratação.';
    }
    return outcome === CoachProactiveWorkoutOutcome.ISSUE_REPORTED
      ? 'Usuário relatou desconforto durante a sessão; requer abordagem de segurança, sem diagnóstico.'
      : `Resposta ao acompanhamento ${intent}: ${outcome}.`;
  }

  private proactiveIntent(
    value: Prisma.JsonValue,
  ): CoachProactiveIntent | null {
    if (!this.isRecord(value) || value.source !== COACH_PROACTIVE_SOURCE) {
      return null;
    }
    const intent = value.intent;
    return typeof intent === 'string' &&
      Object.values(COACH_PROACTIVE_INTENTS).some(
        (candidate) => candidate === intent,
      )
      ? (intent as CoachProactiveIntent)
      : null;
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
