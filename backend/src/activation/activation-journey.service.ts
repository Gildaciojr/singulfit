import { Injectable, Logger } from '@nestjs/common';
import {
  ActivationDeliveryStatus,
  ActivationEventKind,
  ActivationStage,
  Prisma,
  Severity,
  SubscriptionStatus,
} from '@prisma/client';
import { EvolutionGateway } from '../evolution/evolution.gateway';
import { EventService } from '../observability/event.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConversationsService } from '../whatsapp/conversations.service';
import {
  ACTIVATION_FLOW_DAYS,
  ACTIVATION_RECOVERY_HOURS,
  ACTIVATION_SOURCE,
  ACTIVATION_SYSTEM_EVENT,
  TERMINAL_ACTIVATION_STAGES,
} from './activation.constants';
import { ActivationScoreService } from './activation-score.service';
import { ActivationService } from './activation.service';

const MESSAGE_COOLDOWN_MS = 12 * 3_600_000;
const DELIVERY_LEASE_MS = 60_000;

@Injectable()
export class ActivationJourneyService {
  private readonly logger = new Logger(ActivationJourneyService.name);
  private cursor?: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly activationService: ActivationService,
    private readonly scores: ActivationScoreService,
    private readonly conversations: ConversationsService,
    private readonly evolution: EvolutionGateway,
    private readonly events: EventService,
  ) {}

  async processDue(at = new Date(), limit = 100): Promise<number> {
    const users = await this.prisma.user.findMany({
      where: {
        isActive: true,
        OR: [
          { activation: null },
          {
            activation: {
              is: {
                currentStage: {
                  notIn: [ActivationStage.ACTIVATED, ActivationStage.ABANDONED],
                },
              },
            },
          },
        ],
      },
      select: { id: true },
      orderBy: { id: 'asc' },
      take: limit,
      ...(this.cursor
        ? {
            cursor: { id: this.cursor },
            skip: 1,
          }
        : {}),
    });

    if (users.length === 0 && this.cursor) {
      this.cursor = undefined;
      return this.processDue(at, limit);
    }

    for (const user of users) {
      try {
        await this.processUser(user.id, at);
      } catch (error: unknown) {
        this.logger.warn(
          `Falha ao reconciliar ativação do usuário ${user.id}: ${this.safeError(error)}`,
        );
      }
    }

    this.cursor = users.length === limit ? users.at(-1)?.id : undefined;
    return users.length;
  }

  async processUser(userId: string, at = new Date()) {
    let activation = await this.activationService.reconcile(userId, at);

    if (TERMINAL_ACTIVATION_STAGES.has(activation.currentStage)) {
      return activation;
    }

    if (
      activation.paidAt &&
      !activation.whatsappConnectedAt &&
      (await this.ensureConversation(userId))
    ) {
      activation = await this.activationService.reconcile(userId, at);
    }

    if (
      activation.paidAt &&
      activation.whatsappConnectedAt &&
      !(await this.hasRecentActivationMessage(userId, at))
    ) {
      const flow = await this.dueFlow(activation, at);

      if (flow !== null) {
        await this.sendMessage(
          activation.id,
          userId,
          ActivationEventKind.FLOW_MESSAGE,
          `D${flow}`,
          `${activation.id}:flow:D${flow}`,
          activation.paidAt,
          at,
        );
        activation = await this.activationService.reconcile(userId, at);
      }
    }

    if (
      !TERMINAL_ACTIVATION_STAGES.has(activation.currentStage) &&
      !(await this.hasRecentActivationMessage(userId, at))
    ) {
      const recovery = await this.dueRecovery(activation, at);

      if (recovery !== null) {
        await this.sendMessage(
          activation.id,
          userId,
          ActivationEventKind.RECOVERY_MESSAGE,
          `RECOVERY_${recovery}H`,
          `${activation.id}:recovery:${activation.currentStage}:${activation.lastProgressAt.getTime()}:${recovery}`,
          new Date(activation.lastProgressAt.getTime() + recovery * 3_600_000),
          at,
        );
      }
    }

    activation = await this.activationService.reconcile(userId, at);

    if (await this.shouldAbandon(activation, at)) {
      activation = await this.activationService.abandon(userId, at);
    }

    await this.activationService.snapshot(userId, at);
    return activation;
  }

  private async ensureConversation(userId: string): Promise<boolean> {
    const subscription = await this.prisma.subscription.findFirst({
      where: { userId, status: SubscriptionStatus.ACTIVE },
      select: { id: true },
      orderBy: { createdAt: 'desc' },
    });

    if (!subscription) {
      return false;
    }

    await this.conversations.getOrCreateActive(userId, {
      subscriptionId: subscription.id,
    });
    return true;
  }

  private async dueFlow(
    activation: {
      id: string;
      paidAt: Date | null;
    },
    at: Date,
  ): Promise<(typeof ACTIVATION_FLOW_DAYS)[number] | null> {
    if (!activation.paidAt) {
      return null;
    }

    const elapsedDays = Math.floor(
      (at.getTime() - activation.paidAt.getTime()) / 86_400_000,
    );
    const due = ACTIVATION_FLOW_DAYS.filter((day) => day <= elapsedDays).sort(
      (left, right) => right - left,
    );

    for (const day of due) {
      const existing = await this.prisma.activationEvent.findUnique({
        where: { idempotencyKey: `${activation.id}:flow:D${day}` },
        select: { deliveryStatus: true, leaseExpiresAt: true },
      });

      if (
        !existing ||
        existing.deliveryStatus === ActivationDeliveryStatus.FAILED ||
        existing.deliveryStatus === ActivationDeliveryStatus.PENDING ||
        (existing.deliveryStatus === ActivationDeliveryStatus.SENDING &&
          (!existing.leaseExpiresAt || existing.leaseExpiresAt <= at))
      ) {
        return day;
      }
    }

    return null;
  }

  private async dueRecovery(
    activation: {
      id: string;
      currentStage: ActivationStage;
      lastProgressAt: Date;
    },
    at: Date,
  ): Promise<(typeof ACTIVATION_RECOVERY_HOURS)[number] | null> {
    const stalledHours = this.scores.stalledHours(
      activation.lastProgressAt,
      at,
    );

    for (const hours of [...ACTIVATION_RECOVERY_HOURS].reverse()) {
      if (hours > stalledHours) {
        continue;
      }

      const idempotencyKey = `${activation.id}:recovery:${activation.currentStage}:${activation.lastProgressAt.getTime()}:${hours}`;
      const existing = await this.prisma.activationEvent.findUnique({
        where: { idempotencyKey },
        select: { deliveryStatus: true, leaseExpiresAt: true },
      });

      if (
        !existing ||
        existing.deliveryStatus === ActivationDeliveryStatus.FAILED ||
        existing.deliveryStatus === ActivationDeliveryStatus.PENDING ||
        (existing.deliveryStatus === ActivationDeliveryStatus.SENDING &&
          (!existing.leaseExpiresAt || existing.leaseExpiresAt <= at))
      ) {
        return hours;
      }
    }

    return null;
  }

  private async sendMessage(
    activationId: string,
    userId: string,
    kind: 'FLOW_MESSAGE' | 'RECOVERY_MESSAGE',
    eventCode: string,
    idempotencyKey: string,
    scheduledFor: Date,
    at: Date,
  ): Promise<void> {
    const message = await this.buildMessage(userId, eventCode);
    const event = await this.prisma.activationEvent.upsert({
      where: { idempotencyKey },
      update: {},
      create: {
        activationId,
        userId,
        kind,
        eventCode,
        idempotencyKey,
        source: ACTIVATION_SOURCE,
        occurredAt: at,
        scheduledFor,
        deliveryStatus: ActivationDeliveryStatus.PENDING,
        metadata: message.metadata,
      },
    });
    const claimed = await this.claimDelivery(event.id, at);

    if (!claimed) {
      return;
    }

    try {
      const sent = await this.evolution.sendText({
        number: message.phone,
        text: message.content,
      });

      await this.prisma.activationEvent.updateMany({
        where: {
          id: event.id,
          deliveryStatus: ActivationDeliveryStatus.SENDING,
        },
        data: {
          deliveryStatus: ActivationDeliveryStatus.SENT,
          sentAt: new Date(),
          externalMessageId: sent.externalMessageId,
          leaseExpiresAt: null,
          failedAt: null,
          errorMessage: null,
        },
      });

      if (kind === ActivationEventKind.RECOVERY_MESSAGE) {
        await this.events.record({
          source: ACTIVATION_SOURCE,
          severity: Severity.WARNING,
          eventType: ACTIVATION_SYSTEM_EVENT.REENGAGEMENT,
          message: 'Mensagem contextual de reengajamento enviada',
          metadata: {
            userId,
            activationId,
            activationEventId: event.id,
            eventCode,
          },
        });
      }
    } catch (error: unknown) {
      await this.prisma.activationEvent.updateMany({
        where: {
          id: event.id,
          deliveryStatus: ActivationDeliveryStatus.SENDING,
        },
        data: {
          deliveryStatus: ActivationDeliveryStatus.FAILED,
          failedAt: new Date(),
          leaseExpiresAt: null,
          errorMessage: this.safeError(error),
        },
      });
      throw error;
    }
  }

  private claimDelivery(eventId: string, at: Date) {
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        WITH advisory_lock AS (
          SELECT pg_advisory_xact_lock(hashtext(${`activation-delivery:${eventId}`}))
        )
        SELECT true AS "locked"
        FROM advisory_lock
      `;
      const event = await transaction.activationEvent.findUnique({
        where: { id: eventId },
      });

      if (
        !event ||
        event.deliveryStatus === ActivationDeliveryStatus.SENT ||
        (event.deliveryStatus === ActivationDeliveryStatus.SENDING &&
          event.leaseExpiresAt &&
          event.leaseExpiresAt > at)
      ) {
        return false;
      }

      await transaction.activationEvent.update({
        where: { id: eventId },
        data: {
          deliveryStatus: ActivationDeliveryStatus.SENDING,
          attempts: { increment: 1 },
          leaseExpiresAt: new Date(at.getTime() + DELIVERY_LEASE_MS),
          failedAt: null,
          errorMessage: null,
        },
      });
      return true;
    });
  }

  private async buildMessage(userId: string, eventCode: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        name: true,
        phone: true,
        phoneE164: true,
        activation: {
          select: {
            currentStage: true,
            score: true,
            riskLevel: true,
          },
        },
        behavioralProfile: {
          select: {
            communicationStyle: true,
            motivationStyle: true,
          },
        },
        goalClassification: {
          select: { goal: true },
        },
        contextSnapshots: {
          select: {
            goal: true,
            messagesLast7Days: true,
            nutritionAnalysesCount: true,
          },
          orderBy: { generatedAt: 'desc' },
          take: 1,
        },
        recommendations: {
          select: {
            title: true,
            description: true,
          },
          where: { status: 'ACTIVE' },
          orderBy: [{ priority: 'desc' }, { generatedAt: 'desc' }],
          take: 1,
        },
        coachProfile: {
          select: {
            coachingStyle: true,
            tone: true,
          },
        },
      },
    });
    const activation = user.activation;
    const name = user.name?.trim().split(/\s+/, 1)[0] || 'você';
    const goal =
      user.goalClassification?.goal ?? user.contextSnapshots[0]?.goal ?? null;
    const nextAction = this.nextAction(
      activation?.currentStage ?? ActivationStage.REGISTERED,
    );
    const recommendation = user.recommendations[0];
    const contextLine = [
      goal ? `Seu objetivo ${this.goalLabel(goal)} segue como referência.` : '',
      recommendation
        ? `${recommendation.title}: ${recommendation.description}`
        : '',
    ]
      .filter(Boolean)
      .join(' ');
    const content = this.messageTemplate(
      eventCode,
      name,
      nextAction,
      contextLine,
      activation?.score ?? 0,
    );

    return {
      phone: user.phoneE164 ?? user.phone,
      content,
      metadata: {
        stage: activation?.currentStage ?? ActivationStage.REGISTERED,
        score: activation?.score ?? 0,
        riskLevel: activation?.riskLevel ?? null,
        goal,
        behavioralCommunicationStyle:
          user.behavioralProfile?.communicationStyle ?? null,
        behavioralMotivationStyle:
          user.behavioralProfile?.motivationStyle ?? null,
        coachStyle: user.coachProfile?.coachingStyle ?? null,
        coachTone: user.coachProfile?.tone ?? null,
        contextSnapshotUsed: user.contextSnapshots.length > 0,
        recommendationUsed: Boolean(recommendation),
        coachContextUsed: true,
        nextAction,
      } satisfies Prisma.InputJsonObject,
    };
  }

  private messageTemplate(
    code: string,
    name: string,
    nextAction: string,
    context: string,
    score: number,
  ): string {
    const suffix = context ? ` ${context}` : '';

    switch (code) {
      case 'D0':
        return `${name}, sua assinatura está ativa. Vamos transformar isso em resultado real: ${nextAction}${suffix}`;
      case 'D1':
        return `${name}, seu progresso de ativação está em ${score}/100. O passo mais útil agora é: ${nextAction}${suffix}`;
      case 'D3':
        return `${name}, observei onde sua jornada parou. Vamos reduzir a fricção: ${nextAction}${suffix}`;
      case 'D5':
        return `${name}, já temos contexto suficiente para orientar o próximo passo sem generalidades: ${nextAction}${suffix}`;
      case 'D7':
        return `${name}, uma semana de acompanhamento merece uma ação concreta. Hoje, faça isto: ${nextAction}${suffix}`;
      case 'RECOVERY_24H':
        return `${name}, faz um dia desde seu último avanço. Retome pelo menor passo possível: ${nextAction}${suffix}`;
      case 'RECOVERY_72H':
        return `${name}, sua jornada ficou parada por três dias. Não precisa recomeçar; continue daqui: ${nextAction}${suffix}`;
      case 'RECOVERY_168H':
        return `${name}, passou uma semana sem avanço. Vamos proteger o que você já construiu com uma ação simples: ${nextAction}${suffix}`;
      case 'RECOVERY_336H':
        return `${name}, este é nosso lembrete de retomada após 14 dias. Se ainda fizer sentido para você, o próximo passo é: ${nextAction}${suffix}`;
      default:
        return `${name}, continue sua jornada com esta ação: ${nextAction}${suffix}`;
    }
  }

  private nextAction(stage: ActivationStage): string {
    switch (stage) {
      case ActivationStage.REGISTERED:
        return 'conclua o pagamento para liberar o acompanhamento';
      case ActivationStage.PAID:
        return 'confirme este WhatsApp respondendo à mensagem';
      case ActivationStage.WHATSAPP_CONNECTED:
      case ActivationStage.FIRST_MESSAGE_SENT:
        return 'envie uma foto nítida da sua próxima refeição';
      case ActivationStage.FIRST_MEAL_RECEIVED:
        return 'aguarde a análise e mantenha a conversa aberta';
      case ActivationStage.FIRST_ANALYSIS_COMPLETED:
        return 'leia a análise e escolha uma recomendação aplicável hoje';
      case ActivationStage.FIRST_RECOMMENDATION_DELIVERED:
        return 'responda contando qual recomendação cabe melhor na sua rotina';
      case ActivationStage.FIRST_COACH_INTERACTION:
        return 'mantenha o próximo registro para consolidar o hábito';
      case ActivationStage.ACTIVATED:
        return 'continue registrando suas refeições e interações';
      case ActivationStage.ABANDONED:
        return 'fale com o suporte para retomar a jornada';
    }
  }

  private goalLabel(goal: string): string {
    const labels: Record<string, string> = {
      WEIGHT_LOSS: 'de redução de peso',
      HYPERTROPHY: 'de hipertrofia',
      MUSCLE_GAIN: 'de ganho de massa',
      MAINTENANCE: 'de manutenção',
      HEALTH: 'de saúde e bem-estar',
    };

    return labels[goal] ?? 'pessoal';
  }

  private hasRecentActivationMessage(userId: string, at: Date) {
    return this.prisma.activationEvent
      .findFirst({
        where: {
          userId,
          kind: {
            in: [
              ActivationEventKind.FLOW_MESSAGE,
              ActivationEventKind.RECOVERY_MESSAGE,
            ],
          },
          sentAt: {
            gte: new Date(at.getTime() - MESSAGE_COOLDOWN_MS),
          },
        },
        select: { id: true },
      })
      .then(Boolean);
  }

  private async shouldAbandon(
    activation: {
      id: string;
      currentStage: ActivationStage;
      lastProgressAt: Date;
    },
    at: Date,
  ): Promise<boolean> {
    if (
      TERMINAL_ACTIVATION_STAGES.has(activation.currentStage) ||
      this.scores.stalledHours(activation.lastProgressAt, at) < 336
    ) {
      return false;
    }

    const event = await this.prisma.activationEvent.findUnique({
      where: {
        idempotencyKey: `${activation.id}:recovery:${activation.currentStage}:${activation.lastProgressAt.getTime()}:336`,
      },
      select: { deliveryStatus: true },
    });

    return event?.deliveryStatus === ActivationDeliveryStatus.SENT;
  }

  private safeError(error: unknown): string {
    return error instanceof Error && error.message.trim()
      ? error.message.trim().slice(0, 2_000)
      : 'Falha não identificada na jornada de ativação';
  }
}
