import { Injectable, NotFoundException } from '@nestjs/common';
import {
  BehavioralInsightStatus,
  BehavioralInsightType,
  BehavioralMotivationStyle,
  MessageDirection,
  OutboundMessageStatus,
  Prisma,
  Severity,
  StageOfChange,
} from '@prisma/client';
import { EventService } from '../observability/event.service';
import { PrismaService } from '../prisma/prisma.service';
import { BehavioralEngineService } from './behavioral-engine.service';
import { ListBehaviorAdminDto } from './dto/list-behavior-admin.dto';
import {
  BehavioralEngineInput,
  BehavioralSignals,
} from './interfaces/behavioral.interface';

const BEHAVIOR_SOURCE = 'BEHAVIORAL_INTELLIGENCE';
const WINDOW_DAYS = 30;

@Injectable()
export class BehavioralIntelligenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: BehavioralEngineService,
    private readonly events: EventService,
  ) {}

  async recalculateUser(userId: string, at = new Date()) {
    const snapshotDate = this.utcDay(at);
    const windowStart = new Date(at.getTime() - WINDOW_DAYS * 86_400_000);
    const [
      user,
      messages,
      memories,
      habit,
      consistency,
      engagement,
      contextSnapshot,
      trend,
      coachMessages,
      outboundMessages,
      progressRecords,
      previousStage,
      existingInsights,
    ] = await Promise.all([
      this.prisma.user.findUnique({
        where: {
          id: userId,
        },
        select: {
          id: true,
          fitnessProfile: {
            select: {
              goal: true,
            },
          },
          nutritionProfile: {
            select: {
              goal: true,
            },
          },
          behavioralProfile: true,
        },
      }),
      this.prisma.message.findMany({
        where: {
          conversation: {
            userId,
          },
          direction: MessageDirection.INBOUND,
          timestamp: {
            gte: windowStart,
            lte: at,
          },
        },
        select: {
          content: true,
          timestamp: true,
        },
        orderBy: [{ timestamp: 'asc' }, { id: 'asc' }],
        take: 200,
      }),
      this.prisma.conversationMemory.findMany({
        where: {
          userId,
        },
        select: {
          summary: true,
        },
        orderBy: [{ relevanceScore: 'desc' }, { generatedAt: 'desc' }],
        take: 10,
      }),
      this.prisma.habitSnapshot.findFirst({
        where: {
          userId,
          snapshotDate: {
            lte: snapshotDate,
          },
        },
        orderBy: [{ snapshotDate: 'desc' }, { id: 'desc' }],
      }),
      this.prisma.consistencyScore.findFirst({
        where: {
          userId,
          snapshotDate: {
            lte: snapshotDate,
          },
        },
        orderBy: [{ snapshotDate: 'desc' }, { id: 'desc' }],
      }),
      this.prisma.engagementScore.findFirst({
        where: {
          userId,
          snapshotDate: {
            lte: snapshotDate,
          },
        },
        orderBy: [{ snapshotDate: 'desc' }, { id: 'desc' }],
      }),
      this.prisma.userContextSnapshot.findFirst({
        where: {
          userId,
          generatedAt: {
            lte: at,
          },
        },
        orderBy: [{ generatedAt: 'desc' }, { id: 'desc' }],
      }),
      this.prisma.nutritionTrend.findFirst({
        where: {
          userId,
          windowDays: 30,
          calculatedAt: {
            lte: at,
          },
        },
        orderBy: [{ calculatedAt: 'desc' }, { id: 'desc' }],
      }),
      this.prisma.coachMessage.findMany({
        where: {
          userId,
          generatedAt: {
            gte: windowStart,
            lte: at,
          },
        },
        select: {
          generatedAt: true,
        },
        orderBy: {
          generatedAt: 'asc',
        },
        take: 100,
      }),
      this.prisma.outboundMessage.findMany({
        where: {
          userId,
          status: {
            in: [OutboundMessageStatus.SENT, OutboundMessageStatus.DELIVERED],
          },
          sentAt: {
            gte: windowStart,
            lte: at,
          },
        },
        select: {
          sentAt: true,
        },
        orderBy: {
          sentAt: 'asc',
        },
        take: 100,
      }),
      this.prisma.progressSnapshot.count({
        where: {
          userId,
          createdAt: {
            gte: windowStart,
            lte: at,
          },
        },
      }),
      this.prisma.stageOfChangeHistory.findFirst({
        where: {
          userId,
          snapshotDate: {
            lt: snapshotDate,
          },
        },
        orderBy: [{ snapshotDate: 'desc' }, { id: 'desc' }],
      }),
      this.prisma.behavioralInsight.findMany({
        where: {
          userId,
        },
      }),
    ]);

    if (!user) {
      throw new NotFoundException('Usuário não encontrado');
    }

    const responseTimes = [
      ...coachMessages.map((message) => message.generatedAt),
      ...outboundMessages
        .map((message) => message.sentAt)
        .filter((value): value is Date => value !== null),
    ];
    const input: BehavioralEngineInput = {
      messages,
      memorySummaries: memories.map((memory) => memory.summary),
      goal:
        user.fitnessProfile?.goal ??
        user.nutritionProfile?.goal ??
        contextSnapshot?.goal ??
        null,
      activeDays: habit?.activeDays ?? 0,
      consecutiveDays: habit?.consecutiveDays ?? 0,
      mealFrequency: habit?.mealFrequency.toNumber() ?? 0,
      regularityScore: habit?.regularityScore ?? 0,
      consistencyScore: consistency?.score ?? 0,
      engagementScore: engagement?.score ?? 0,
      contextAdherenceScore: contextSnapshot?.adherenceScore ?? null,
      trendAdherenceScore: trend?.goalAdherenceScore ?? null,
      analysesLast30Days:
        engagement?.analysesLast30Days ??
        contextSnapshot?.nutritionAnalysesCount ??
        0,
      responsesSent: responseTimes.length,
      responsesFollowedByInteraction: this.followedByInteraction(
        responseTimes,
        messages.map((message) => message.timestamp),
      ),
      progressRecords,
      improvingTrend: trend?.direction === 'IMPROVING',
      previousStage: previousStage?.stage ?? null,
    };
    const evaluation = this.engine.evaluate(input);
    const existingInsightTypes = new Map(
      existingInsights.map((insight) => [insight.type, insight]),
    );

    return this.prisma.$transaction(
      async (transaction) => {
        await transaction.$queryRaw`
          WITH advisory_lock AS (
            SELECT pg_advisory_xact_lock(
              hashtext(${`behavioral-profile:${userId}:${snapshotDate.toISOString().slice(0, 10)}`})
            )
          )
          SELECT true AS "locked"
          FROM advisory_lock
        `;

        const profile = await transaction.behavioralProfile.upsert({
          where: {
            userId,
          },
          update: {
            communicationStyle: evaluation.communicationStyle,
            motivationStyle: evaluation.dominantMotivation,
            adherenceStyle: evaluation.adherenceStyle,
            personalityPattern: evaluation.personalityPattern,
            confidenceScore: new Prisma.Decimal(
              evaluation.confidenceScore.toFixed(4),
            ),
            preferredEngagementHour: evaluation.preferredEngagementHour,
            evidence: evaluation.evidence,
            generatedAt: at,
          },
          create: {
            userId,
            communicationStyle: evaluation.communicationStyle,
            motivationStyle: evaluation.dominantMotivation,
            adherenceStyle: evaluation.adherenceStyle,
            personalityPattern: evaluation.personalityPattern,
            confidenceScore: new Prisma.Decimal(
              evaluation.confidenceScore.toFixed(4),
            ),
            preferredEngagementHour: evaluation.preferredEngagementHour,
            evidence: evaluation.evidence,
            generatedAt: at,
          },
        });

        for (const motivation of evaluation.motivations) {
          await transaction.behavioralMotivation.upsert({
            where: {
              userId_type: {
                userId,
                type: motivation.type,
              },
            },
            update: {
              weight: new Prisma.Decimal(motivation.weight.toFixed(2)),
              evidence: motivation.evidence,
              detectedAt: at,
            },
            create: {
              userId,
              type: motivation.type,
              weight: new Prisma.Decimal(motivation.weight.toFixed(2)),
              evidence: motivation.evidence,
              detectedAt: at,
            },
          });
        }

        const stage = await transaction.stageOfChangeHistory.upsert({
          where: {
            userId_snapshotDate: {
              userId,
              snapshotDate,
            },
          },
          update: {
            stage: evaluation.stage,
            previousStage: previousStage?.stage ?? null,
            confidence: new Prisma.Decimal(
              evaluation.stageConfidence.toFixed(4),
            ),
            evidence: evaluation.stageEvidence,
            detectedAt: at,
          },
          create: {
            userId,
            snapshotDate,
            stage: evaluation.stage,
            previousStage: previousStage?.stage ?? null,
            confidence: new Prisma.Decimal(
              evaluation.stageConfidence.toFixed(4),
            ),
            evidence: evaluation.stageEvidence,
            detectedAt: at,
          },
        });
        const adherence = await transaction.adherencePrediction.upsert({
          where: {
            userId_snapshotDate: {
              userId,
              snapshotDate,
            },
          },
          update: {
            ...evaluation.adherence,
            evidence: {
              responsesSent: input.responsesSent,
              responsesFollowedByInteraction:
                input.responsesFollowedByInteraction,
              engagementScore: input.engagementScore,
            },
            calculatedAt: at,
          },
          create: {
            userId,
            snapshotDate,
            ...evaluation.adherence,
            evidence: {
              responsesSent: input.responsesSent,
              responsesFollowedByInteraction:
                input.responsesFollowedByInteraction,
              engagementScore: input.engagementScore,
            },
            calculatedAt: at,
          },
        });

        await transaction.motivationTrigger.updateMany({
          where: {
            userId,
          },
          data: {
            active: false,
          },
        });

        for (const trigger of evaluation.triggers) {
          await transaction.motivationTrigger.upsert({
            where: {
              userId_type: {
                userId,
                type: trigger.type,
              },
            },
            update: {
              weight: new Prisma.Decimal(trigger.weight.toFixed(2)),
              evidence: trigger.evidence,
              active: true,
              detectedAt: at,
            },
            create: {
              userId,
              type: trigger.type,
              weight: new Prisma.Decimal(trigger.weight.toFixed(2)),
              evidence: trigger.evidence,
              active: true,
              detectedAt: at,
            },
          });
        }

        const detectedInsightTypes = evaluation.insights.map(
          (insight) => insight.type,
        );

        await transaction.behavioralInsight.updateMany({
          where: {
            userId,
            status: BehavioralInsightStatus.ACTIVE,
            type: {
              notIn: detectedInsightTypes,
            },
          },
          data: {
            status: BehavioralInsightStatus.RESOLVED,
            resolvedAt: at,
          },
        });

        for (const insight of evaluation.insights) {
          const existing = existingInsightTypes.get(insight.type);
          const record = await transaction.behavioralInsight.upsert({
            where: {
              userId_type: {
                userId,
                type: insight.type,
              },
            },
            update: {
              status: BehavioralInsightStatus.ACTIVE,
              summary: insight.summary,
              evidence: insight.evidence,
              occurrences:
                !existing ||
                existing.status === BehavioralInsightStatus.RESOLVED ||
                this.utcDay(existing.lastDetectedAt).getTime() <
                  snapshotDate.getTime()
                  ? {
                      increment: 1,
                    }
                  : undefined,
              lastDetectedAt: at,
              resolvedAt: null,
            },
            create: {
              userId,
              type: insight.type,
              summary: insight.summary,
              evidence: insight.evidence,
              firstDetectedAt: at,
              lastDetectedAt: at,
            },
          });

          if (
            !existing ||
            existing.status === BehavioralInsightStatus.RESOLVED
          ) {
            await this.events.recordInTransaction(transaction, {
              source: BEHAVIOR_SOURCE,
              severity: Severity.INFO,
              eventType: 'BEHAVIORAL_INSIGHT_CREATED',
              message: 'Insight comportamental criado',
              metadata: {
                userId,
                insightId: record.id,
                insightType: insight.type,
              },
            });
          }
        }

        const snapshot = await transaction.behavioralSnapshot.upsert({
          where: {
            userId_snapshotDate: {
              userId,
              snapshotDate,
            },
          },
          update: {
            adherenceScore: evaluation.adherence.score,
            stage: evaluation.stage,
            dominantMotivation: evaluation.dominantMotivation,
            engagementScore: input.engagementScore,
            communicationStyle: evaluation.communicationStyle,
            preferredEngagementHour: evaluation.preferredEngagementHour,
            confidenceScore: new Prisma.Decimal(
              evaluation.confidenceScore.toFixed(4),
            ),
            generatedAt: at,
          },
          create: {
            userId,
            snapshotDate,
            adherenceScore: evaluation.adherence.score,
            stage: evaluation.stage,
            dominantMotivation: evaluation.dominantMotivation,
            engagementScore: input.engagementScore,
            communicationStyle: evaluation.communicationStyle,
            preferredEngagementHour: evaluation.preferredEngagementHour,
            confidenceScore: new Prisma.Decimal(
              evaluation.confidenceScore.toFixed(4),
            ),
            generatedAt: at,
          },
        });

        await this.recordProfileEvent(
          transaction,
          userId,
          profile.id,
          user.behavioralProfile !== null,
          evaluation,
        );
        await this.events.recordInTransaction(transaction, {
          source: BEHAVIOR_SOURCE,
          severity: Severity.INFO,
          eventType: 'BEHAVIORAL_ADHERENCE_RECALCULATED',
          message: 'Previsão de adesão recalculada',
          metadata: {
            userId,
            adherencePredictionId: adherence.id,
            score: adherence.score,
            snapshotDate: snapshotDate.toISOString().slice(0, 10),
          },
        });

        if (previousStage && previousStage.stage !== evaluation.stage) {
          await this.events.recordInTransaction(transaction, {
            source: BEHAVIOR_SOURCE,
            severity: Severity.INFO,
            eventType: 'BEHAVIORAL_STAGE_CHANGED',
            message: 'Estágio de mudança atualizado',
            metadata: {
              userId,
              stageHistoryId: stage.id,
              previousStage: previousStage.stage,
              currentStage: evaluation.stage,
            },
          });
        }

        return {
          profile,
          stage,
          adherence,
          snapshot,
          evaluation,
        };
      },
      {
        maxWait: 5_000,
        timeout: 30_000,
      },
    );
  }

  async getSignals(
    userId: string,
    at = new Date(),
  ): Promise<BehavioralSignals> {
    const snapshotDate = this.utcDay(at);
    let state = await this.readSignals(userId, snapshotDate);

    if (!state) {
      await this.recalculateUser(userId, at);
      state = await this.readSignals(userId, snapshotDate);
    }

    if (!state) {
      throw new NotFoundException('Perfil comportamental indisponível');
    }

    return {
      communicationStyle: state.profile.communicationStyle,
      motivationStyle: state.profile.motivationStyle,
      adherenceStyle: state.profile.adherenceStyle,
      personalityPattern: state.profile.personalityPattern,
      stage: state.stage.stage,
      adherenceScore: state.adherence.score,
      engagementScore: state.snapshot.engagementScore,
      preferredEngagementHour: state.profile.preferredEngagementHour,
      confidenceScore: state.profile.confidenceScore.toNumber(),
      motivations: state.motivations.map((motivation) => ({
        type: motivation.type,
        weight: motivation.weight.toNumber(),
      })),
      triggers: state.triggers.map((trigger) => ({
        type: trigger.type,
        weight: trigger.weight.toNumber(),
      })),
      insights: state.insights.map((insight) => insight.type),
      useShortMessages: state.insights.some(
        (insight) => insight.type === BehavioralInsightType.SHORT_MESSAGES,
      ),
      motivationLine: this.motivationLine(
        state.profile.motivationStyle,
        state.triggers[0]?.type,
        state.stage.stage,
      ),
    };
  }

  async refreshSignals(
    userId: string,
    at = new Date(),
  ): Promise<BehavioralSignals> {
    await this.recalculateUser(userId, at);
    return this.getSignals(userId, at);
  }

  async preferredScheduleHour(userId: string, at = new Date()) {
    const signals = await this.refreshSignals(userId, at);
    return signals.preferredEngagementHour ?? 12;
  }

  async listUsers(query: ListBehaviorAdminDto) {
    const limit = query.limit ?? 50;
    const records = await this.prisma.user.findMany({
      where: {
        id: query.userId,
        behavioralProfile: {
          isNot: null,
        },
      },
      select: {
        id: true,
        name: true,
        email: true,
        behavioralProfile: true,
        behavioralMotivations: {
          orderBy: [{ weight: 'desc' }, { type: 'asc' }],
        },
        behavioralSnapshots: {
          orderBy: [{ snapshotDate: 'desc' }, { id: 'desc' }],
          take: 1,
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      cursor: query.cursor ? { id: query.cursor } : undefined,
      skip: query.cursor ? 1 : undefined,
      take: limit + 1,
    });

    return this.page(records, limit);
  }

  async listInsights(query: ListBehaviorAdminDto) {
    return this.page(
      await this.prisma.behavioralInsight.findMany({
        where: {
          userId: query.userId,
          type: query.insightType,
        },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
        orderBy: [{ lastDetectedAt: 'desc' }, { id: 'desc' }],
        cursor: query.cursor ? { id: query.cursor } : undefined,
        skip: query.cursor ? 1 : undefined,
        take: (query.limit ?? 50) + 1,
      }),
      query.limit ?? 50,
    );
  }

  async listAdherence(query: ListBehaviorAdminDto) {
    return this.page(
      await this.prisma.adherencePrediction.findMany({
        where: {
          userId: query.userId,
        },
        orderBy: [{ calculatedAt: 'desc' }, { id: 'desc' }],
        cursor: query.cursor ? { id: query.cursor } : undefined,
        skip: query.cursor ? 1 : undefined,
        take: (query.limit ?? 50) + 1,
      }),
      query.limit ?? 50,
    );
  }

  async listStages(query: ListBehaviorAdminDto) {
    return this.page(
      await this.prisma.stageOfChangeHistory.findMany({
        where: {
          userId: query.userId,
          stage: query.stage,
        },
        orderBy: [{ detectedAt: 'desc' }, { id: 'desc' }],
        cursor: query.cursor ? { id: query.cursor } : undefined,
        skip: query.cursor ? 1 : undefined,
        take: (query.limit ?? 50) + 1,
      }),
      query.limit ?? 50,
    );
  }

  private async readSignals(userId: string, snapshotDate: Date) {
    const [
      profile,
      stage,
      adherence,
      snapshot,
      motivations,
      triggers,
      insights,
    ] = await Promise.all([
      this.prisma.behavioralProfile.findUnique({
        where: {
          userId,
        },
      }),
      this.prisma.stageOfChangeHistory.findUnique({
        where: {
          userId_snapshotDate: {
            userId,
            snapshotDate,
          },
        },
      }),
      this.prisma.adherencePrediction.findUnique({
        where: {
          userId_snapshotDate: {
            userId,
            snapshotDate,
          },
        },
      }),
      this.prisma.behavioralSnapshot.findUnique({
        where: {
          userId_snapshotDate: {
            userId,
            snapshotDate,
          },
        },
      }),
      this.prisma.behavioralMotivation.findMany({
        where: {
          userId,
        },
        orderBy: [{ weight: 'desc' }, { type: 'asc' }],
      }),
      this.prisma.motivationTrigger.findMany({
        where: {
          userId,
          active: true,
        },
        orderBy: [{ weight: 'desc' }, { type: 'asc' }],
      }),
      this.prisma.behavioralInsight.findMany({
        where: {
          userId,
          status: BehavioralInsightStatus.ACTIVE,
        },
        orderBy: [{ lastDetectedAt: 'desc' }, { type: 'asc' }],
      }),
    ]);

    if (!profile || !stage || !adherence || !snapshot) {
      return null;
    }

    return {
      profile,
      stage,
      adherence,
      snapshot,
      motivations,
      triggers,
      insights,
    };
  }

  private recordProfileEvent(
    transaction: Prisma.TransactionClient,
    userId: string,
    profileId: string,
    updated: boolean,
    evaluation: {
      communicationStyle: string;
      dominantMotivation: string;
      confidenceScore: number;
    },
  ) {
    return this.events.recordInTransaction(transaction, {
      source: BEHAVIOR_SOURCE,
      severity: Severity.INFO,
      eventType: updated
        ? 'BEHAVIORAL_PROFILE_UPDATED'
        : 'BEHAVIORAL_PROFILE_GENERATED',
      message: updated
        ? 'Perfil comportamental atualizado'
        : 'Perfil comportamental gerado',
      metadata: {
        userId,
        profileId,
        communicationStyle: evaluation.communicationStyle,
        dominantMotivation: evaluation.dominantMotivation,
        confidenceScore: evaluation.confidenceScore,
      },
    });
  }

  private followedByInteraction(
    responseTimes: Date[],
    interactionTimes: Date[],
  ): number {
    return responseTimes.filter((responseAt) =>
      interactionTimes.some(
        (interactionAt) =>
          interactionAt > responseAt &&
          interactionAt.getTime() - responseAt.getTime() <= 48 * 60 * 60 * 1000,
      ),
    ).length;
  }

  private motivationLine(
    motivation: BehavioralMotivationStyle,
    trigger: string | undefined,
    stage: StageOfChange,
  ): string {
    if (stage === StageOfChange.PRE_CONTEMPLATION) {
      return 'Sem pressão: observe apenas uma escolha de hoje e decida se ela aproxima você do que valoriza.';
    }

    if (stage === StageOfChange.CONTEMPLATION) {
      return 'Escolha um benefício que realmente importa para você e transforme-o em um primeiro passo pequeno.';
    }

    if (trigger === 'FAMILY') {
      return 'Cuidar da sua rotina também protege a energia que você leva para quem importa.';
    }

    const lines: Record<BehavioralMotivationStyle, string> = {
      [BehavioralMotivationStyle.HEALTH]:
        'Priorize uma ação que melhore sua energia e seja repetível amanhã.',
      [BehavioralMotivationStyle.AESTHETICS]:
        'Mudanças visíveis vêm da repetição de escolhas sustentáveis, não de perfeição.',
      [BehavioralMotivationStyle.PERFORMANCE]:
        'Use a próxima escolha como suporte concreto para seu desempenho.',
      [BehavioralMotivationStyle.LONGEVITY]:
        'O valor está em construir uma rotina que continue funcionando no longo prazo.',
      [BehavioralMotivationStyle.SELF_ESTEEM]:
        'Cada compromisso cumprido reforça a confiança no processo que você está construindo.',
    };

    return lines[motivation];
  }

  private page<T extends { id: string }>(records: T[], limit: number) {
    const hasMore = records.length > limit;
    const items = hasMore ? records.slice(0, limit) : records;

    return {
      items,
      nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
    };
  }

  private utcDay(value: Date): Date {
    return new Date(
      Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
    );
  }
}
