import { Injectable, NotFoundException } from '@nestjs/common';
import {
  ActivationEventKind,
  ActivationRiskLevel,
  ActivationStage,
  MealAnalysisStatus,
  MessageDirection,
  OutboundMessageStatus,
  Prisma,
  RecommendationStatus,
  ResponseType,
  ScheduledMessageStatus,
  Severity,
  SubscriptionStatus,
  UserActivation,
} from '@prisma/client';
import { EventService } from '../observability/event.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  ACTIVATION_SOURCE,
  ACTIVATION_STAGE_ORDER,
  ACTIVATION_SYSTEM_EVENT,
  TERMINAL_ACTIVATION_STAGES,
} from './activation.constants';
import { ActivationScoreService } from './activation-score.service';

interface ActivationFacts {
  paidAt: Date | null;
  whatsappConnectedAt: Date | null;
  firstMessageSentAt: Date | null;
  firstMealReceivedAt: Date | null;
  firstAnalysisCompletedAt: Date | null;
  firstRecommendationDeliveredAt: Date | null;
  firstCoachInteractionAt: Date | null;
  firstValueAt: Date | null;
  firstValueSource: string | null;
}

@Injectable()
export class ActivationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scores: ActivationScoreService,
    private readonly events: EventService,
  ) {}

  async reconcile(userId: string, at = new Date()): Promise<UserActivation> {
    await this.ensureStarted(userId);
    const facts = await this.collectFacts(userId);

    return this.prisma.$transaction(
      async (transaction) => {
        await this.lock(transaction, userId);
        let activation = await transaction.userActivation.findUniqueOrThrow({
          where: { userId },
        });

        if (TERMINAL_ACTIVATION_STAGES.has(activation.currentStage)) {
          await this.persistSnapshot(transaction, activation, at);
          return activation;
        }

        const target = this.targetStage(facts);
        const currentIndex = ACTIVATION_STAGE_ORDER.indexOf(
          activation.currentStage,
        );
        const targetIndex = ACTIVATION_STAGE_ORDER.indexOf(target);

        for (let index = currentIndex + 1; index <= targetIndex; index += 1) {
          activation = await this.transition(
            transaction,
            activation,
            ACTIVATION_STAGE_ORDER[index],
            facts,
          );
        }

        activation = await this.recordFirstValue(
          transaction,
          activation,
          facts,
        );
        activation = await this.updateScoreAndRisk(transaction, activation, at);
        await this.persistSnapshot(transaction, activation, at);

        return activation;
      },
      {
        maxWait: 5_000,
        timeout: 20_000,
      },
    );
  }

  async abandon(userId: string, at = new Date()): Promise<UserActivation> {
    return this.prisma.$transaction(async (transaction) => {
      await this.lock(transaction, userId);
      const current = await transaction.userActivation.findUniqueOrThrow({
        where: { userId },
      });

      if (TERMINAL_ACTIVATION_STAGES.has(current.currentStage)) {
        return current;
      }

      const activation = await transaction.userActivation.update({
        where: { id: current.id },
        data: {
          currentStage: ActivationStage.ABANDONED,
          riskLevel: ActivationRiskLevel.HIGH,
          abandonedAt: at,
          lastProgressAt: at,
        },
      });

      await transaction.activationEvent.create({
        data: {
          activationId: activation.id,
          userId,
          kind: ActivationEventKind.STAGE_TRANSITION,
          eventCode: ACTIVATION_SYSTEM_EVENT.ABANDONED,
          idempotencyKey: `${activation.id}:stage:ABANDONED`,
          fromStage: current.currentStage,
          toStage: ActivationStage.ABANDONED,
          source: ACTIVATION_SOURCE,
          occurredAt: at,
          durationFromPreviousSeconds: this.durationSeconds(
            current.lastProgressAt,
            at,
          ),
        },
      });
      await this.events.recordInTransaction(transaction, {
        source: ACTIVATION_SOURCE,
        severity: Severity.WARNING,
        eventType: ACTIVATION_SYSTEM_EVENT.ABANDONED,
        message: 'Jornada de ativação marcada como abandonada',
        metadata: {
          userId,
          activationId: activation.id,
          previousStage: current.currentStage,
        },
      });
      await this.persistSnapshot(transaction, activation, at);

      return activation;
    });
  }

  async snapshot(userId: string, at = new Date()) {
    const activation = await this.prisma.userActivation.findUnique({
      where: { userId },
    });

    if (!activation) {
      throw new NotFoundException('Jornada de ativação não encontrada');
    }

    return this.prisma.$transaction((transaction) =>
      this.persistSnapshot(transaction, activation, at),
    );
  }

  private async ensureStarted(userId: string): Promise<UserActivation> {
    const existing = await this.prisma.userActivation.findUnique({
      where: { userId },
    });

    if (existing) {
      return existing;
    }

    return this.prisma.$transaction(async (transaction) => {
      await this.lock(transaction, userId);
      const concurrent = await transaction.userActivation.findUnique({
        where: { userId },
      });

      if (concurrent) {
        return concurrent;
      }

      const user = await transaction.user.findUnique({
        where: { id: userId },
        select: { id: true, createdAt: true },
      });

      if (!user) {
        throw new NotFoundException('Usuário não encontrado');
      }

      const activation = await transaction.userActivation.create({
        data: {
          userId,
          registeredAt: user.createdAt,
          lastProgressAt: user.createdAt,
        },
      });
      await transaction.activationEvent.create({
        data: {
          activationId: activation.id,
          userId,
          kind: ActivationEventKind.STAGE_TRANSITION,
          eventCode: ACTIVATION_SYSTEM_EVENT.STARTED,
          idempotencyKey: `${activation.id}:stage:REGISTERED`,
          toStage: ActivationStage.REGISTERED,
          source: ACTIVATION_SOURCE,
          occurredAt: user.createdAt,
        },
      });
      await this.events.recordInTransaction(transaction, {
        source: ACTIVATION_SOURCE,
        severity: Severity.INFO,
        eventType: ACTIVATION_SYSTEM_EVENT.STARTED,
        message: 'Jornada de ativação iniciada',
        metadata: {
          userId,
          activationId: activation.id,
          registeredAt: user.createdAt.toISOString(),
        },
      });

      return activation;
    });
  }

  private async collectFacts(userId: string): Promise<ActivationFacts> {
    const [
      subscription,
      conversation,
      activationMessage,
      outbound,
      scheduled,
      meal,
      analysis,
      nutritionResponse,
      acceptedRecommendation,
      qualityScore,
      coachMessage,
    ] = await Promise.all([
      this.prisma.subscription.findFirst({
        where: { userId, status: SubscriptionStatus.ACTIVE },
        select: { paidAt: true, startedAt: true },
        orderBy: [{ paidAt: 'asc' }, { createdAt: 'asc' }],
      }),
      this.prisma.conversation.findFirst({
        where: { userId },
        select: { createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.activationEvent.findFirst({
        where: {
          userId,
          kind: {
            in: [
              ActivationEventKind.FLOW_MESSAGE,
              ActivationEventKind.RECOVERY_MESSAGE,
            ],
          },
          sentAt: { not: null },
        },
        select: { sentAt: true },
        orderBy: { sentAt: 'asc' },
      }),
      this.prisma.outboundMessage.findFirst({
        where: {
          userId,
          status: {
            in: [OutboundMessageStatus.SENT, OutboundMessageStatus.DELIVERED],
          },
          sentAt: { not: null },
        },
        select: { sentAt: true },
        orderBy: { sentAt: 'asc' },
      }),
      this.prisma.scheduledMessage.findFirst({
        where: { userId, status: ScheduledMessageStatus.SENT },
        select: { scheduledFor: true },
        orderBy: { scheduledFor: 'asc' },
      }),
      this.prisma.meal.findFirst({
        where: { userId },
        select: { createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.mealAnalysis.findFirst({
        where: {
          status: MealAnalysisStatus.COMPLETED,
          meal: { userId },
        },
        select: { updatedAt: true },
        orderBy: { updatedAt: 'asc' },
      }),
      this.prisma.outboundMessage.findFirst({
        where: {
          userId,
          responseType: ResponseType.NUTRITION_ANALYSIS,
          status: {
            in: [OutboundMessageStatus.SENT, OutboundMessageStatus.DELIVERED],
          },
          sentAt: { not: null },
        },
        select: { sentAt: true },
        orderBy: { sentAt: 'asc' },
      }),
      this.prisma.recommendation.findFirst({
        where: { userId, status: RecommendationStatus.ACCEPTED },
        select: { acceptedAt: true },
        orderBy: { acceptedAt: 'asc' },
      }),
      this.prisma.nutritionQualityScore.findFirst({
        where: { userId },
        select: { calculatedAt: true },
        orderBy: { calculatedAt: 'asc' },
      }),
      this.prisma.coachMessage.findFirst({
        where: { userId },
        select: { generatedAt: true },
        orderBy: { generatedAt: 'asc' },
      }),
    ]);
    const firstSentAt = this.earliest([
      activationMessage?.sentAt,
      outbound?.sentAt,
      scheduled?.scheduledFor,
    ]);
    const coachPromptAt = this.earliest([
      coachMessage?.generatedAt,
      activationMessage?.sentAt,
    ]);
    const coachInteraction = coachPromptAt
      ? await this.prisma.message.findFirst({
          where: {
            direction: MessageDirection.INBOUND,
            timestamp: { gt: coachPromptAt },
            conversation: { userId },
          },
          select: { timestamp: true },
          orderBy: { timestamp: 'asc' },
        })
      : null;
    const firstValueCandidates = [
      qualityScore
        ? {
            at: qualityScore.calculatedAt,
            source: 'USEFUL_ANALYSIS',
          }
        : null,
      acceptedRecommendation?.acceptedAt
        ? {
            at: acceptedRecommendation.acceptedAt,
            source: 'RECOMMENDATION_ACCEPTED',
          }
        : null,
      coachInteraction
        ? {
            at: coachInteraction.timestamp,
            source: 'POSITIVE_INTERACTION',
          }
        : null,
    ]
      .filter(
        (candidate): candidate is { at: Date; source: string } =>
          candidate !== null,
      )
      .sort((left, right) => left.at.getTime() - right.at.getTime());

    return {
      paidAt: subscription?.paidAt ?? subscription?.startedAt ?? null,
      whatsappConnectedAt: conversation?.createdAt ?? null,
      firstMessageSentAt: firstSentAt,
      firstMealReceivedAt: meal?.createdAt ?? null,
      firstAnalysisCompletedAt: analysis?.updatedAt ?? null,
      firstRecommendationDeliveredAt: nutritionResponse?.sentAt ?? null,
      firstCoachInteractionAt: coachInteraction?.timestamp ?? null,
      firstValueAt: firstValueCandidates[0]?.at ?? null,
      firstValueSource: firstValueCandidates[0]?.source ?? null,
    };
  }

  private targetStage(facts: ActivationFacts): ActivationStage {
    if (!facts.paidAt) return ActivationStage.REGISTERED;
    if (!facts.whatsappConnectedAt) return ActivationStage.PAID;
    if (!facts.firstMessageSentAt) return ActivationStage.WHATSAPP_CONNECTED;
    if (!facts.firstMealReceivedAt) return ActivationStage.FIRST_MESSAGE_SENT;
    if (!facts.firstAnalysisCompletedAt)
      return ActivationStage.FIRST_MEAL_RECEIVED;
    if (!facts.firstRecommendationDeliveredAt)
      return ActivationStage.FIRST_ANALYSIS_COMPLETED;
    if (!facts.firstCoachInteractionAt)
      return ActivationStage.FIRST_RECOMMENDATION_DELIVERED;
    return ActivationStage.ACTIVATED;
  }

  private async transition(
    transaction: Prisma.TransactionClient,
    current: UserActivation,
    stage: ActivationStage,
    facts: ActivationFacts,
  ): Promise<UserActivation> {
    const factAt =
      stage === ActivationStage.ACTIVATED
        ? (facts.firstCoachInteractionAt ?? new Date())
        : this.stageTimestamp(stage, facts);
    const occurredAt = new Date(
      Math.max(current.lastProgressAt.getTime(), factAt.getTime()),
    );
    const data = this.stageData(stage, occurredAt);
    const activation = await transaction.userActivation.update({
      where: { id: current.id },
      data: {
        ...data,
        currentStage: stage,
        lastProgressAt: occurredAt,
      },
    });
    const eventType =
      stage === ActivationStage.ACTIVATED
        ? ACTIVATION_SYSTEM_EVENT.ACTIVATED
        : ACTIVATION_SYSTEM_EVENT.PROGRESS;

    await transaction.activationEvent.create({
      data: {
        activationId: current.id,
        userId: current.userId,
        kind: ActivationEventKind.STAGE_TRANSITION,
        eventCode: eventType,
        idempotencyKey: `${current.id}:stage:${stage}`,
        fromStage: current.currentStage,
        toStage: stage,
        source: ACTIVATION_SOURCE,
        occurredAt,
        durationFromPreviousSeconds: this.durationSeconds(
          current.lastProgressAt,
          occurredAt,
        ),
      },
    });
    await this.events.recordInTransaction(transaction, {
      source: ACTIVATION_SOURCE,
      severity: Severity.INFO,
      eventType,
      message:
        stage === ActivationStage.ACTIVATED
          ? 'Usuário ativado'
          : 'Usuário avançou na jornada de ativação',
      metadata: {
        userId: current.userId,
        activationId: current.id,
        previousStage: current.currentStage,
        currentStage: stage,
        durationFromPreviousSeconds: this.durationSeconds(
          current.lastProgressAt,
          occurredAt,
        ),
      },
    });

    return activation;
  }

  private async recordFirstValue(
    transaction: Prisma.TransactionClient,
    activation: UserActivation,
    facts: ActivationFacts,
  ): Promise<UserActivation> {
    if (activation.firstValueAt || !facts.firstValueAt) {
      return activation;
    }

    const updated = await transaction.userActivation.update({
      where: { id: activation.id },
      data: { firstValueAt: facts.firstValueAt },
    });
    await transaction.activationEvent.create({
      data: {
        activationId: activation.id,
        userId: activation.userId,
        kind: ActivationEventKind.FIRST_VALUE,
        eventCode: ACTIVATION_SYSTEM_EVENT.FIRST_VALUE,
        idempotencyKey: `${activation.id}:first-value`,
        source: facts.firstValueSource ?? ACTIVATION_SOURCE,
        occurredAt: facts.firstValueAt,
        metadata: {
          source: facts.firstValueSource ?? 'UNKNOWN',
        },
      },
    });
    await this.events.recordInTransaction(transaction, {
      source: ACTIVATION_SOURCE,
      severity: Severity.INFO,
      eventType: ACTIVATION_SYSTEM_EVENT.FIRST_VALUE,
      message: 'Usuário atingiu a primeira percepção de valor',
      metadata: {
        userId: activation.userId,
        activationId: activation.id,
        source: facts.firstValueSource ?? 'UNKNOWN',
      },
    });

    return updated;
  }

  private async updateScoreAndRisk(
    transaction: Prisma.TransactionClient,
    activation: UserActivation,
    at: Date,
  ): Promise<UserActivation> {
    const score = this.scores.calculate(activation);
    const riskLevel = this.scores.risk(activation, at);

    if (score === activation.score && riskLevel === activation.riskLevel) {
      return activation;
    }

    const updated = await transaction.userActivation.update({
      where: { id: activation.id },
      data: { score, riskLevel },
    });

    if (score !== activation.score) {
      await transaction.activationEvent.create({
        data: {
          activationId: activation.id,
          userId: activation.userId,
          kind: ActivationEventKind.SCORE_UPDATED,
          eventCode: 'ACTIVATION_SCORE_UPDATED',
          idempotencyKey: `${activation.id}:score:${score}`,
          source: ACTIVATION_SOURCE,
          occurredAt: at,
          metadata: {
            previousScore: activation.score,
            score,
          },
        },
      });
    }

    if (riskLevel !== activation.riskLevel) {
      await transaction.activationEvent.create({
        data: {
          activationId: activation.id,
          userId: activation.userId,
          kind: ActivationEventKind.RISK_UPDATED,
          eventCode: 'ACTIVATION_RISK_UPDATED',
          idempotencyKey: `${activation.id}:risk:${riskLevel}:${at.toISOString().slice(0, 13)}`,
          source: ACTIVATION_SOURCE,
          occurredAt: at,
          metadata: {
            previousRisk: activation.riskLevel,
            riskLevel,
          },
        },
      });
    }

    return updated;
  }

  private persistSnapshot(
    transaction: Prisma.TransactionClient,
    activation: UserActivation,
    at: Date,
  ) {
    const snapshotDate = this.utcDay(at);
    const stepDurations = this.stepDurations(activation);
    const finalStatus = TERMINAL_ACTIVATION_STAGES.has(activation.currentStage)
      ? activation.currentStage
      : null;

    return transaction.activationSnapshot.upsert({
      where: {
        userId_snapshotDate: {
          userId: activation.userId,
          snapshotDate,
        },
      },
      update: {
        activationId: activation.id,
        currentStage: activation.currentStage,
        score: activation.score,
        riskLevel: activation.riskLevel,
        stalledHours: this.scores.stalledHours(activation.lastProgressAt, at),
        stepDurations,
        firstValueAt: activation.firstValueAt,
        finalStatus,
        generatedAt: at,
      },
      create: {
        activationId: activation.id,
        userId: activation.userId,
        snapshotDate,
        currentStage: activation.currentStage,
        score: activation.score,
        riskLevel: activation.riskLevel,
        stalledHours: this.scores.stalledHours(activation.lastProgressAt, at),
        stepDurations,
        firstValueAt: activation.firstValueAt,
        finalStatus,
        generatedAt: at,
      },
    });
  }

  private stageTimestamp(stage: ActivationStage, facts: ActivationFacts): Date {
    const timestamps: Partial<Record<ActivationStage, Date | null>> = {
      [ActivationStage.PAID]: facts.paidAt,
      [ActivationStage.WHATSAPP_CONNECTED]: facts.whatsappConnectedAt,
      [ActivationStage.FIRST_MESSAGE_SENT]: facts.firstMessageSentAt,
      [ActivationStage.FIRST_MEAL_RECEIVED]: facts.firstMealReceivedAt,
      [ActivationStage.FIRST_ANALYSIS_COMPLETED]:
        facts.firstAnalysisCompletedAt,
      [ActivationStage.FIRST_RECOMMENDATION_DELIVERED]:
        facts.firstRecommendationDeliveredAt,
      [ActivationStage.FIRST_COACH_INTERACTION]: facts.firstCoachInteractionAt,
    };

    return timestamps[stage] ?? new Date();
  }

  private stageData(stage: ActivationStage, at: Date) {
    switch (stage) {
      case ActivationStage.PAID:
        return { paidAt: at };
      case ActivationStage.WHATSAPP_CONNECTED:
        return { whatsappConnectedAt: at };
      case ActivationStage.FIRST_MESSAGE_SENT:
        return { firstMessageSentAt: at };
      case ActivationStage.FIRST_MEAL_RECEIVED:
        return { firstMealReceivedAt: at };
      case ActivationStage.FIRST_ANALYSIS_COMPLETED:
        return { firstAnalysisCompletedAt: at };
      case ActivationStage.FIRST_RECOMMENDATION_DELIVERED:
        return { firstRecommendationDeliveredAt: at };
      case ActivationStage.FIRST_COACH_INTERACTION:
        return { firstCoachInteractionAt: at };
      case ActivationStage.ACTIVATED:
        return { activatedAt: at };
      default:
        return {};
    }
  }

  private stepDurations(activation: UserActivation): Prisma.InputJsonObject {
    const points = [
      ['registeredToPaid', activation.registeredAt, activation.paidAt],
      ['paidToWhatsapp', activation.paidAt, activation.whatsappConnectedAt],
      [
        'whatsappToFirstMessage',
        activation.whatsappConnectedAt,
        activation.firstMessageSentAt,
      ],
      [
        'firstMessageToMeal',
        activation.firstMessageSentAt,
        activation.firstMealReceivedAt,
      ],
      [
        'mealToAnalysis',
        activation.firstMealReceivedAt,
        activation.firstAnalysisCompletedAt,
      ],
      [
        'analysisToRecommendation',
        activation.firstAnalysisCompletedAt,
        activation.firstRecommendationDeliveredAt,
      ],
      [
        'recommendationToCoachInteraction',
        activation.firstRecommendationDeliveredAt,
        activation.firstCoachInteractionAt,
      ],
      [
        'registeredToActivated',
        activation.registeredAt,
        activation.activatedAt,
      ],
    ] as const;

    return Object.fromEntries(
      points.map(([key, start, end]) => [
        key,
        start && end ? this.durationSeconds(start, end) : null,
      ]),
    ) as Prisma.InputJsonObject;
  }

  private earliest(values: Array<Date | null | undefined>): Date | null {
    return (
      values
        .filter((value): value is Date => value instanceof Date)
        .sort((left, right) => left.getTime() - right.getTime())[0] ?? null
    );
  }

  private durationSeconds(start: Date, end: Date): number {
    return Math.max(0, Math.floor((end.getTime() - start.getTime()) / 1_000));
  }

  private lock(
    transaction: Prisma.TransactionClient,
    userId: string,
  ): Promise<unknown> {
    return transaction.$queryRaw`
      WITH advisory_lock AS (
        SELECT pg_advisory_xact_lock(hashtext(${`activation:${userId}`}))
      )
      SELECT true AS "locked"
      FROM advisory_lock
    `;
  }

  private utcDay(value: Date): Date {
    return new Date(
      Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
    );
  }
}
