import { Injectable } from '@nestjs/common';
import {
  MealCategory,
  MealAnalysisStatus,
  NutritionInsight,
  NutritionInsightStatus,
  NutritionInsightType,
  NutritionRecommendation,
  NutritionRecommendationType,
  NutritionTrend,
  NutritionTrendDirection,
  Prisma,
  Severity,
} from '@prisma/client';
import { ContextService } from '../context/context.service';
import { EventService } from '../observability/event.service';
import { PrismaService } from '../prisma/prisma.service';
import { ListNutritionAdminDto } from './dto/list-nutrition-admin.dto';
import { NutritionUserContext } from './interfaces/nutrition-context.interface';
import {
  NutritionQualityResult,
  NutritionQualityService,
} from './nutrition-quality.service';
import { LongitudinalService } from '../longitudinal/longitudinal.service';
import { AdaptiveIntelligenceService } from '../adaptive-intelligence/adaptive-intelligence.service';

const NUTRITION_SOURCE = 'NUTRITION_INTELLIGENCE';
const TREND_WINDOWS = [7, 30, 90] as const;
const PATTERN_WINDOW_DAYS = 30;

interface InsightCandidate {
  type: NutritionInsightType;
  title: string;
  summary: string;
  evidence: Prisma.InputJsonObject;
}

interface RecommendationCandidate {
  insightId: string | null;
  type: NutritionRecommendationType;
  sourceKey: string;
  title: string;
  rationale: string;
  action: string;
  priority: number;
  active: boolean;
}

