import { Injectable } from '@nestjs/common';
import {
  CoachMessageType,
  CoachProfileAcquisitionCycleStatus,
  CoachProactiveWorkoutOutcome,
  MemoryType,
  MessageDirection,
  MessageType,
  Prisma,
  ScheduledMessageStatus,
  OutboundMessageStatus,
} from '@prisma/client';
import { EventBusService } from '../event-bus/event-bus.service';
import { INTERNAL_EVENT } from '../event-bus/event-bus.constants';
import { PrismaService } from '../prisma/prisma.service';
import { AUTOMATION_RULE_CODES } from './automation.constants';
import {
  COACH_PROACTIVE_INTENTS,
  COACH_PROACTIVE_SOURCE,
  COACH_PROACTIVE_RESPONSE_WINDOW_HOURS,
  type CoachProactiveIntent,
} from './coach-proactive.contract';

const RESPONSE_SOURCE = 'COACH_PROACTIVE_RESPONSE_V1';
const RESPONSE_WINDOW_MS =
  COACH_PROACTIVE_RESPONSE_WINDOW_HOURS * 60 * 60 * 1_000;

type HydrationEvidence = 'GOAL_COMPLETED' | 'WATER_CONSUMED' | null;

interface ProactiveResponseClassification {
  readonly outcome: CoachProactiveWorkoutOutcome;
  readonly hydrationEvidence: HydrationEvidence;
}

