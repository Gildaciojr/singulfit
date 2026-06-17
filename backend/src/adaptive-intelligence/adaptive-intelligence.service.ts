import { Injectable, NotFoundException } from '@nestjs/common';
import {
  DietaryPatternSnapshot,
  LongitudinalNutritionWindowSnapshot,
  MessageDirection,
  Prisma,
  RecommendationStatus,
  Severity,
} from '@prisma/client';
import { EventService } from '../observability/event.service';
import { PrismaService } from '../prisma/prisma.service';
import { AdaptiveIntelligenceCalculatorService } from './adaptive-intelligence-calculator.service';
import { ListAdaptiveIntelligenceDto } from './dto/list-adaptive-intelligence.dto';
import { AdaptiveIntelligenceSignals } from './interfaces/adaptive-intelligence.interface';

const SOURCE = 'ADAPTIVE_INTELLIGENCE';
const DAY_MS = 86_400_000;
const WINDOWS = [7, 30, 90] as const;

@Injectable()
export class AdaptiveIntelligenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly calculator: AdaptiveIntelligenceCalculatorService,
    private readonly events: EventService,
  ) {}

  refreshForUser(userId: string, at = new Date()) {
    return this.prisma.$transaction(
      (transaction) => this.refreshInTransaction(transaction, userId, at),
      {
        maxWait: 5_000,
        timeout: 30_000,
      },
    );
  }

  async refreshInTransaction(
    transaction: Prisma.TransactionClient,
    userId: string,
    at = new Date(),
  ): Promise<AdaptiveIntelligenceSignals> {
    const snapshotDate = this.utcDay(at);
    const historyStart = new Date(at.getTime() - 180 * DAY_MS);
    const learningStart = new Date(at.getTime() - 90 * DAY_MS);
    const messageStart = new Date(at.getTime() - 30 * DAY_MS);

    await transaction.$queryRaw`
      WITH advisory_lock AS (
        SELECT pg_advisory_xact_lock(
          hashtext(${`adaptive-intelligence:${userId}:${snapshotDate.toISOString().slice(0, 10)}`})
        )
      )
      SELECT true AS "locked"
      FROM advisory_lock
    `;

    const [
      user,
      qualityHistory,
      recommendations,
      behavioralProfile,
      previousCommunication,
      adherence,
      engagement,
      consistency,
      habit,
      activation,
      messages,
      coachMessages,
      memories,
      recentRanks,
    ] = await Promise.all([
      transaction.user.findUnique({
        where: { id: userId },
        select: { id: true },
      }),
      transaction.nutritionQualityScore.findMany({
        where: {
          userId,
          calculatedAt: { gte: historyStart, lte: at },
        },
        include: {
          mealAnalysis: {
            select: {
              hydrationMl: true,
              vegetableGrams: true,
              items: {
                select: { foodName: true },
                orderBy: { id: 'asc' },
              },
            },
          },
        },
        orderBy: [{ calculatedAt: 'desc' }, { id: 'desc' }],
        take: 500,
      }),
      transaction.recommendation.findMany({
        where: {
          userId,
          generatedAt: { gte: learningStart, lte: at },
        },
        select: {
          id: true,
          category: true,
          signalKey: true,
          priority: true,
          confidenceScore: true,
          status: true,
          generatedAt: true,
        },
        orderBy: [{ generatedAt: 'desc' }, { id: 'desc' }],
        take: 300,
      }),
      transaction.behavioralProfile.findUnique({
        where: { userId },
        select: {
          communicationStyle: true,
        },
      }),
      transaction.communicationAdaptationSnapshot.findFirst({
        where: {
          userId,
          snapshotDate: { lt: snapshotDate },
        },
        orderBy: [{ snapshotDate: 'desc' }, { id: 'desc' }],
      }),
      transaction.adherencePrediction.findFirst({
        where: { userId },
        orderBy: [{ calculatedAt: 'desc' }, { id: 'desc' }],
      }),
      transaction.engagementScore.findFirst({
        where: { userId },
        orderBy: [{ calculatedAt: 'desc' }, { id: 'desc' }],
      }),
      transaction.consistencyScore.findFirst({
        where: { userId },
        orderBy: [{ calculatedAt: 'desc' }, { id: 'desc' }],
      }),
      transaction.habitSnapshot.findFirst({
        where: { userId },
        orderBy: [{ calculatedAt: 'desc' }, { id: 'desc' }],
      }),
      transaction.activationSnapshot.findFirst({
        where: { userId },
        orderBy: [{ generatedAt: 'desc' }, { id: 'desc' }],
      }),
      transaction.message.findMany({
        where: {
          conversation: { userId },
          direction: MessageDirection.INBOUND,
          timestamp: { gte: messageStart, lte: at },
        },
        select: {
          content: true,
          timestamp: true,
        },
        orderBy: [{ timestamp: 'asc' }, { id: 'asc' }],
        take: 300,
      }),
      transaction.coachMessage.findMany({
        where: {
          userId,
          generatedAt: { gte: messageStart, lte: at },
        },
        select: {
          content: true,
          generatedAt: true,
        },
        orderBy: [{ generatedAt: 'asc' }, { id: 'asc' }],
        take: 100,
      }),
      transaction.longitudinalMemory.findMany({
        where: { userId },
        select: {
          kind: true,
          title: true,
          summary: true,
        },
        orderBy: [{ generatedAt: 'desc' }, { id: 'desc' }],
        take: 12,
      }),
      transaction.adaptiveRecommendationRank.findMany({
        where: {
          userId,
          snapshotDate: { lt: snapshotDate },
        },
        select: { recommendationId: true },
        orderBy: [{ snapshotDate: 'desc' }, { rank: 'asc' }],
        take: 12,
      }),
    ]);

    if (!user) {
      throw new NotFoundException('Usuário não encontrado');
    }

    const mealSignals = qualityHistory.map((item) => ({
      score: item.score,
      proteinScore: item.proteinScore,
      fiberScore: item.fiberScore,
      ultraProcessedScore: item.ultraProcessedScore,
      sugarScore: item.sugarScore,
      vegetableGrams: item.mealAnalysis.vegetableGrams?.toNumber() ?? 0,
      hydrationMl: item.mealAnalysis.hydrationMl?.toNumber() ?? 0,
      foods: item.mealAnalysis.items.map((food) => food.foodName),
      calculatedAt: item.calculatedAt,
      mealAnalysisId: item.mealAnalysisId,
    }));
    const evidenceMeals = mealSignals.filter(
      (meal) => meal.calculatedAt >= new Date(at.getTime() - 30 * DAY_MS),
    );
    const evidence = this.calculator.nutritionEvidence(evidenceMeals);
    const patterns = this.calculator.dietaryPatterns(evidenceMeals);
    const learning = this.calculator.learning(
      recommendations,
      messages.map((message) => message.content),
      at,
    );
    const currentCoachCommunication =
      await transaction.coachCommunicationProfileSnapshot.findFirst({
        where: { userId },
        orderBy: [{ generatedAt: 'desc' }, { id: 'desc' }],
        select: { dominantStyle: true },
      });
    const communication = this.calculator.communication({
      behavioralStyle: behavioralProfile?.communicationStyle ?? null,
      coachStyle: currentCoachCommunication?.dominantStyle ?? null,
      shortMessagePreference:
        messages.length > 0 &&
        this.average(messages.map((message) => message.content.length)) <= 80,
      shortChallengeScore: learning.shortChallengeScore,
      previous: previousCommunication
        ? {
            profile: previousCommunication.profile,
            scores: {
              EXECUTIVE: previousCommunication.executiveScore,
              TECHNICAL: previousCommunication.technicalScore,
              DISCIPLINED: previousCommunication.disciplinedScore,
              WARM: previousCommunication.warmScore,
              INSPIRATIONAL: previousCommunication.inspirationalScore,
            },
          }
        : null,
    });
    const coachResponses = this.followedByInteraction(
      coachMessages.map((message) => message.generatedAt),
      messages.map((message) => message.timestamp),
    );
    const coachScore =
      coachMessages.length === 0
        ? 30
        : Math.round((coachResponses / coachMessages.length) * 100);
    const churn = this.calculator.earlyChurn({
      engagementScore: engagement?.score ?? 0,
      consistencyScore: consistency?.score ?? 0,
      responseScore: adherence?.responseScore ?? 0,
      usageScore: engagement?.weeklyUsageScore ?? 0,
      analysisScore: engagement?.analysesScore ?? 0,
      coachScore,
      daysInactive: habit?.daysSinceInteraction ?? 30,
      activationRisk: activation?.riskLevel ?? null,
    });
    const activeRecommendations = recommendations.filter(
      (recommendation) => recommendation.status === RecommendationStatus.ACTIVE,
    );
    const rankings = this.calculator.rankRecommendations(
      activeRecommendations,
      {
        topicScores: learning.topicScores,
        ignoredTopics: learning.ignoredTopics,
        churnLevel: churn.level,
        recentRecommendationIds: recentRanks.map(
          (ranking) => ranking.recommendationId,
        ),
      },
    );
    const evolution = WINDOWS.map((windowDays) => {
      const currentStart = new Date(at.getTime() - windowDays * DAY_MS);
      const previousStart = new Date(at.getTime() - windowDays * 2 * DAY_MS);
      const currentMeals = mealSignals.filter(
        (meal) => meal.calculatedAt >= currentStart,
      );
      const previousMeals = mealSignals.filter(
        (meal) =>
          meal.calculatedAt >= previousStart &&
          meal.calculatedAt < currentStart,
      );

      return {
        windowDays,
        ...this.calculator.evolution(currentMeals, previousMeals),
      };
    });

    const evidenceRecord = await transaction.nutritionEvidenceSnapshot.upsert({
      where: { userId_snapshotDate: { userId, snapshotDate } },
      update: {
        ...evidence,
        evidence: {
          windowDays: 30,
          methodology: 'DETERMINISTIC_WEIGHTED_DIMENSIONS_V1',
        },
        calculatedAt: at,
      },
      create: {
        userId,
        snapshotDate,
        ...evidence,
        evidence: {
          windowDays: 30,
          methodology: 'DETERMINISTIC_WEIGHTED_DIMENSIONS_V1',
        },
        calculatedAt: at,
      },
    });

    const latestMeal = mealSignals[0];
    let latestFoodQuality: AdaptiveIntelligenceSignals['foodQuality'] = null;

    for (const meal of mealSignals.slice(0, 30)) {
      const foodQuality = this.calculator.foodQuality(meal);
      await transaction.foodQualityIndex.upsert({
        where: { mealAnalysisId: meal.mealAnalysisId },
        update: {
          qualityClass: foodQuality.qualityClass,
          score: foodQuality.score,
          positiveFactors: foodQuality.positiveFactors,
          limitingFactors: foodQuality.limitingFactors,
          explanation: foodQuality.explanation,
          calculatedAt: at,
        },
        create: {
          userId,
          mealAnalysisId: meal.mealAnalysisId,
          qualityClass: foodQuality.qualityClass,
          score: foodQuality.score,
          positiveFactors: foodQuality.positiveFactors,
          limitingFactors: foodQuality.limitingFactors,
          explanation: foodQuality.explanation,
          calculatedAt: at,
        },
      });

      if (meal === latestMeal) latestFoodQuality = foodQuality;
    }

    const patternRecords: DietaryPatternSnapshot[] = [];
    for (const pattern of patterns) {
      patternRecords.push(
        await transaction.dietaryPatternSnapshot.upsert({
          where: {
            userId_snapshotDate_pattern: {
              userId,
              snapshotDate,
              pattern: pattern.pattern,
            },
          },
          update: {
            confidence: new Prisma.Decimal(pattern.confidence.toFixed(4)),
            active: true,
            evidence: pattern.evidence,
            calculatedAt: at,
          },
          create: {
            userId,
            snapshotDate,
            pattern: pattern.pattern,
            confidence: new Prisma.Decimal(pattern.confidence.toFixed(4)),
            active: true,
            evidence: pattern.evidence,
            calculatedAt: at,
          },
        }),
      );
    }

    const learningRecord = await transaction.userLearningProfile.upsert({
      where: { userId },
      update: {
        acceptedCount: learning.acceptedCount,
        ignoredCount: learning.ignoredCount,
        rejectedCount: learning.rejectedCount,
        shortChallengeScore: learning.shortChallengeScore,
        preferredTopics: learning.preferredTopics,
        ignoredTopics: learning.ignoredTopics,
        topicScores: learning.topicScores,
        confidence: new Prisma.Decimal(learning.confidence.toFixed(4)),
        evidence: { sampleSize: learning.sampleSize, windowDays: 90 },
        generatedAt: at,
      },
      create: {
        userId,
        acceptedCount: learning.acceptedCount,
        ignoredCount: learning.ignoredCount,
        rejectedCount: learning.rejectedCount,
        shortChallengeScore: learning.shortChallengeScore,
        preferredTopics: learning.preferredTopics,
        ignoredTopics: learning.ignoredTopics,
        topicScores: learning.topicScores,
        confidence: new Prisma.Decimal(learning.confidence.toFixed(4)),
        evidence: { sampleSize: learning.sampleSize, windowDays: 90 },
        generatedAt: at,
      },
    });
    const communicationRecord =
      await transaction.communicationAdaptationSnapshot.upsert({
        where: { userId_snapshotDate: { userId, snapshotDate } },
        update: {
          profile: communication.profile,
          previousProfile: communication.previousProfile,
          executiveScore: communication.scores.EXECUTIVE,
          technicalScore: communication.scores.TECHNICAL,
          disciplinedScore: communication.scores.DISCIPLINED,
          warmScore: communication.scores.WARM,
          inspirationalScore: communication.scores.INSPIRATIONAL,
          idealLength: communication.idealLength,
          structurePreference: communication.structurePreference,
          confidence: new Prisma.Decimal(communication.confidence.toFixed(4)),
          evidence: {
            behavioralStyle: behavioralProfile?.communicationStyle ?? null,
            coachStyle: currentCoachCommunication?.dominantStyle ?? null,
          },
          generatedAt: at,
        },
        create: {
          userId,
          snapshotDate,
          profile: communication.profile,
          previousProfile: communication.previousProfile,
          executiveScore: communication.scores.EXECUTIVE,
          technicalScore: communication.scores.TECHNICAL,
          disciplinedScore: communication.scores.DISCIPLINED,
          warmScore: communication.scores.WARM,
          inspirationalScore: communication.scores.INSPIRATIONAL,
          idealLength: communication.idealLength,
          structurePreference: communication.structurePreference,
          confidence: new Prisma.Decimal(communication.confidence.toFixed(4)),
          evidence: {
            behavioralStyle: behavioralProfile?.communicationStyle ?? null,
            coachStyle: currentCoachCommunication?.dominantStyle ?? null,
          },
          generatedAt: at,
        },
      });
    const churnRecord = await transaction.earlyChurnSnapshot.upsert({
      where: { userId_snapshotDate: { userId, snapshotDate } },
      update: {
        score: churn.score,
        level: churn.level,
        engagementScore: engagement?.score ?? 0,
        consistencyScore: consistency?.score ?? 0,
        responseScore: adherence?.responseScore ?? 0,
        usageScore: engagement?.weeklyUsageScore ?? 0,
        analysisScore: engagement?.analysesScore ?? 0,
        coachScore,
        reasons: churn.reasons,
        evidence: {
          daysInactive: habit?.daysSinceInteraction ?? 30,
          activationRisk: activation?.riskLevel ?? null,
        },
        calculatedAt: at,
      },
      create: {
        userId,
        snapshotDate,
        score: churn.score,
        level: churn.level,
        engagementScore: engagement?.score ?? 0,
        consistencyScore: consistency?.score ?? 0,
        responseScore: adherence?.responseScore ?? 0,
        usageScore: engagement?.weeklyUsageScore ?? 0,
        analysisScore: engagement?.analysesScore ?? 0,
        coachScore,
        reasons: churn.reasons,
        evidence: {
          daysInactive: habit?.daysSinceInteraction ?? 30,
          activationRisk: activation?.riskLevel ?? null,
        },
        calculatedAt: at,
      },
    });

    for (const ranking of rankings) {
      await transaction.adaptiveRecommendationRank.upsert({
        where: {
          userId_snapshotDate_recommendationId: {
            userId,
            snapshotDate,
            recommendationId: ranking.recommendationId,
          },
        },
        update: {
          rank: ranking.rank,
          adaptiveScore: ranking.adaptiveScore,
          baseScore: ranking.baseScore,
          learningModifier: ranking.learningModifier,
          contextModifier: ranking.contextModifier,
          noveltyModifier: ranking.noveltyModifier,
          evidence: { topic: ranking.topic },
          rankedAt: at,
        },
        create: {
          userId,
          snapshotDate,
          recommendationId: ranking.recommendationId,
          rank: ranking.rank,
          adaptiveScore: ranking.adaptiveScore,
          baseScore: ranking.baseScore,
          learningModifier: ranking.learningModifier,
          contextModifier: ranking.contextModifier,
          noveltyModifier: ranking.noveltyModifier,
          evidence: { topic: ranking.topic },
          rankedAt: at,
        },
      });
    }

    const evolutionRecords: LongitudinalNutritionWindowSnapshot[] = [];
    for (const item of evolution) {
      evolutionRecords.push(
        await transaction.longitudinalNutritionWindowSnapshot.upsert({
          where: {
            userId_snapshotDate_windowDays: {
              userId,
              snapshotDate,
              windowDays: item.windowDays,
            },
          },
          update: {
            score: item.score,
            previousScore: item.previousScore,
            direction: item.direction,
            vegetableScore: item.vegetableScore,
            proteinScore: item.proteinScore,
            ultraProcessedScore: item.ultraProcessedScore,
            sugarScore: item.sugarScore,
            fiberScore: item.fiberScore,
            hydrationScore: item.hydrationScore,
            mealsAnalyzed: item.mealsAnalyzed,
            evidence: { windowDays: item.windowDays },
            calculatedAt: at,
          },
          create: {
            userId,
            snapshotDate,
            windowDays: item.windowDays,
            score: item.score,
            previousScore: item.previousScore,
            direction: item.direction,
            vegetableScore: item.vegetableScore,
            proteinScore: item.proteinScore,
            ultraProcessedScore: item.ultraProcessedScore,
            sugarScore: item.sugarScore,
            fiberScore: item.fiberScore,
            hydrationScore: item.hydrationScore,
            mealsAnalyzed: item.mealsAnalyzed,
            evidence: { windowDays: item.windowDays },
            calculatedAt: at,
          },
        }),
      );
    }

    await this.recordEvents(transaction, {
      userId,
      evidenceId: evidenceRecord.id,
      evidenceScore: evidence.score,
      foodQualityCount: Math.min(mealSignals.length, 30),
      patternIds: patternRecords.map((pattern) => pattern.id),
      learningId: learningRecord.id,
      communicationId: communicationRecord.id,
      churnId: churnRecord.id,
      churnScore: churn.score,
      rankingCount: rankings.length,
      memoryCount: memories.length,
    });

    return {
      nutritionEvidence: evidence,
      foodQuality: latestFoodQuality,
      dietaryPatterns: patternRecords.map((record) => ({
        pattern: record.pattern,
        confidence: record.confidence.toNumber(),
      })),
      learning: {
        acceptedCount: learning.acceptedCount,
        ignoredCount: learning.ignoredCount,
        rejectedCount: learning.rejectedCount,
        shortChallengeScore: learning.shortChallengeScore,
        preferredTopics: learning.preferredTopics,
        ignoredTopics: learning.ignoredTopics,
        topicScores: learning.topicScores,
        confidence: learning.confidence,
      },
      communication: {
        profile: communication.profile,
        confidence: communication.confidence,
        idealLength: communication.idealLength,
        structurePreference: communication.structurePreference,
      },
      earlyChurn: churn,
      recommendationRanking: rankings.map((ranking) => ({
        recommendationId: ranking.recommendationId,
        rank: ranking.rank,
        adaptiveScore: ranking.adaptiveScore,
      })),
      evolution: evolutionRecords.map((record) => ({
        windowDays: record.windowDays,
        score: record.score,
        previousScore: record.previousScore,
        direction: record.direction,
      })),
      coachMemory: memories,
    };
  }

  listEvidence(query: ListAdaptiveIntelligenceDto) {
    return this.page(
      this.prisma.nutritionEvidenceSnapshot.findMany({
        where: { userId: query.userId },
        orderBy: [{ calculatedAt: 'desc' }, { id: 'desc' }],
        cursor: query.cursor ? { id: query.cursor } : undefined,
        skip: query.cursor ? 1 : undefined,
        take: query.limit + 1,
      }),
      query.limit,
    );
  }

  listPatterns(query: ListAdaptiveIntelligenceDto) {
    return this.page(
      this.prisma.dietaryPatternSnapshot.findMany({
        where: { userId: query.userId },
        orderBy: [{ calculatedAt: 'desc' }, { id: 'desc' }],
        cursor: query.cursor ? { id: query.cursor } : undefined,
        skip: query.cursor ? 1 : undefined,
        take: query.limit + 1,
      }),
      query.limit,
    );
  }

  listLearning(query: ListAdaptiveIntelligenceDto) {
    return this.page(
      this.prisma.userLearningProfile.findMany({
        where: { userId: query.userId },
        orderBy: [{ generatedAt: 'desc' }, { id: 'desc' }],
        cursor: query.cursor ? { id: query.cursor } : undefined,
        skip: query.cursor ? 1 : undefined,
        take: query.limit + 1,
      }),
      query.limit,
    );
  }

  listCommunication(query: ListAdaptiveIntelligenceDto) {
    return this.page(
      this.prisma.communicationAdaptationSnapshot.findMany({
        where: { userId: query.userId },
        orderBy: [{ generatedAt: 'desc' }, { id: 'desc' }],
        cursor: query.cursor ? { id: query.cursor } : undefined,
        skip: query.cursor ? 1 : undefined,
        take: query.limit + 1,
      }),
      query.limit,
    );
  }

  listEarlyChurn(query: ListAdaptiveIntelligenceDto) {
    return this.page(
      this.prisma.earlyChurnSnapshot.findMany({
        where: { userId: query.userId },
        orderBy: [{ calculatedAt: 'desc' }, { id: 'desc' }],
        cursor: query.cursor ? { id: query.cursor } : undefined,
        skip: query.cursor ? 1 : undefined,
        take: query.limit + 1,
      }),
      query.limit,
    );
  }

  private async page<T extends { id: string }>(
    promise: Promise<T[]>,
    limit: number,
  ) {
    const records = await promise;
    const hasMore = records.length > limit;
    const items = hasMore ? records.slice(0, limit) : records;

    return {
      items,
      nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
    };
  }

  private async recordEvents(
    transaction: Prisma.TransactionClient,
    input: {
      userId: string;
      evidenceId: string;
      evidenceScore: number;
      foodQualityCount: number;
      patternIds: string[];
      learningId: string;
      communicationId: string;
      churnId: string;
      churnScore: number;
      rankingCount: number;
      memoryCount: number;
    },
  ) {
    const records = [
      {
        eventType: 'NUTRITION_EVIDENCE_RECALCULATED',
        message: 'Evidência nutricional recalculada',
        metadata: {
          userId: input.userId,
          snapshotId: input.evidenceId,
          score: input.evidenceScore,
        },
      },
      {
        eventType: 'FOOD_QUALITY_INDEX_UPDATED',
        message: 'Índice de qualidade alimentar atualizado',
        metadata: {
          userId: input.userId,
          mealsUpdated: input.foodQualityCount,
        },
      },
      {
        eventType: 'DIETARY_PATTERN_UPDATED',
        message: 'Padrões alimentares atualizados',
        metadata: {
          userId: input.userId,
          patternIds: input.patternIds,
        },
      },
      {
        eventType: 'USER_LEARNING_PROFILE_UPDATED',
        message: 'Perfil de aprendizado atualizado',
        metadata: {
          userId: input.userId,
          profileId: input.learningId,
        },
      },
      {
        eventType: 'COMMUNICATION_PROFILE_ADAPTED',
        message: 'Perfil de comunicação adaptado',
        metadata: {
          userId: input.userId,
          snapshotId: input.communicationId,
        },
      },
      {
        eventType: 'EARLY_CHURN_RECALCULATED',
        message: 'Risco precoce de churn recalculado',
        metadata: {
          userId: input.userId,
          snapshotId: input.churnId,
          score: input.churnScore,
        },
      },
      {
        eventType: 'ADAPTIVE_RECOMMENDATION_RANKED',
        message: 'Recomendações ordenadas por relevância adaptativa',
        metadata: {
          userId: input.userId,
          recommendationCount: input.rankingCount,
        },
      },
      {
        eventType: 'COACH_MEMORY_REINFORCED',
        message: 'Memória longitudinal reforçada no contexto do coach',
        metadata: {
          userId: input.userId,
          memoryCount: input.memoryCount,
        },
      },
    ];

    for (const record of records) {
      await this.events.recordInTransaction(transaction, {
        source: SOURCE,
        severity: Severity.INFO,
        ...record,
      });
    }
  }

  private followedByInteraction(
    coachDates: Date[],
    interactionDates: Date[],
  ): number {
    return coachDates.filter((coachAt) =>
      interactionDates.some(
        (interactionAt) =>
          interactionAt > coachAt &&
          interactionAt.getTime() - coachAt.getTime() <= 48 * 60 * 60 * 1000,
      ),
    ).length;
  }

  private average(values: number[]): number {
    if (values.length === 0) return 0;
    return Math.round(
      values.reduce((sum, value) => sum + value, 0) / values.length,
    );
  }

  private utcDay(value: Date): Date {
    return new Date(
      Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
    );
  }
}
