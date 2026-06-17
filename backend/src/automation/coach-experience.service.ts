import { Injectable } from '@nestjs/common';
import {
  CoachCommunicationProfileType,
  CoachMotivationalTrigger,
  OutboundMessageStatus,
  Prisma,
  RecommendationStatus,
  ScheduledMessageStatus,
  Severity,
} from '@prisma/client';
import { BehavioralSignals } from '../behavior/interfaces/behavioral.interface';
import { LongitudinalResponseContext } from '../longitudinal/interfaces/longitudinal.interface';
import { EventService } from '../observability/event.service';
import { PrismaService } from '../prisma/prisma.service';
import { CoachExperienceCalculatorService } from './coach-experience-calculator.service';
import { ListCoachAdminDto } from './dto/list-coach-admin.dto';
import { CoachExperienceSignals } from './interfaces/coach-experience.interface';

const EXPERIENCE_SOURCE = 'COACH_EXPERIENCE';
const DAY_MS = 86_400_000;

export interface CoachExperienceRefreshInput {
  behavior: BehavioralSignals;
  goal: string;
  consistencyScore: number;
  engagementScore: number;
  adherenceScore: number;
  activeDays: number;
  daysInactive: number;
  churnRisk: string;
  longitudinal: LongitudinalResponseContext;
}