export interface CoachProactiveResponseCaptureResult {
  readonly continueInRuntime?: boolean;
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
          select: { userId: true, user: { select: { name: true } } },
        },
      },
    });
    if (
      !message ||
      message.id !== input.messageId ||
      message.conversation.userId !== input.userId
    )
      return this.notHandled();
    const independentCommand = this.isIndependentCommand(message.content);

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
              OR: [
                {
                  sentAt: {
                    gte: new Date(
                      message.timestamp.getTime() - RESPONSE_WINDOW_MS,
                    ),
                    lte: message.timestamp,
                  },
                },
                {
                  sentAt: null,
                  scheduledFor: {
                    gte: new Date(
                      message.timestamp.getTime() - RESPONSE_WINDOW_MS,
                    ),
                    lte: message.timestamp,
                  },
                },
              ],
              context: { path: ['source'], equals: COACH_PROACTIVE_SOURCE },
            }),
      },
      select: {
        id: true,
        userId: true,
        conversationId: true,
        scheduledFor: true,
        sentAt: true,
        responseExpiresAt: true,
        responseMessageId: true,
        responseOutcome: true,
        content: true,
        context: true,
      },
      orderBy: [{ scheduledFor: 'desc' }, { id: 'desc' }],
    });
    if (
      intervention &&
      (intervention.userId !== input.userId ||
        intervention.conversationId !== message.conversationId)
    )
      return this.notHandled();
    const intent = intervention
      ? this.proactiveIntent(intervention.context)
      : null;
    if (!intervention || !intent) {
      return this.notHandled();
    }
    if (
      (intervention.sentAt ?? intervention.scheduledFor) > message.timestamp ||
      (intervention.sentAt ?? intervention.scheduledFor).getTime() +
        RESPONSE_WINDOW_MS <
        message.timestamp.getTime()
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
            status: {
              in: [
                CoachProfileAcquisitionCycleStatus.ASKED,
                CoachProfileAcquisitionCycleStatus.CONFIRMATION_PENDING,
              ],
            },
          },
          select: { id: true },
          orderBy: [{ askedAt: 'desc' }, { id: 'desc' }],
        });
      if (activeProfile) {
        return this.notHandled();
      }
    }

    if (!quoted) {
      const sentAt = intervention.sentAt ?? intervention.scheduledFor;
      const [newerOutbound, newerScheduled] = await Promise.all([
        this.prisma.outboundMessage.findFirst({
          where: {
            userId: input.userId,
            conversationId: message.conversationId,
            status: {
              in: [OutboundMessageStatus.SENT, OutboundMessageStatus.DELIVERED],
            },
            sentAt: { gt: sentAt, lt: message.timestamp },
          },
          select: { id: true },
        }),
        this.prisma.scheduledMessage.findMany({
          where: {
            id: { not: intervention.id },
            userId: input.userId,
            conversationId: message.conversationId,
            status: ScheduledMessageStatus.SENT,
            sentAt: { gt: sentAt, lt: message.timestamp },
          },
          select: { id: true, context: true },
          orderBy: [{ sentAt: 'desc' }, { id: 'desc' }],
          take: 32,
        }),
      ]);
      const intervening = newerScheduled.some(
        (candidate) =>
          !this.isRecord(candidate.context) ||
          candidate.context.source !== RESPONSE_SOURCE ||
          candidate.context.interventionId !== intervention.id,
      );
      if (newerOutbound || intervening) return this.notHandled();
    }
    const classification = independentCommand
      ? null
      : this.classify(intent, message.content, intervention.content);
    if (classification === null)
      return Object.freeze({ ...this.notHandled(), continueInRuntime: true });
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
        WITH advisory_lock AS (
          SELECT pg_advisory_xact_lock(
            hashtext(${`coach-proactive-response:${input.interventionId}`})
          )
        )
        SELECT true AS "locked"
        FROM advisory_lock
      `;
      const current = await transaction.scheduledMessage.findUnique({
        where: { id: input.interventionId },
        select: {
          userId: true,
          conversationId: true,
          scheduledFor: true,
          sentAt: true,
          responseMessageId: true,
          responseOutcome: true,
          respondedAt: true,
          responseExpiresAt: true,
          context: true,
        },
      });
      if (!current) return this.notHandled();
      if (
        current.userId !== input.userId ||
        current.conversationId !== input.message.conversationId
      )
        return this.notHandled();
      const replay = await transaction.coachMessage.findUnique({
        where: {
          idempotencyKey: `proactive-response:${input.interventionId}:${input.message.id}`,
        },
        select: { id: true },
      });
      const mutable =
        current.responseOutcome === CoachProactiveWorkoutOutcome.DEFERRED ||
        current.responseOutcome === CoachProactiveWorkoutOutcome.UNKNOWN;
      const terminal =
        input.outcome !== CoachProactiveWorkoutOutcome.DEFERRED &&
        input.outcome !== CoachProactiveWorkoutOutcome.UNKNOWN;
      const allowedTransition =
        mutable &&
        terminal &&
        (current.responseOutcome !== CoachProactiveWorkoutOutcome.DEFERRED ||
          input.outcome === CoachProactiveWorkoutOutcome.COMPLETED ||
          input.outcome === CoachProactiveWorkoutOutcome.SKIPPED);
      if (
        replay ||
        current.responseMessageId === input.message.id ||
        (current.responseMessageId &&
          (!allowedTransition ||
            (current.respondedAt &&
              current.respondedAt >= input.message.timestamp)))
      ) {
        return Object.freeze({
          handled: true,
          duplicated: true,
          outcome: current.responseOutcome ?? input.outcome,
        });
      }
      if (
        (current.sentAt ?? current.scheduledFor) > input.message.timestamp ||
        (current.sentAt ?? current.scheduledFor).getTime() +
          RESPONSE_WINDOW_MS <
          input.message.timestamp.getTime()
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
            sourceKey: `proactive-workout:${input.interventionId}:${input.message.id}`,
          },
        },
        update: {},
        create: {
          userId: input.userId,
          memoryType: MemoryType.SHORT_TERM,
          sourceKey: `proactive-workout:${input.interventionId}:${input.message.id}`,
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
          idempotencyKey: `proactive-response:${input.interventionId}:${input.message.id}`,
        },
        update: {},
        create: {
          userId: input.userId,
          type: CoachMessageType.FOLLOW_UP,
          idempotencyKey: `proactive-response:${input.interventionId}:${input.message.id}`,
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
    reminderContent = '',
  ): ProactiveResponseClassification | null {
    const text = this.normalize(value);
    if (!text) return null;
    const meal = [
      COACH_PROACTIVE_INTENTS.LUNCH_CHECK,
      COACH_PROACTIVE_INTENTS.DINNER_CHECK,
      COACH_PROACTIVE_INTENTS.MEAL_PLAN_CHECK,
    ].some((candidate) => candidate === intent);
    if (meal && /\bcomi outra coisa\b/u.test(text))
      return this.classification(CoachProactiveWorkoutOutcome.PARTIAL);
    if (/^(sim|nao|ok)$/u.test(text)) {
      const question = this.normalize(reminderContent);
      const explicitCompletionQuestion =
        /\b(conseguiu|concluiu|terminou|ja fez|ja treinou|ja comeu|ja almocou|ja jantou)\b/u.test(
          question,
        );
      if (text === 'ok' || !explicitCompletionQuestion)
        return this.classification(CoachProactiveWorkoutOutcome.UNKNOWN);
      return this.classification(
        text === 'sim'
          ? CoachProactiveWorkoutOutcome.COMPLETED
          : CoachProactiveWorkoutOutcome.SKIPPED,
        text === 'sim' && intent === COACH_PROACTIVE_INTENTS.HYDRATION_CHECK
          ? 'WATER_CONSUMED'
          : null,
      );
    }
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
    if (
      intent === COACH_PROACTIVE_INTENTS.HYDRATION_CHECK &&
      /\b(?:encher|enchi) (?:minha |a )?garrafa\b/u.test(text)
    ) {
      return this.classification(CoachProactiveWorkoutOutcome.DEFERRED);
    }
    if (
      /\b(vou fazer|mais tarde|depois eu faco|faco mais tarde|adiei|adiar)\b/u.test(
        text,
      )
    ) {
      return this.classification(CoachProactiveWorkoutOutcome.DEFERRED);
    }
    if (
      /\b(ainda nao|nao consegui|nao deu|hoje nao|nao fiz|nao treinei|nao comi|nao jantei|nao almoco|nao almocei|pulei)\b/u.test(
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
      /\b(ja bebi|bebi agua|estou bebendo|to bebendo|consegui beber|tomei (?:uns? )?\d+\s*(?:ml|litros?))\b/u.test(
        text,
      )
    ) {
      return this.classification(
        CoachProactiveWorkoutOutcome.COMPLETED,
        'WATER_CONSUMED',
      );
    }
    if (
      /\b(fiz tudo|completei|conclui|terminei|foi otimo|bati a meta|estou bem|to bem|bom dia)\b/u.test(
        text,
      )
    ) {
      return this.classification(CoachProactiveWorkoutOutcome.COMPLETED);
    }
    if (
      (intent === COACH_PROACTIVE_INTENTS.WORKOUT_CHECK &&
        /\b(fiz|feito|treinei)\b/u.test(text)) ||
      (meal && /\b(comi|almocei|jantei|feito|segui o plano)\b/u.test(text)) ||
      (intent === COACH_PROACTIVE_INTENTS.GOOD_MORNING &&
        /\btomei cafe da manha\b/u.test(text))
    )
      return this.classification(CoachProactiveWorkoutOutcome.COMPLETED);
    if (/^ja\b/u.test(text))
      return this.classification(CoachProactiveWorkoutOutcome.UNKNOWN);
    if (
      /\b(cansad[oa]|exaust[oa]|sem energia|hoje esta corrido)\b/u.test(text)
    ) {
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
    if (outcome === CoachProactiveWorkoutOutcome.UNKNOWN)
      return 'Você concluiu o que combinamos, fez só uma parte ou precisou adiar? Me conte para eu registrar corretamente.';
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
