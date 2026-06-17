import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  NutritionInsightStatus,
  Prisma,
  RecommendationCategory,
  RecommendationPriority,
  RecommendationStatus,
  Severity,
} from '@prisma/client';
import { EventService } from '../observability/event.service';
import { PrismaService } from '../prisma/prisma.service';
import { BehavioralRecommendationEngineService } from './behavioral-recommendation-engine.service';
import { ListRecommendationsDto } from './dto/list-recommendations.dto';
import { RecommendationCandidate } from './interfaces/recommendation.interface';
import { NutritionRecommendationEngineService } from './nutrition-recommendation-engine.service';
import { RecommendationScoringService } from './recommendation-scoring.service';
import { RetentionRecommendationEngineService } from './retention-recommendation-engine.service';
import { LongitudinalService } from '../longitudinal/longitudinal.service';

const RECOMMENDATION_SOURCE = 'RECOMMENDATION_ENGINE';
const RECOMMENDATION_TTL_DAYS = 7;
const MAX_ACTIVE_RECOMMENDATIONS = 8;

@Injectable()
export class RecommendationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly nutritionEngine: NutritionRecommendationEngineService,
    private readonly behavioralEngine: BehavioralRecommendationEngineService,
    private readonly retentionEngine: RetentionRecommendationEngineService,
    private readonly scoring: RecommendationScoringService,
    private readonly events: EventService,
    private readonly longitudinal: LongitudinalService,
  ) {}

  async refreshForUser(userId: string, at = new Date()) {
    return this.prisma.$transaction(async (transaction) => {
      await this.lock(transaction, `recommendations:${userId}`);
      await this.expireDueInTransaction(transaction, at, userId);

      const [
        user,
        insights,
        trends,
        patterns,
        behavioralProfile,
        motivations,
        adherence,
        stage,
        triggers,
        engagement,
        consistency,
        churn,
        feedback,
      ] = await Promise.all([
        transaction.user.findUnique({
          where: { id: userId },
          select: {
            nutritionProfile: {
              select: {
                goal: true,
                restrictions: true,
                allergies: true,
              },
            },
            fitnessProfile: {
              select: {
                goal: true,
              },
            },
            goalClassification: {
              select: {
                goal: true,
              },
            },
          },
        }),
        transaction.nutritionInsight.findMany({
          where: {
            userId,
            status: NutritionInsightStatus.ACTIVE,
          },
          select: {
            type: true,
            title: true,
            occurrences: true,
          },
          orderBy: [{ occurrences: 'desc' }, { lastDetectedAt: 'desc' }],
        }),
        transaction.nutritionTrend.findMany({
          where: { userId },
          select: {
            windowDays: true,
            mealsAnalyzed: true,
            direction: true,
            consistencyScore: true,
            goalAdherenceScore: true,
          },
          orderBy: [{ calculatedAt: 'desc' }, { id: 'desc' }],
        }),
        transaction.mealPattern.findMany({
          where: { userId },
          select: {
            category: true,
            mealCount: true,
            frequencyPerWeek: true,
            averageQualityScore: true,
          },
          orderBy: [{ mealCount: 'desc' }, { category: 'asc' }],
        }),
        transaction.behavioralProfile.findUnique({
          where: { userId },
          select: {
            communicationStyle: true,
            motivationStyle: true,
            adherenceStyle: true,
            confidenceScore: true,
          },
        }),
        transaction.behavioralMotivation.findMany({
          where: { userId },
          select: {
            type: true,
            weight: true,
          },
          orderBy: [{ weight: 'desc' }, { type: 'asc' }],
        }),
        transaction.adherencePrediction.findFirst({
          where: { userId },
          select: {
            score: true,
            consistencyScore: true,
            responseScore: true,
          },
          orderBy: [{ calculatedAt: 'desc' }, { id: 'desc' }],
        }),
        transaction.stageOfChangeHistory.findFirst({
          where: { userId },
          select: { stage: true },
          orderBy: [{ detectedAt: 'desc' }, { id: 'desc' }],
        }),
        transaction.motivationTrigger.findMany({
          where: { userId, active: true },
          select: {
            type: true,
            weight: true,
          },
          orderBy: [{ weight: 'desc' }, { type: 'asc' }],
        }),
        transaction.engagementScore.findFirst({
          where: { userId },
          select: {
            score: true,
            messagesLast7Days: true,
            analysesLast7Days: true,
          },
          orderBy: [{ calculatedAt: 'desc' }, { id: 'desc' }],
        }),
        transaction.consistencyScore.findFirst({
          where: { userId },
          select: {
            score: true,
            continuityScore: true,
          },
          orderBy: [{ calculatedAt: 'desc' }, { id: 'desc' }],
        }),
        transaction.churnRiskAssessment.findFirst({
          where: { userId },
          select: {
            level: true,
            daysInactive: true,
            activityDrop: true,
          },
          orderBy: [{ assessedAt: 'desc' }, { id: 'desc' }],
        }),
        this.longitudinal.recommendationModifiers(transaction, userId),
      ]);

      if (!user) {
        throw new NotFoundException('Usuário não encontrado');
      }

      const candidates = [
        ...this.nutritionEngine.generate({
          goal:
            user.goalClassification?.goal ??
            user.nutritionProfile?.goal ??
            user.fitnessProfile?.goal ??
            null,
          restrictionsCount:
            this.jsonArrayLength(user.nutritionProfile?.restrictions) +
            this.jsonArrayLength(user.nutritionProfile?.allergies),
          insights,
          trends: this.latestTrends(trends),
          patterns: patterns.map((pattern) => ({
            ...pattern,
            category: pattern.category,
            frequencyPerWeek: pattern.frequencyPerWeek.toNumber(),
          })),
        }),
        ...this.behavioralEngine.generate({
          profile: behavioralProfile
            ? {
                ...behavioralProfile,
                communicationStyle: behavioralProfile.communicationStyle,
                adherenceStyle: behavioralProfile.adherenceStyle,
                confidenceScore: behavioralProfile.confidenceScore.toNumber(),
              }
            : null,
          motivations: motivations.map((motivation) => ({
            type: motivation.type,
            weight: motivation.weight.toNumber(),
          })),
          adherence,
          stage: stage?.stage ?? null,
          triggers: triggers.map((trigger) => ({
            type: trigger.type,
            weight: trigger.weight.toNumber(),
          })),
        }),
        ...this.retentionEngine.generate({
          engagement,
          consistency,
          churn: churn
            ? {
                ...churn,
                level: churn.level,
              }
            : null,
        }),
      ];
      const selected = this.selectCandidates(
        this.applyFeedback(candidates, feedback),
      );

      for (const candidate of selected) {
        await this.persistCandidate(transaction, userId, candidate, at);
      }

      await this.recalculateSnapshotInTransaction(transaction, at);

      return transaction.recommendation.findMany({
        where: {
          userId,
          status: RecommendationStatus.ACTIVE,
          OR: [{ expiresAt: null }, { expiresAt: { gt: at } }],
        },
        orderBy: [
          { priority: 'desc' },
          { confidenceScore: 'desc' },
          { generatedAt: 'desc' },
        ],
        take: MAX_ACTIVE_RECOMMENDATIONS,
      });
    });
  }

  async accept(id: string, at = new Date()) {
    return this.transition(
      id,
      RecommendationStatus.ACCEPTED,
      'RECOMMENDATION_ACCEPTED',
      at,
    );
  }

  async dismiss(id: string, at = new Date()) {
    return this.transition(
      id,
      RecommendationStatus.DISMISSED,
      'RECOMMENDATION_DISMISSED',
      at,
    );
  }

  async list(query: ListRecommendationsDto) {
    await this.expireDue(new Date());
    const limit = query.limit ?? 50;
    const records = await this.prisma.recommendation.findMany({
      where: {
        userId: query.userId,
        category: query.category,
        priority: query.priority,
        status: query.status,
        generatedAt: this.dateRange(query.from, query.to),
      },
      orderBy: [{ generatedAt: 'desc' }, { id: 'desc' }],
      cursor: query.cursor ? { id: query.cursor } : undefined,
      skip: query.cursor ? 1 : undefined,
      take: limit + 1,
    });
    const hasMore = records.length > limit;
    const items = hasMore ? records.slice(0, limit) : records;

    return {
      items,
      nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
    };
  }

  async stats(query: ListRecommendationsDto) {
    await this.expireDue(new Date());
    const limit = query.limit ?? 50;
    const snapshots = await this.prisma.recommendationDailySnapshot.findMany({
      where: {
        snapshotDate: this.dateRange(query.from, query.to),
      },
      orderBy: [{ snapshotDate: 'desc' }, { id: 'desc' }],
      cursor: query.cursor ? { id: query.cursor } : undefined,
      skip: query.cursor ? 1 : undefined,
      take: limit + 1,
    });
    const hasMore = snapshots.length > limit;
    const items = hasMore ? snapshots.slice(0, limit) : snapshots;

    return {
      items,
      nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
    };
  }

  private async transition(
    id: string,
    target: RecommendationStatus,
    eventType: 'RECOMMENDATION_ACCEPTED' | 'RECOMMENDATION_DISMISSED',
    at: Date,
  ) {
    const outcome = await this.prisma.$transaction(async (transaction) => {
      await this.lock(transaction, `recommendation:${id}`);
      const current = await transaction.recommendation.findUnique({
        where: { id },
      });

      if (!current) {
        throw new NotFoundException('Recomendação não encontrada');
      }

      if (
        current.status === RecommendationStatus.ACTIVE &&
        current.expiresAt &&
        current.expiresAt <= at
      ) {
        const recommendation = await this.expireRecommendation(
          transaction,
          current,
          at,
        );
        await this.recalculateSnapshotInTransaction(transaction, at);
        await this.longitudinal.refreshRecommendationFeedbackInTransaction(
          transaction,
          current.userId,
          `${current.id}:${RecommendationStatus.EXPIRED}`,
          at,
        );
        return { expired: true, recommendation };
      }

      if (current.status === target) {
        return { expired: false, recommendation: current };
      }

      if (current.status !== RecommendationStatus.ACTIVE) {
        throw new ConflictException('Recomendação já finalizada');
      }

      const recommendation = await transaction.recommendation.update({
        where: { id },
        data:
          target === RecommendationStatus.ACCEPTED
            ? {
                status: target,
                acceptedAt: at,
              }
            : {
                status: target,
                dismissedAt: at,
              },
      });

      await this.recordEvent(transaction, {
        eventType,
        recommendation,
        at,
      });
      await this.recalculateSnapshotInTransaction(transaction, at);
      await this.longitudinal.refreshRecommendationFeedbackInTransaction(
        transaction,
        recommendation.userId,
        `${recommendation.id}:${target}`,
        at,
      );

      return { expired: false, recommendation };
    });

    if (outcome.expired) {
      throw new ConflictException('Recomendação expirada');
    }

    return outcome.recommendation;
  }

  private async persistCandidate(
    transaction: Prisma.TransactionClient,
    userId: string,
    candidate: RecommendationCandidate,
    at: Date,
  ) {
    const sourceKey = `${candidate.signalKey}:${this.weekKey(at)}`;
    const alreadyHandled = await transaction.recommendation.findUnique({
      where: {
        userId_sourceKey: {
          userId,
          sourceKey,
        },
      },
    });

    if (
      alreadyHandled &&
      alreadyHandled.status !== RecommendationStatus.ACTIVE
    ) {
      return;
    }

    const active = await transaction.recommendation.findFirst({
      where: {
        userId,
        signalKey: candidate.signalKey,
        status: RecommendationStatus.ACTIVE,
      },
      orderBy: [{ generatedAt: 'desc' }, { id: 'desc' }],
    });
    const content = {
      category: candidate.category,
      priority: candidate.priority,
      signalKey: candidate.signalKey,
      sourceKey,
      title: candidate.title,
      description: candidate.description,
      reason: candidate.reason,
      confidenceScore: this.scoring.calculate(candidate.confidence),
      evidence: candidate.evidence,
      expiresAt: new Date(at.getTime() + RECOMMENDATION_TTL_DAYS * 86_400_000),
    };

    if (active || alreadyHandled) {
      return transaction.recommendation.update({
        where: { id: (active ?? alreadyHandled)!.id },
        data: content,
      });
    }

    const recommendation = await transaction.recommendation.create({
      data: {
        userId,
        ...content,
        generatedAt: at,
      },
    });

    await this.recordEvent(transaction, {
      eventType: 'RECOMMENDATION_GENERATED',
      recommendation,
      at,
    });

    return recommendation;
  }

  private async expireDue(at: Date, userId?: string) {
    return this.prisma.$transaction(async (transaction) => {
      await this.lock(
        transaction,
        userId ? `recommendations:${userId}` : 'recommendations:expiry',
      );
      const count = await this.expireDueInTransaction(transaction, at, userId);

      if (count > 0) {
        await this.recalculateSnapshotInTransaction(transaction, at);
      }

      return count;
    });
  }

  private async expireDueInTransaction(
    transaction: Prisma.TransactionClient,
    at: Date,
    userId?: string,
  ) {
    const due = await transaction.recommendation.findMany({
      where: {
        userId,
        status: RecommendationStatus.ACTIVE,
        expiresAt: { lte: at },
      },
    });

    for (const recommendation of due) {
      await this.expireRecommendation(transaction, recommendation, at);
    }

    return due.length;
  }

  private async expireRecommendation(
    transaction: Prisma.TransactionClient,
    recommendation: {
      id: string;
      userId: string;
      category: RecommendationCategory;
      priority: RecommendationPriority;
      confidenceScore: number;
    },
    at: Date,
  ) {
    const expired = await transaction.recommendation.update({
      where: { id: recommendation.id },
      data: {
        status: RecommendationStatus.EXPIRED,
        expiredAt: at,
      },
    });

    await this.recordEvent(transaction, {
      eventType: 'RECOMMENDATION_EXPIRED',
      recommendation: expired,
      at,
    });
    await this.longitudinal.refreshRecommendationFeedbackInTransaction(
      transaction,
      recommendation.userId,
      `${recommendation.id}:${RecommendationStatus.EXPIRED}`,
      at,
    );

    return expired;
  }

  private async recalculateSnapshotInTransaction(
    transaction: Prisma.TransactionClient,
    at: Date,
  ) {
    const snapshotDate = this.utcDay(at);
    const end = new Date(snapshotDate.getTime() + 86_400_000);
    await this.lock(
      transaction,
      `recommendation-snapshot:${snapshotDate.toISOString()}`,
    );
    const [
      generatedCount,
      acceptedCount,
      dismissedCount,
      expiredCount,
      activeCount,
      categoryGroups,
    ] = await Promise.all([
      transaction.recommendation.count({
        where: { generatedAt: { gte: snapshotDate, lt: end } },
      }),
      transaction.recommendation.count({
        where: { acceptedAt: { gte: snapshotDate, lt: end } },
      }),
      transaction.recommendation.count({
        where: { dismissedAt: { gte: snapshotDate, lt: end } },
      }),
      transaction.recommendation.count({
        where: { expiredAt: { gte: snapshotDate, lt: end } },
      }),
      transaction.recommendation.count({
        where: {
          status: RecommendationStatus.ACTIVE,
          OR: [{ expiresAt: null }, { expiresAt: { gt: at } }],
        },
      }),
      transaction.recommendation.groupBy({
        by: ['category'],
        where: { generatedAt: { gte: snapshotDate, lt: end } },
        _count: { _all: true },
      }),
    ]);
    const byCategory = Object.fromEntries(
      categoryGroups.map((group) => [group.category, group._count._all]),
    );

    return transaction.recommendationDailySnapshot.upsert({
      where: { snapshotDate },
      update: {
        generatedCount,
        acceptedCount,
        dismissedCount,
        expiredCount,
        activeCount,
        byCategory,
        generatedAt: at,
      },
      create: {
        snapshotDate,
        generatedCount,
        acceptedCount,
        dismissedCount,
        expiredCount,
        activeCount,
        byCategory,
        generatedAt: at,
      },
    });
  }

  private recordEvent(
    transaction: Prisma.TransactionClient,
    input: {
      eventType:
        | 'RECOMMENDATION_GENERATED'
        | 'RECOMMENDATION_ACCEPTED'
        | 'RECOMMENDATION_DISMISSED'
        | 'RECOMMENDATION_EXPIRED';
      recommendation: {
        id: string;
        userId: string;
        category: RecommendationCategory;
        priority: RecommendationPriority;
        confidenceScore: number;
      };
      at: Date;
    },
  ) {
    return this.events.recordInTransaction(transaction, {
      source: RECOMMENDATION_SOURCE,
      severity:
        input.recommendation.priority === RecommendationPriority.CRITICAL
          ? Severity.WARNING
          : Severity.INFO,
      eventType: input.eventType,
      message: this.eventMessage(input.eventType),
      metadata: {
        userId: input.recommendation.userId,
        recommendationId: input.recommendation.id,
        category: input.recommendation.category,
        priority: input.recommendation.priority,
        confidenceScore: input.recommendation.confidenceScore,
        occurredAt: input.at.toISOString(),
      },
    });
  }

  private selectCandidates(
    candidates: RecommendationCandidate[],
  ): RecommendationCandidate[] {
    const priorityWeight: Record<RecommendationPriority, number> = {
      [RecommendationPriority.LOW]: 1,
      [RecommendationPriority.MEDIUM]: 2,
      [RecommendationPriority.HIGH]: 3,
      [RecommendationPriority.CRITICAL]: 4,
    };
    const unique = new Map<string, RecommendationCandidate>();

    for (const candidate of candidates) {
      const current = unique.get(candidate.signalKey);

      if (
        !current ||
        priorityWeight[candidate.priority] > priorityWeight[current.priority]
      ) {
        unique.set(candidate.signalKey, candidate);
      }
    }

    return [...unique.values()]
      .sort(
        (left, right) =>
          priorityWeight[right.priority] - priorityWeight[left.priority],
      )
      .filter((candidate, index, all) => {
        const categoryPosition = all
          .slice(0, index)
          .filter((item) => item.category === candidate.category).length;
        return categoryPosition < 2;
      })
      .slice(0, MAX_ACTIVE_RECOMMENDATIONS);
  }

  applyFeedback(
    candidates: RecommendationCandidate[],
    feedback: {
      categories: Record<string, number>;
      signals: Record<string, number>;
    },
  ): RecommendationCandidate[] {
    return candidates.map((candidate) => {
      const modifier =
        (feedback.categories[candidate.category] ?? 0) +
        (feedback.signals[candidate.signalKey] ?? 0);

      return {
        ...candidate,
        confidence: {
          ...candidate.confidence,
          signalStrength: Math.max(
            0,
            Math.min(100, candidate.confidence.signalStrength + modifier),
          ),
        },
      };
    });
  }

  private latestTrends<
    T extends {
      windowDays: number;
    },
  >(trends: T[]): T[] {
    const latest = new Map<number, T>();

    for (const trend of trends) {
      if (!latest.has(trend.windowDays)) {
        latest.set(trend.windowDays, trend);
      }
    }

    return [...latest.values()];
  }

  private eventMessage(eventType: string): string {
    const messages: Record<string, string> = {
      RECOMMENDATION_GENERATED: 'Recomendação contextual gerada',
      RECOMMENDATION_ACCEPTED: 'Recomendação aceita',
      RECOMMENDATION_DISMISSED: 'Recomendação rejeitada',
      RECOMMENDATION_EXPIRED: 'Recomendação expirada',
    };

    return messages[eventType];
  }

  private dateRange(
    from?: string,
    to?: string,
  ): Prisma.DateTimeFilter | undefined {
    if (!from && !to) {
      return undefined;
    }

    return {
      gte: from ? new Date(from) : undefined,
      lte: to ? new Date(to) : undefined,
    };
  }

  private jsonArrayLength(value: Prisma.JsonValue | undefined): number {
    return Array.isArray(value) ? value.length : 0;
  }

  private weekKey(value: Date): string {
    const day = this.utcDay(value);
    const weekday = day.getUTCDay() || 7;
    day.setUTCDate(day.getUTCDate() - weekday + 1);
    return day.toISOString().slice(0, 10);
  }

  private utcDay(value: Date): Date {
    return new Date(
      Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
    );
  }

  private lock(transaction: Prisma.TransactionClient, key: string) {
    return transaction.$queryRaw`
      WITH advisory_lock AS (
        SELECT pg_advisory_xact_lock(hashtext(${key}))
      )
      SELECT true AS "locked"
      FROM advisory_lock
    `;
  }
}