@Injectable()
export class CoachExperienceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly calculator: CoachExperienceCalculatorService,
    private readonly events: EventService,
  ) {}

  async refreshForUser(
    userId: string,
    input: CoachExperienceRefreshInput,
    at = new Date(),
  ): Promise<CoachExperienceSignals> {
    const snapshotDate = this.utcDay(at);
    const windowStart = new Date(at.getTime() - 14 * DAY_MS);
    const [
      previousCommunication,
      inboundMessages,
      scheduledMessages,
      outboundMessages,
      contextCounts,
      recommendationStatuses,
      coachMessageCount,
      coachReviewCount,
    ] = await Promise.all([
      this.prisma.coachCommunicationProfileSnapshot.findFirst({
        where: {
          userId,
          snapshotDate: { lt: snapshotDate },
        },
        orderBy: [{ snapshotDate: 'desc' }, { id: 'desc' }],
      }),
      this.prisma.message.findMany({
        where: {
          conversation: { userId },
          direction: 'INBOUND',
          timestamp: { gte: windowStart, lte: at },
        },
        select: { content: true, timestamp: true },
        orderBy: [{ timestamp: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.scheduledMessage.findMany({
        where: {
          userId,
          status: ScheduledMessageStatus.SENT,
          scheduledFor: { gte: windowStart, lte: at },
        },
        select: { content: true, scheduledFor: true },
        orderBy: [{ scheduledFor: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.outboundMessage.findMany({
        where: {
          userId,
          status: {
            in: [OutboundMessageStatus.SENT, OutboundMessageStatus.DELIVERED],
          },
          sentAt: { gte: windowStart, lte: at },
        },
        select: { content: true, sentAt: true },
        orderBy: [{ sentAt: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: {
          _count: {
            select: {
              contextSnapshots: true,
              conversationMemories: true,
            },
          },
        },
      }),
      this.prisma.recommendation.findMany({
        where: { userId },
        select: { status: true },
      }),
      this.prisma.coachMessage.count({
        where: { userId, generatedAt: { gte: windowStart, lte: at } },
      }),
      this.prisma.coachReview.count({
        where: { userId, generatedAt: { gte: windowStart, lte: at } },
      }),
    ]);
    const previous = previousCommunication
      ? {
          dominantStyle: previousCommunication.dominantStyle,
          scores: this.communicationScores(previousCommunication),
        }
      : null;
    const communication = this.calculator.communication({
      communicationStyle: input.behavior.communicationStyle,
      adherenceStyle: input.behavior.adherenceStyle,
      personalityPattern: input.behavior.personalityPattern,
      adaptationMode: input.longitudinal.coachAdaptation?.mode ?? null,
      consistencyScore: input.consistencyScore,
      churnRisk: input.churnRisk,
      confidence: input.behavior.confidenceScore,
      previous,
    });
    const motivation = this.calculator.motivation({
      motivations: input.behavior.motivations,
      triggers: input.behavior.triggers,
      adherenceStyle: input.behavior.adherenceStyle,
      personalityPattern: input.behavior.personalityPattern,
      goal: input.goal,
    });
    const allOutbound = [
      ...scheduledMessages.map((message) => ({
        content: message.content,
        sentAt: message.scheduledFor,
      })),
      ...outboundMessages.map((message) => ({
        content: message.content,
        sentAt: message.sentAt,
      })),
    ].sort(
      (left, right) =>
        (left.sentAt?.getTime() ?? 0) - (right.sentAt?.getTime() ?? 0),
    );
    const fatigue = this.calculator.fatigue({
      outboundContents: allOutbound.map((message) => message.content),
      inboundCount: inboundMessages.length,
    });
    const evolutionScore = this.calculator.evolutionScore(
      input.longitudinal.goalProgression?.state ?? null,
      input.longitudinal.goalProgression?.score ?? null,
    );
    const momentum = this.calculator.momentum({
      consistencyScore: input.consistencyScore,
      evolutionScore,
      relapseSeverity: input.longitudinal.relapse?.severity ?? null,
      engagementScore: input.engagementScore,
      adherenceScore: input.adherenceScore,
    });
    const acceptedRecommendations = recommendationStatuses.filter(
      (recommendation) =>
        recommendation.status === RecommendationStatus.ACCEPTED,
    ).length;
    const decidedRecommendations = recommendationStatuses.filter(
      (recommendation) =>
        recommendation.status === RecommendationStatus.ACCEPTED ||
        recommendation.status === RecommendationStatus.DISMISSED ||
        recommendation.status === RecommendationStatus.EXPIRED,
    ).length;
    const recommendationAcceptanceScore =
      decidedRecommendations === 0
        ? 50
        : this.clamp(
            Math.round(
              (acceptedRecommendations / decidedRecommendations) * 100,
            ),
          );
    const usageScore = this.clamp(Math.round((input.activeDays / 15) * 100));
    const contextScore = this.clamp(
      contextCounts._count.contextSnapshots * 12 +
        contextCounts._count.conversationMemories * 15,
    );
    const coachScore = this.clamp(
      Math.round(
        fatigue.interactionResponseScore * 0.65 +
          Math.min(100, (coachMessageCount + coachReviewCount * 2) * 8) * 0.35,
      ),
    );
    const retentionScore = this.calculator.retention({
      usageScore,
      engagementScore: input.engagementScore,
      contextScore,
      evolutionScore,
      coachScore,
      recommendationAcceptanceScore,
    });
    const averageInboundLength = this.averageLength(
      inboundMessages.map((message) => message.content),
    );
    const averageOutboundLength = this.averageLength(
      allOutbound.map((message) => message.content),
    );
    const whatsapp = this.calculator.whatsapp({
      averageInboundLength,
      averageOutboundLength,
      preferredHourUtc: input.behavior.preferredEngagementHour,
      communicationStyle: communication.dominantStyle,
      fatigueScore: fatigue.fatigueScore,
      frequencyHours: fatigue.recommendedFrequencyHours,
      interactionRate: fatigue.interactionResponseScore,
    });
    const reengagement =
      input.daysInactive >= 3
        ? this.calculator.reengagement({
            daysInactive: input.daysInactive,
            momentumScore: momentum.score,
            fatigueScore: fatigue.fatigueScore,
            evolutionState: input.longitudinal.goalProgression?.state ?? null,
            relapseSeverity: input.longitudinal.relapse?.severity ?? null,
            seed: this.seed(`${userId}:${this.dayKey(at)}`),
          })
        : null;
    const latestOutboundAt = allOutbound.at(-1)?.sentAt ?? null;
    const nextCoachMessageAt = latestOutboundAt
      ? new Date(
          latestOutboundAt.getTime() +
            fatigue.recommendedFrequencyHours * 60 * 60 * 1_000,
        )
      : null;
    const canSendCoachMessage =
      nextCoachMessageAt === null || nextCoachMessageAt <= at;

    await this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        WITH advisory_lock AS (
          SELECT pg_advisory_xact_lock(
            hashtext(${`coach-experience:${userId}:${this.dayKey(at)}`})
          )
        )
        SELECT true AS "locked"
        FROM advisory_lock
      `;
      const communicationRecord =
        await transaction.coachCommunicationProfileSnapshot.upsert({
          where: {
            userId_snapshotDate: { userId, snapshotDate },
          },
          update: this.communicationData(
            communication,
            previousCommunication?.dominantStyle ?? null,
            input,
            at,
          ),
          create: {
            userId,
            snapshotDate,
            ...this.communicationData(
              communication,
              previousCommunication?.dominantStyle ?? null,
              input,
              at,
            ),
          },
        });
      const motivationRecord =
        await transaction.coachMotivationProfileSnapshot.upsert({
          where: {
            userId_snapshotDate: { userId, snapshotDate },
          },
          update: this.motivationData(motivation, input, at),
          create: {
            userId,
            snapshotDate,
            ...this.motivationData(motivation, input, at),
          },
        });
      const fatigueRecord = await transaction.messageFatigueSnapshot.upsert({
        where: {
          userId_snapshotDate: { userId, snapshotDate },
        },
        update: {
          fatigueScore: fatigue.fatigueScore,
          outboundMessages14Days: allOutbound.length,
          inboundMessages14Days: inboundMessages.length,
          repeatedThemeScore: fatigue.repeatedThemeScore,
          repeatedPhraseScore: fatigue.repeatedPhraseScore,
          interactionResponseScore: fatigue.interactionResponseScore,
          recommendedFrequencyHours: fatigue.recommendedFrequencyHours,
          evidence: {
            averageInboundLength,
            averageOutboundLength,
          },
          calculatedAt: at,
        },
        create: {
          userId,
          snapshotDate,
          fatigueScore: fatigue.fatigueScore,
          outboundMessages14Days: allOutbound.length,
          inboundMessages14Days: inboundMessages.length,
          repeatedThemeScore: fatigue.repeatedThemeScore,
          repeatedPhraseScore: fatigue.repeatedPhraseScore,
          interactionResponseScore: fatigue.interactionResponseScore,
          recommendedFrequencyHours: fatigue.recommendedFrequencyHours,
          evidence: {
            averageInboundLength,
            averageOutboundLength,
          },
          calculatedAt: at,
        },
      });
      const momentumRecord = await transaction.goalMomentumSnapshot.upsert({
        where: {
          userId_snapshotDate: { userId, snapshotDate },
        },
        update: {
          score: momentum.score,
          consistencyScore: input.consistencyScore,
          evolutionScore,
          relapseScore: momentum.relapseScore,
          engagementScore: input.engagementScore,
          adherenceScore: input.adherenceScore,
          evidence: {
            progressionState: input.longitudinal.goalProgression?.state ?? null,
            relapseSeverity: input.longitudinal.relapse?.severity ?? null,
          },
          calculatedAt: at,
        },
        create: {
          userId,
          snapshotDate,
          score: momentum.score,
          consistencyScore: input.consistencyScore,
          evolutionScore,
          relapseScore: momentum.relapseScore,
          engagementScore: input.engagementScore,
          adherenceScore: input.adherenceScore,
          evidence: {
            progressionState: input.longitudinal.goalProgression?.state ?? null,
            relapseSeverity: input.longitudinal.relapse?.severity ?? null,
          },
          calculatedAt: at,
        },
      });
      await transaction.whatsAppExperienceSnapshot.upsert({
        where: {
          userId_snapshotDate: { userId, snapshotDate },
        },
        update: {
          idealMessageLength: whatsapp.idealMessageLength,
          idealEmojiCount: whatsapp.idealEmojiCount,
          idealFrequencyHours: whatsapp.idealFrequencyHours,
          preferredHourUtc: whatsapp.preferredHourUtc,
          averageInboundLength,
          averageOutboundLength,
          interactionRate: whatsapp.interactionRate,
          evidence: {
            communicationStyle: communication.dominantStyle,
            fatigueScore: fatigue.fatigueScore,
          },
          calculatedAt: at,
        },
        create: {
          userId,
          snapshotDate,
          idealMessageLength: whatsapp.idealMessageLength,
          idealEmojiCount: whatsapp.idealEmojiCount,
          idealFrequencyHours: whatsapp.idealFrequencyHours,
          preferredHourUtc: whatsapp.preferredHourUtc,
          averageInboundLength,
          averageOutboundLength,
          interactionRate: whatsapp.interactionRate,
          evidence: {
            communicationStyle: communication.dominantStyle,
            fatigueScore: fatigue.fatigueScore,
          },
          calculatedAt: at,
        },
      });
      const retentionRecord =
        await transaction.retentionStrengthSnapshot.upsert({
          where: {
            userId_snapshotDate: { userId, snapshotDate },
          },
          update: {
            score: retentionScore,
            usageScore,
            engagementScore: input.engagementScore,
            contextScore,
            evolutionScore,
            coachScore,
            recommendationAcceptanceScore,
            evidence: {
              acceptedRecommendations,
              decidedRecommendations,
              activeDays: input.activeDays,
            },
            calculatedAt: at,
          },
          create: {
            userId,
            snapshotDate,
            score: retentionScore,
            usageScore,
            engagementScore: input.engagementScore,
            contextScore,
            evolutionScore,
            coachScore,
            recommendationAcceptanceScore,
            evidence: {
              acceptedRecommendations,
              decidedRecommendations,
              activeDays: input.activeDays,
            },
            calculatedAt: at,
          },
        });
      const reengagementRecord = reengagement
        ? await transaction.coachReengagementClassification.upsert({
            where: {
              sourceKey: `coach-reengagement:${userId}:${this.dayKey(at)}`,
            },
            update: {
              reason: reengagement.reason,
              confidence: new Prisma.Decimal(
                reengagement.confidence.toFixed(4),
              ),
              messageVariant: reengagement.messageVariant,
              evidence: {
                daysInactive: input.daysInactive,
                momentumScore: momentum.score,
                fatigueScore: fatigue.fatigueScore,
              },
              generatedAt: at,
            },
            create: {
              userId,
              sourceKey: `coach-reengagement:${userId}:${this.dayKey(at)}`,
              reason: reengagement.reason,
              confidence: new Prisma.Decimal(
                reengagement.confidence.toFixed(4),
              ),
              messageVariant: reengagement.messageVariant,
              evidence: {
                daysInactive: input.daysInactive,
                momentumScore: momentum.score,
                fatigueScore: fatigue.fatigueScore,
              },
              generatedAt: at,
            },
          })
        : null;

      await this.recordEvents(transaction, {
        userId,
        communicationId: communicationRecord.id,
        communicationStyle: communication.dominantStyle,
        motivationId: motivationRecord.id,
        motivationTrigger: motivation.dominantTrigger,
        fatigueId: fatigueRecord.id,
        fatigueScore: fatigue.fatigueScore,
        reengagementId: reengagementRecord?.id ?? null,
        reengagementReason: reengagement?.reason ?? null,
        momentumId: momentumRecord.id,
        momentumScore: momentum.score,
        retentionId: retentionRecord.id,
        retentionScore,
      });
    });

    return {
      communication,
      motivation,
      fatigue: {
        score: fatigue.fatigueScore,
        recommendedFrequencyHours: fatigue.recommendedFrequencyHours,
        repeatedThemeScore: fatigue.repeatedThemeScore,
        repeatedPhraseScore: fatigue.repeatedPhraseScore,
        interactionResponseScore: fatigue.interactionResponseScore,
      },
      reengagement,
      momentum: { score: momentum.score },
      retention: { score: retentionScore },
      whatsapp: {
        idealMessageLength: whatsapp.idealMessageLength,
        idealEmojiCount: whatsapp.idealEmojiCount,
        idealFrequencyHours: whatsapp.idealFrequencyHours,
        preferredHourUtc: whatsapp.preferredHourUtc,
      },
      canSendCoachMessage,
      nextCoachMessageAt,
    };
  }

  async listProfiles(query: ListCoachAdminDto) {
    return this.page(
      await this.prisma.coachCommunicationProfileSnapshot.findMany({
        where: { userId: query.userId },
        orderBy: [{ generatedAt: 'desc' }, { id: 'desc' }],
        cursor: query.cursor ? { id: query.cursor } : undefined,
        skip: query.cursor ? 1 : undefined,
        take: query.limit + 1,
      }),
      query.limit,
    );
  }

  async listFatigue(query: ListCoachAdminDto) {
    return this.page(
      await this.prisma.messageFatigueSnapshot.findMany({
        where: { userId: query.userId },
        orderBy: [{ calculatedAt: 'desc' }, { id: 'desc' }],
        cursor: query.cursor ? { id: query.cursor } : undefined,
        skip: query.cursor ? 1 : undefined,
        take: query.limit + 1,
      }),
      query.limit,
    );
  }

  async listMomentum(query: ListCoachAdminDto) {
    return this.page(
      await this.prisma.goalMomentumSnapshot.findMany({
        where: { userId: query.userId },
        orderBy: [{ calculatedAt: 'desc' }, { id: 'desc' }],
        cursor: query.cursor ? { id: query.cursor } : undefined,
        skip: query.cursor ? 1 : undefined,
        take: query.limit + 1,
      }),
      query.limit,
    );
  }

  async listRetention(query: ListCoachAdminDto) {
    return this.page(
      await this.prisma.retentionStrengthSnapshot.findMany({
        where: { userId: query.userId },
        orderBy: [{ calculatedAt: 'desc' }, { id: 'desc' }],
        cursor: query.cursor ? { id: query.cursor } : undefined,
        skip: query.cursor ? 1 : undefined,
        take: query.limit + 1,
      }),
      query.limit,
    );
  }

  private communicationData(
    communication: CoachExperienceSignals['communication'],
    previousStyle: CoachCommunicationProfileType | null,
    input: CoachExperienceRefreshInput,
    at: Date,
  ) {
    return {
      dominantStyle: communication.dominantStyle,
      previousStyle,
      directScore: communication.scores[CoachCommunicationProfileType.DIRECT],
      technicalScore:
        communication.scores[CoachCommunicationProfileType.TECHNICAL],
      motivationalScore:
        communication.scores[CoachCommunicationProfileType.MOTIVATIONAL],
      disciplinarianScore:
        communication.scores[CoachCommunicationProfileType.DISCIPLINARIAN],
      warmScore: communication.scores[CoachCommunicationProfileType.WARM],
      balancedScore:
        communication.scores[CoachCommunicationProfileType.BALANCED],
      confidence: new Prisma.Decimal(communication.confidence.toFixed(4)),
      evidence: {
        behavioralCommunicationStyle: input.behavior.communicationStyle,
        adherenceStyle: input.behavior.adherenceStyle,
        personalityPattern: input.behavior.personalityPattern,
        longitudinalMode: input.longitudinal.coachAdaptation?.mode ?? null,
      },
      generatedAt: at,
    };
  }

  private motivationData(
    motivation: CoachExperienceSignals['motivation'],
    input: CoachExperienceRefreshInput,
    at: Date,
  ) {
    return {
      dominantTrigger: motivation.dominantTrigger,
      visualResultScore:
        motivation.scores[CoachMotivationalTrigger.VISUAL_RESULT],
      healthScore: motivation.scores[CoachMotivationalTrigger.HEALTH],
      selfEsteemScore: motivation.scores[CoachMotivationalTrigger.SELF_ESTEEM],
      performanceScore: motivation.scores[CoachMotivationalTrigger.PERFORMANCE],
      disciplineScore: motivation.scores[CoachMotivationalTrigger.DISCIPLINE],
      longevityScore: motivation.scores[CoachMotivationalTrigger.LONGEVITY],
      routineScore: motivation.scores[CoachMotivationalTrigger.ROUTINE],
      confidence: new Prisma.Decimal(motivation.confidence.toFixed(4)),
      evidence: {
        behavioralMotivation: input.behavior.motivationStyle,
        triggers: input.behavior.triggers.map((trigger) => trigger.type),
        goal: input.goal,
      },
      generatedAt: at,
    };
  }

  private communicationScores(record: {
    directScore: number;
    technicalScore: number;
    motivationalScore: number;
    disciplinarianScore: number;
    warmScore: number;
    balancedScore: number;
  }): Record<CoachCommunicationProfileType, number> {
    return {
      [CoachCommunicationProfileType.DIRECT]: record.directScore,
      [CoachCommunicationProfileType.TECHNICAL]: record.technicalScore,
      [CoachCommunicationProfileType.MOTIVATIONAL]: record.motivationalScore,
      [CoachCommunicationProfileType.DISCIPLINARIAN]:
        record.disciplinarianScore,
      [CoachCommunicationProfileType.WARM]: record.warmScore,
      [CoachCommunicationProfileType.BALANCED]: record.balancedScore,
    };
  }

  private recordEvents(
    transaction: Prisma.TransactionClient,
    input: {
      userId: string;
      communicationId: string;
      communicationStyle: string;
      motivationId: string;
      motivationTrigger: string;
      fatigueId: string;
      fatigueScore: number;
      reengagementId: string | null;
      reengagementReason: string | null;
      momentumId: string;
      momentumScore: number;
      retentionId: string;
      retentionScore: number;
    },
  ) {
    const records: Array<{
      eventType: string;
      message: string;
      metadata: Prisma.InputJsonObject;
    }> = [
      {
        eventType: 'COACH_PROFILE_UPDATED',
        message: 'Perfil de comunicação do coach atualizado',
        metadata: {
          profileId: input.communicationId,
          dominantStyle: input.communicationStyle,
        },
      },
      {
        eventType: 'MOTIVATION_PROFILE_UPDATED',
        message: 'Perfil motivacional do coach atualizado',
        metadata: {
          profileId: input.motivationId,
          dominantTrigger: input.motivationTrigger,
        },
      },
      {
        eventType: 'MESSAGE_FATIGUE_RECALCULATED',
        message: 'Fadiga de mensagens recalculada',
        metadata: {
          snapshotId: input.fatigueId,
          fatigueScore: input.fatigueScore,
        },
      },
      {
        eventType: 'GOAL_MOMENTUM_RECALCULATED',
        message: 'Momentum do objetivo recalculado',
        metadata: {
          snapshotId: input.momentumId,
          momentumScore: input.momentumScore,
        },
      },
      {
        eventType: 'RETENTION_SCORE_RECALCULATED',
        message: 'Força de retenção recalculada',
        metadata: {
          snapshotId: input.retentionId,
          retentionScore: input.retentionScore,
        },
      },
    ];

    if (input.reengagementId) {
      records.push({
        eventType: 'REENGAGEMENT_TRIGGER_CLASSIFIED',
        message: 'Motivo de reengajamento classificado',
        metadata: {
          classificationId: input.reengagementId,
          reason: input.reengagementReason,
        },
      });
    }

    return Promise.all(
      records.map((record) =>
        this.events.recordInTransaction(transaction, {
          source: EXPERIENCE_SOURCE,
          severity: Severity.INFO,
          eventType: record.eventType,
          message: record.message,
          metadata: {
            userId: input.userId,
            ...record.metadata,
          },
        }),
      ),
    );
  }

  private averageLength(contents: string[]): number {
    return contents.length === 0
      ? 0
      : Math.round(
          contents.reduce((sum, content) => sum + content.length, 0) /
            contents.length,
        );
  }

  private seed(value: string): number {
    return [...value].reduce(
      (total, character) => (total * 31 + character.charCodeAt(0)) | 0,
      17,
    );
  }

  private page<T extends { id: string }>(records: T[], limit: number) {
    const hasMore = records.length > limit;
    const items = hasMore ? records.slice(0, limit) : records;

    return {
      items,
      nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
    };
  }

  private dayKey(value: Date): string {
    return value.toISOString().slice(0, 10);
  }

  private utcDay(value: Date): Date {
    return new Date(
      Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
    );
  }

  private clamp(value: number): number {
    return Math.max(0, Math.min(100, value));
  }
}