@Injectable()
export class NutritionIntelligenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly contextService: ContextService,
    private readonly qualityService: NutritionQualityService,
    private readonly eventService: EventService,
    private readonly longitudinal: LongitudinalService,
    private readonly adaptive: AdaptiveIntelligenceService,
  ) {}

  async buildUserNutritionContext(
    userId: string,
  ): Promise<NutritionUserContext> {
    const baseContext = await this.contextService.buildUserContext(userId);
    const [recentMeals, activeInsights, trendRecords] = await Promise.all([
      this.prisma.meal.findMany({
        where: {
          userId,
          analysis: {
            status: MealAnalysisStatus.COMPLETED,
          },
        },
        select: {
          id: true,
          createdAt: true,
          analysis: {
            select: {
              mealCategory: true,
              items: {
                select: {
                  foodName: true,
                },
                orderBy: {
                  id: 'asc',
                },
              },
              qualityScore: {
                select: {
                  score: true,
                },
              },
            },
          },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 10,
      }),
      this.prisma.nutritionInsight.findMany({
        where: {
          userId,
          status: NutritionInsightStatus.ACTIVE,
        },
        select: {
          id: true,
          type: true,
          title: true,
          summary: true,
          occurrences: true,
        },
        orderBy: [{ lastDetectedAt: 'desc' }, { id: 'desc' }],
        take: 10,
      }),
      this.prisma.nutritionTrend.findMany({
        where: {
          userId,
        },
        select: {
          windowDays: true,
          averageQualityScore: true,
          direction: true,
          consistencyScore: true,
          goalAdherenceScore: true,
          calculatedAt: true,
        },
        orderBy: [{ calculatedAt: 'desc' }, { id: 'desc' }],
        take: 12,
      }),
    ]);
    const trends = TREND_WINDOWS.map((windowDays) =>
      trendRecords.find((trend) => trend.windowDays === windowDays),
    ).filter((trend) => trend !== undefined);

    return {
      userId,
      goal: baseContext.nutritionProfile?.goal ?? null,
      activityLevel: baseContext.nutritionProfile?.activityLevel ?? null,
      restrictions: this.jsonArray(baseContext.nutritionProfile?.restrictions),
      allergies: this.jsonArray(baseContext.nutritionProfile?.allergies),
      preferences: baseContext.preferences
        ? {
            preferredMealTimes: baseContext.preferences.preferredMealTimes,
            preferredLanguage: baseContext.preferences.preferredLanguage,
            timezone: baseContext.preferences.timezone,
          }
        : null,
      latestSnapshot: baseContext.latestSnapshot,
      memories: baseContext.memories.map((memory) => ({
        summary: memory.summary,
        content: memory.content,
      })),
      statistics: baseContext.statistics,
      recentMeals: recentMeals.map((meal) => ({
        id: meal.id,
        createdAt: meal.createdAt,
        category: meal.analysis?.mealCategory ?? MealCategory.UNKNOWN,
        score: meal.analysis?.qualityScore?.score ?? null,
        foods: meal.analysis?.items.map((item) => item.foodName) ?? [],
      })),
      activeInsights,
      trends,
    };
  }

  async processCompletedAnalysis(
    transaction: Prisma.TransactionClient,
    userId: string,
    mealAnalysisId: string,
    context: NutritionUserContext,
    calculatedAt = new Date(),
  ) {
    const analysis = await transaction.mealAnalysis.findUniqueOrThrow({
      where: {
        id: mealAnalysisId,
      },
      include: {
        items: {
          orderBy: {
            id: 'asc',
          },
        },
      },
    });
    const quality = this.qualityService.calculate({
      calories: analysis.totalCalories?.toNumber() ?? 0,
      protein: analysis.totalProtein?.toNumber() ?? 0,
      carbs: analysis.totalCarbs?.toNumber() ?? 0,
      fat: analysis.totalFat?.toNumber() ?? 0,
      fiber: analysis.totalFiber?.toNumber() ?? 0,
      sugar: analysis.totalSugar?.toNumber() ?? 0,
      ultraProcessedRatio: analysis.ultraProcessedRatio?.toNumber() ?? 0,
      vegetableGrams: analysis.vegetableGrams?.toNumber() ?? 0,
      category: analysis.mealCategory,
      goal: context.goal,
    });
    const existingScore = await transaction.nutritionQualityScore.findUnique({
      where: {
        mealAnalysisId,
      },
      select: {
        id: true,
      },
    });
    const score = await transaction.nutritionQualityScore.upsert({
      where: {
        mealAnalysisId,
      },
      update: {
        ...quality,
        calculatedAt,
      },
      create: {
        userId,
        mealAnalysisId,
        ...quality,
        calculatedAt,
      },
    });

    await this.eventService.recordInTransaction(transaction, {
      source: NUTRITION_SOURCE,
      severity: Severity.INFO,
      eventType: 'NUTRITION_SCORE_RECALCULATED',
      message: 'Score nutricional recalculado',
      metadata: {
        userId,
        mealAnalysisId,
        scoreId: score.id,
        score: score.score,
        recalculated: Boolean(existingScore),
      },
    });

    const history = await transaction.nutritionQualityScore.findMany({
      where: {
        userId,
      },
      include: {
        mealAnalysis: {
          include: {
            items: {
              select: {
                foodName: true,
              },
            },
          },
        },
      },
      orderBy: [{ calculatedAt: 'desc' }, { id: 'desc' }],
      take: 30,
    });
    const insights = await this.persistInsights(
      transaction,
      userId,
      history,
      quality,
      calculatedAt,
    );

    await this.persistPatterns(transaction, userId, history, calculatedAt);
    const trends = await this.persistTrends(transaction, userId, calculatedAt);
    const recommendations = await this.persistRecommendations(
      transaction,
      userId,
      mealAnalysisId,
      context,
      insights,
      trends,
      calculatedAt,
    );
    const longitudinal = await this.longitudinal.refreshInTransaction(
      transaction,
      userId,
      mealAnalysisId,
      calculatedAt,
    );
    const adaptive = await this.adaptive.refreshInTransaction(
      transaction,
      userId,
      calculatedAt,
    );

    return {
      score,
      insights,
      trends,
      recommendations,
      longitudinal,
      adaptive,
    };
  }

  async listInsights(query: ListNutritionAdminDto) {
    return this.paginate(
      query,
      this.prisma.nutritionInsight.findMany({
        where: {
          userId: query.userId,
          status:
            query.active === undefined
              ? undefined
              : query.active
                ? NutritionInsightStatus.ACTIVE
                : NutritionInsightStatus.RESOLVED,
        },
        orderBy: [{ lastDetectedAt: 'desc' }, { id: 'desc' }],
        cursor: query.cursor ? { id: query.cursor } : undefined,
        skip: query.cursor ? 1 : undefined,
        take: query.limit + 1,
      }),
    );
  }

  async listTrends(query: ListNutritionAdminDto) {
    return this.paginate(
      query,
      this.prisma.nutritionTrend.findMany({
        where: {
          userId: query.userId,
        },
        orderBy: [{ calculatedAt: 'desc' }, { id: 'desc' }],
        cursor: query.cursor ? { id: query.cursor } : undefined,
        skip: query.cursor ? 1 : undefined,
        take: query.limit + 1,
      }),
    );
  }

  async listQuality(query: ListNutritionAdminDto) {
    return this.paginate(
      query,
      this.prisma.nutritionQualityScore.findMany({
        where: {
          userId: query.userId,
        },
        include: {
          mealAnalysis: {
            select: {
              mealCategory: true,
              totalCalories: true,
              meal: {
                select: {
                  id: true,
                  createdAt: true,
                },
              },
            },
          },
        },
        orderBy: [{ calculatedAt: 'desc' }, { id: 'desc' }],
        cursor: query.cursor ? { id: query.cursor } : undefined,
        skip: query.cursor ? 1 : undefined,
        take: query.limit + 1,
      }),
    );
  }

  private async persistInsights(
    transaction: Prisma.TransactionClient,
    userId: string,
    history: Array<{
      proteinScore: number;
      fiberScore: number;
      ultraProcessedScore: number;
      sugarScore: number;
      balanceScore: number;
      mealAnalysis: {
        hydrationMl: Prisma.Decimal | null;
        vegetableGrams: Prisma.Decimal | null;
      };
    }>,
    quality: NutritionQualityResult,
    detectedAt: Date,
  ) {
    const candidates = this.detectInsights(history, quality);
    const persisted: NutritionInsight[] = [];

    for (const candidate of candidates) {
      const existing = await transaction.nutritionInsight.findUnique({
        where: {
          userId_type: {
            userId,
            type: candidate.type,
          },
        },
      });
      const insight = await transaction.nutritionInsight.upsert({
        where: {
          userId_type: {
            userId,
            type: candidate.type,
          },
        },
        update: {
          status: NutritionInsightStatus.ACTIVE,
          title: candidate.title,
          summary: candidate.summary,
          evidence: candidate.evidence,
          occurrences: {
            increment: 1,
          },
          lastDetectedAt: detectedAt,
          resolvedAt: null,
        },
        create: {
          userId,
          ...candidate,
          firstDetectedAt: detectedAt,
          lastDetectedAt: detectedAt,
        },
      });

      await this.eventService.recordInTransaction(transaction, {
        source: NUTRITION_SOURCE,
        severity: Severity.INFO,
        eventType: existing
          ? 'NUTRITION_INSIGHT_UPDATED'
          : 'NUTRITION_INSIGHT_CREATED',
        message: existing
          ? 'Insight nutricional atualizado'
          : 'Insight nutricional criado',
        metadata: {
          userId,
          insightId: insight.id,
          insightType: insight.type,
          occurrences: insight.occurrences,
        },
      });
      persisted.push(insight);
    }

    if (history.length >= 3) {
      const detectedTypes = new Set(
        candidates.map((candidate) => candidate.type),
      );
      const resolved = await transaction.nutritionInsight.findMany({
        where: {
          userId,
          status: NutritionInsightStatus.ACTIVE,
          type: {
            notIn: [...detectedTypes],
          },
        },
      });

      for (const insight of resolved) {
        await transaction.nutritionInsight.update({
          where: {
            id: insight.id,
          },
          data: {
            status: NutritionInsightStatus.RESOLVED,
            resolvedAt: detectedAt,
          },
        });
        await this.eventService.recordInTransaction(transaction, {
          source: NUTRITION_SOURCE,
          severity: Severity.INFO,
          eventType: 'NUTRITION_INSIGHT_UPDATED',
          message: 'Insight nutricional resolvido',
          metadata: {
            userId,
            insightId: insight.id,
            insightType: insight.type,
            status: NutritionInsightStatus.RESOLVED,
          },
        });
      }
    }

    return persisted;
  }

  private detectInsights(
    history: Array<{
      proteinScore: number;
      fiberScore: number;
      ultraProcessedScore: number;
      sugarScore: number;
      balanceScore: number;
      mealAnalysis: {
        hydrationMl: Prisma.Decimal | null;
        vegetableGrams: Prisma.Decimal | null;
      };
    }>,
    current: NutritionQualityResult,
  ): InsightCandidate[] {
    const sample = history.slice(0, 6);
    const recurring = sample.length >= 3;
    const candidates: InsightCandidate[] = [];
    const averageProtein = this.average(
      sample.map((item) => item.proteinScore),
    );
    const averageSugar = this.average(sample.map((item) => item.sugarScore));
    const averageUltra = this.average(
      sample.map((item) => item.ultraProcessedScore),
    );
    const averageFiber = this.average(sample.map((item) => item.fiberScore));
    const averageBalance = this.average(
      sample.map((item) => item.balanceScore),
    );
    const averageVegetables = this.average(
      sample.map((item) => item.mealAnalysis.vegetableGrams?.toNumber() ?? 0),
    );
    const averageHydration = this.average(
      sample.map((item) => item.mealAnalysis.hydrationMl?.toNumber() ?? 0),
    );

    if (averageProtein < 55 && (recurring || current.proteinScore < 35)) {
      candidates.push({
        type: NutritionInsightType.LOW_PROTEIN,
        title: 'Proteína abaixo do ideal com frequência',
        summary:
          'As refeições recentes mostram espaço para distribuir melhor as fontes de proteína.',
        evidence: {
          sampleSize: sample.length,
          averageProteinScore: averageProtein,
        },
      });
    }

    if (averageSugar < 55 && (recurring || current.sugarScore < 35)) {
      candidates.push({
        type: NutritionInsightType.EXCESS_SUGAR,
        title: 'Açúcar elevado nas refeições recentes',
        summary:
          'O padrão recente sugere reduzir fontes concentradas de açúcar e bebidas adoçadas.',
        evidence: {
          sampleSize: sample.length,
          averageSugarScore: averageSugar,
        },
      });
    }

    if (averageUltra < 55 && (recurring || current.ultraProcessedScore < 35)) {
      candidates.push({
        type: NutritionInsightType.HIGH_ULTRA_PROCESSED,
        title: 'Presença frequente de ultraprocessados',
        summary:
          'Há recorrência de itens ultraprocessados nas refeições analisadas.',
        evidence: {
          sampleSize: sample.length,
          averageUltraProcessedScore: averageUltra,
        },
      });
    }

    if (
      averageFiber < 55 &&
      averageVegetables < 80 &&
      (recurring || current.fiberScore < 35)
    ) {
      candidates.push({
        type: NutritionInsightType.LOW_VEGETABLES,
        title: 'Pouca fibra e vegetais no padrão recente',
        summary:
          'As refeições analisadas têm baixa presença estimada de vegetais e fibras.',
        evidence: {
          sampleSize: sample.length,
          averageFiberScore: averageFiber,
          averageVegetableGrams: averageVegetables,
        },
      });
    }

    if (recurring && averageHydration < 150) {
      candidates.push({
        type: NutritionInsightType.INSUFFICIENT_HYDRATION,
        title: 'Pouca água identificada junto às refeições',
        summary:
          'Nas imagens recentes, a presença estimada de água ou bebida sem açúcar foi baixa.',
        evidence: {
          sampleSize: sample.length,
          averageHydrationMl: averageHydration,
        },
      });
    }

    if (averageBalance < 55 && (recurring || current.balanceScore < 35)) {
      candidates.push({
        type: NutritionInsightType.UNBALANCED_MEALS,
        title: 'Refeições pouco equilibradas',
        summary:
          'A combinação de macronutrientes, fibras e vegetais pode ficar mais equilibrada.',
        evidence: {
          sampleSize: sample.length,
          averageBalanceScore: averageBalance,
        },
      });
    }

    return candidates;
  }

  private async persistPatterns(
    transaction: Prisma.TransactionClient,
    userId: string,
    history: Array<{
      score: number;
      calculatedAt: Date;
      mealAnalysis: {
        mealCategory: MealCategory;
        items: Array<{ foodName: string }>;
      };
    }>,
    calculatedAt: Date,
  ): Promise<void> {
    const periodStart = new Date(
      calculatedAt.getTime() - PATTERN_WINDOW_DAYS * 86_400_000,
    );
    const categories = [
      MealCategory.BREAKFAST,
      MealCategory.LUNCH,
      MealCategory.DINNER,
      MealCategory.SNACK,
    ];

    for (const category of categories) {
      const meals = history.filter(
        (item) =>
          item.calculatedAt >= periodStart &&
          item.mealAnalysis.mealCategory === category,
      );
      const foodCounts = new Map<string, number>();

      for (const meal of meals) {
        for (const item of meal.mealAnalysis.items) {
          const foodName = item.foodName.trim().toLocaleLowerCase('pt-BR');
          foodCounts.set(foodName, (foodCounts.get(foodName) ?? 0) + 1);
        }
      }

      const recurringFoods = [...foodCounts.entries()]
        .sort(
          (left, right) =>
            right[1] - left[1] || left[0].localeCompare(right[0]),
        )
        .slice(0, 5)
        .map(([foodName, occurrences]) => ({ foodName, occurrences }));
      const data = {
        mealCount: meals.length,
        frequencyPerWeek: new Prisma.Decimal(
          ((meals.length / PATTERN_WINDOW_DAYS) * 7).toFixed(2),
        ),
        averageQualityScore:
          meals.length > 0 ? this.average(meals.map((meal) => meal.score)) : 0,
        recurringFoods,
        periodStart,
        periodEnd: calculatedAt,
        calculatedAt,
      };

      await transaction.mealPattern.upsert({
        where: {
          userId_category_windowDays: {
            userId,
            category,
            windowDays: PATTERN_WINDOW_DAYS,
          },
        },
        update: data,
        create: {
          userId,
          category,
          windowDays: PATTERN_WINDOW_DAYS,
          ...data,
        },
      });
    }
  }

  private async persistTrends(
    transaction: Prisma.TransactionClient,
    userId: string,
    calculatedAt: Date,
  ) {
    const windowEnd = this.utcDay(calculatedAt);
    const trends: NutritionTrend[] = [];

    for (const windowDays of TREND_WINDOWS) {
      const windowStart = new Date(
        calculatedAt.getTime() - windowDays * 86_400_000,
      );
      const previousStart = new Date(
        windowStart.getTime() - windowDays * 86_400_000,
      );
      const [current, previous] = await Promise.all([
        transaction.nutritionQualityScore.findMany({
          where: {
            userId,
            calculatedAt: {
              gte: windowStart,
              lte: calculatedAt,
            },
          },
          orderBy: {
            calculatedAt: 'asc',
          },
        }),
        transaction.nutritionQualityScore.findMany({
          where: {
            userId,
            calculatedAt: {
              gte: previousStart,
              lt: windowStart,
            },
          },
        }),
      ]);
      const averageQualityScore = this.average(
        current.map((item) => item.score),
      );
      const previousAverageScore =
        previous.length > 0
          ? this.average(previous.map((item) => item.score))
          : null;
      const scoreChange =
        previousAverageScore === null
          ? null
          : averageQualityScore - previousAverageScore;
      const direction =
        scoreChange === null || Math.abs(scoreChange) < 3
          ? NutritionTrendDirection.STABLE
          : scoreChange > 0
            ? NutritionTrendDirection.IMPROVING
            : NutritionTrendDirection.DECLINING;
      const consistencyScore = this.consistency(
        current.map((item) => item.score),
      );
      const goalAdherenceScore = this.average(
        current.map((item) => item.goalAdherenceScore),
      );
      const trend = await transaction.nutritionTrend.upsert({
        where: {
          userId_windowDays_windowEnd: {
            userId,
            windowDays,
            windowEnd,
          },
        },
        update: {
          windowStart,
          mealsAnalyzed: current.length,
          averageQualityScore,
          previousAverageScore,
          scoreChange,
          direction,
          consistencyScore,
          goalAdherenceScore,
          calculatedAt,
        },
        create: {
          userId,
          windowDays,
          windowStart,
          windowEnd,
          mealsAnalyzed: current.length,
          averageQualityScore,
          previousAverageScore,
          scoreChange,
          direction,
          consistencyScore,
          goalAdherenceScore,
          calculatedAt,
        },
      });

      await this.eventService.recordInTransaction(transaction, {
        source: NUTRITION_SOURCE,
        severity: Severity.INFO,
        eventType: 'NUTRITION_TREND_RECALCULATED',
        message: 'Tendência nutricional recalculada',
        metadata: {
          userId,
          trendId: trend.id,
          windowDays,
          direction,
          averageQualityScore,
        },
      });
      trends.push(trend);
    }

    return trends;
  }

  private async persistRecommendations(
    transaction: Prisma.TransactionClient,
    userId: string,
    mealAnalysisId: string,
    context: NutritionUserContext,
    insights: Array<{
      id: string;
      type: NutritionInsightType;
      title: string;
    }>,
    trends: Array<{
      windowDays: number;
      consistencyScore: number;
      direction: NutritionTrendDirection;
    }>,
    generatedAt: Date,
  ) {
    await transaction.nutritionRecommendation.updateMany({
      where: {
        userId,
        active: true,
      },
      data: {
        active: false,
      },
    });
    const recommendations = this.createRecommendations(
      mealAnalysisId,
      context,
      insights,
      trends,
    );
    const persisted: NutritionRecommendation[] = [];

    for (const recommendation of recommendations) {
      const record = await transaction.nutritionRecommendation.upsert({
        where: {
          userId_type_sourceKey: {
            userId,
            type: recommendation.type,
            sourceKey: recommendation.sourceKey,
          },
        },
        update: {
          insightId: recommendation.insightId,
          title: recommendation.title,
          rationale: recommendation.rationale,
          action: recommendation.action,
          priority: recommendation.priority,
          active: true,
          generatedAt,
          expiresAt: new Date(generatedAt.getTime() + 7 * 86_400_000),
        },
        create: {
          userId,
          ...recommendation,
          generatedAt,
          expiresAt: new Date(generatedAt.getTime() + 7 * 86_400_000),
        },
      });

      await this.eventService.recordInTransaction(transaction, {
        source: NUTRITION_SOURCE,
        severity: Severity.INFO,
        eventType: 'NUTRITION_RECOMMENDATION_GENERATED',
        message: 'Recomendação nutricional gerada',
        metadata: {
          userId,
          recommendationId: record.id,
          recommendationType: record.type,
          mealAnalysisId,
        },
      });
      persisted.push(record);
    }

    return persisted;
  }

  private createRecommendations(
    mealAnalysisId: string,
    context: NutritionUserContext,
    insights: Array<{
      id: string;
      type: NutritionInsightType;
      title: string;
    }>,
    trends: Array<{
      windowDays: number;
      consistencyScore: number;
      direction: NutritionTrendDirection;
    }>,
  ) {
    const goalLabel =
      context.goal === 'MUSCLE_GAIN'
        ? 'ganho de massa'
        : context.goal === 'WEIGHT_LOSS'
          ? 'redução de peso'
          : 'manutenção';
    const restrictionNote =
      context.restrictions.length > 0 || context.allergies.length > 0
        ? ' usando opções compatíveis com suas restrições cadastradas'
        : '';
    const memoryNote =
      context.memories.length > 0
        ? ' Seu histórico recente também foi considerado.'
        : '';
    const recommendations: RecommendationCandidate[] = insights
      .slice(0, 3)
      .map((insight, index) => {
        const details = this.recommendationForInsight(
          insight.type,
          restrictionNote,
        );

        return {
          insightId: insight.id,
          type: details.type,
          sourceKey: `${mealAnalysisId}:${insight.type}`,
          title: details.title,
          rationale: `${insight.title} pode afetar seu objetivo de ${goalLabel}.${memoryNote}`,
          action: details.action,
          priority: index + 1,
          active: true,
        };
      });
    const sevenDayTrend = trends.find((trend) => trend.windowDays === 7);

    if (
      recommendations.length < 3 &&
      sevenDayTrend &&
      sevenDayTrend.consistencyScore < 65
    ) {
      recommendations.push({
        insightId: null,
        type: NutritionRecommendationType.CONSISTENCY,
        sourceKey: `${mealAnalysisId}:CONSISTENCY`,
        title: 'Crie uma melhoria pequena e repetível',
        rationale:
          'A regularidade das refeições analisadas ainda oscila e consistência tende a gerar mais resultado do que mudanças grandes.',
        action:
          'Escolha uma refeição do dia para repetir uma estrutura simples: proteína, vegetal, fonte de carboidrato e água.',
        priority: recommendations.length + 1,
        active: true,
      });
    }

    if (recommendations.length === 0) {
      recommendations.push({
        insightId: null,
        type: NutritionRecommendationType.HABITS,
        sourceKey: `${mealAnalysisId}:HABITS`,
        title: 'Mantenha a estrutura que funcionou',
        rationale: `Esta refeição está coerente com seu objetivo de ${goalLabel}, considerando seu histórico recente.`,
        action:
          'Repita a combinação em refeições semelhantes e observe fome, saciedade e praticidade ao longo da semana.',
        priority: 1,
        active: true,
      });
    }

    return recommendations;
  }

  private recommendationForInsight(
    type: NutritionInsightType,
    restrictionNote: string,
  ): {
    type: NutritionRecommendationType;
    title: string;
    action: string;
  } {
    switch (type) {
      case NutritionInsightType.LOW_PROTEIN:
        return {
          type: NutritionRecommendationType.PROTEIN_ADJUSTMENT,
          title: 'Distribua melhor a proteína',
          action: `Inclua uma porção prática de proteína nesta categoria de refeição${restrictionNote}, como ovos, frango, peixe, tofu ou leguminosas.`,
        };
      case NutritionInsightType.EXCESS_SUGAR:
        return {
          type: NutritionRecommendationType.FOOD_IMPROVEMENT,
          title: 'Reduza o açúcar sem perder praticidade',
          action:
            'Troque uma bebida adoçada ou sobremesa frequente por água, fruta inteira ou opção sem açúcar na próxima refeição semelhante.',
        };
      case NutritionInsightType.INSUFFICIENT_HYDRATION:
        return {
          type: NutritionRecommendationType.HYDRATION,
          title: 'Associe água às refeições',
          action:
            'Deixe um copo ou garrafa de água visível e beba ao longo do período da refeição, sem metas extremas.',
        };
      case NutritionInsightType.HIGH_ULTRA_PROCESSED:
        return {
          type: NutritionRecommendationType.FOOD_IMPROVEMENT,
          title: 'Faça uma troca por alimento menos processado',
          action:
            'Substitua um item ultraprocessado por uma opção simples com poucos ingredientes na próxima refeição equivalente.',
        };
      case NutritionInsightType.LOW_VEGETABLES:
        return {
          type: NutritionRecommendationType.FIBER_ADJUSTMENT,
          title: 'Aumente fibras e vegetais gradualmente',
          action: `Acrescente uma porção de verdura, legume, feijão ou fruta${restrictionNote} à próxima refeição semelhante.`,
        };
      case NutritionInsightType.UNBALANCED_MEALS:
        return {
          type: NutritionRecommendationType.FOOD_IMPROVEMENT,
          title: 'Monte uma refeição mais completa',
          action:
            'Combine uma fonte de proteína, uma de fibras ou vegetais e uma fonte de energia em porções compatíveis com sua fome.',
        };
    }
  }

  private async paginate<T extends { id: string }>(
    query: ListNutritionAdminDto,
    promise: Promise<T[]>,
  ) {
    const records = await promise;
    const hasMore = records.length > query.limit;
    const items = hasMore ? records.slice(0, query.limit) : records;

    return {
      items,
      nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
    };
  }

  private consistency(values: number[]): number {
    if (values.length <= 1) {
      return values.length === 1 ? 70 : 0;
    }

    const mean = this.average(values);
    const variance =
      values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
      values.length;

    return this.clamp(Math.round(100 - Math.sqrt(variance) * 2));
  }

  private average(values: number[]): number {
    if (values.length === 0) {
      return 0;
    }

    return Math.round(
      values.reduce((sum, value) => sum + value, 0) / values.length,
    );
  }

  private clamp(value: number): number {
    return Math.max(0, Math.min(100, value));
  }

  private utcDay(value: Date): Date {
    return new Date(
      Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
    );
  }

  private jsonArray(value: Prisma.JsonValue | undefined): unknown[] {
    return Array.isArray(value) ? value : [];
  }
}
