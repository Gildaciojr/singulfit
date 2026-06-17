import { Injectable, NotFoundException } from '@nestjs/common';
import {
  BehavioralCommunicationStyle,
  FoodPreferenceKind,
  GoalProgressionState,
  LongitudinalDirection,
  LongitudinalMemoryKind,
  MessageDirection,
  Prisma,
  RecommendationStatus,
  Severity,
  UserGoalType,
} from '@prisma/client';
import { EventService } from '../observability/event.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  LongitudinalMealSignal,
  LongitudinalResponseContext,
} from './interfaces/longitudinal.interface';
import { LongitudinalCalculatorService } from './longitudinal-calculator.service';

const LONGITUDINAL_SOURCE = 'LONGITUDINAL_NUTRITION';
const DAY_MS = 86_400_000;
const EVOLUTION_WINDOW_DAYS = 14;

@Injectable()
export class LongitudinalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly calculator: LongitudinalCalculatorService,
    private readonly events: EventService,
  ) {}

  async refreshInTransaction(
    transaction: Prisma.TransactionClient,
    userId: string,
    mealAnalysisId: string,
    generatedAt = new Date(),
  ): Promise<LongitudinalResponseContext> {
    const sourceKey = `analysis:${mealAnalysisId}`;
    await this.lock(transaction, userId);
    const existing = await transaction.longitudinalNutritionProfile.findUnique({
      where: { sourceKey },
    });

    if (existing) {
      return this.getResponseContextInTransaction(transaction, userId);
    }

    const windowStart = new Date(
      generatedAt.getTime() - EVOLUTION_WINDOW_DAYS * DAY_MS,
    );
    const previousWindowStart = new Date(
      windowStart.getTime() - EVOLUTION_WINDOW_DAYS * DAY_MS,
    );
    const [user, history, messages, consistency, adherence, recommendations] =
      await Promise.all([
        transaction.user.findUnique({
          where: { id: userId },
          select: {
            goalClassification: {
              select: { goal: true },
            },
            nutritionProfile: {
              select: {
                goal: true,
                restrictions: true,
                allergies: true,
              },
            },
            behavioralProfile: {
              select: {
                communicationStyle: true,
                confidenceScore: true,
              },
            },
          },
        }),
        transaction.nutritionQualityScore.findMany({
          where: {
            userId,
            calculatedAt: { lte: generatedAt },
          },
          select: {
            calculatedAt: true,
            score: true,
            goalAdherenceScore: true,
            proteinScore: true,
            sugarScore: true,
            ultraProcessedScore: true,
            mealAnalysis: {
              select: {
                hydrationMl: true,
                vegetableGrams: true,
                totalProtein: true,
                totalSugar: true,
                ultraProcessedRatio: true,
                items: {
                  select: {
                    foodName: true,
                    isUltraProcessed: true,
                    isVegetable: true,
                  },
                },
              },
            },
          },
          orderBy: [{ calculatedAt: 'desc' }, { id: 'desc' }],
          take: 180,
        }),
        transaction.message.findMany({
          where: {
            direction: MessageDirection.INBOUND,
            conversation: { userId },
          },
          select: {
            content: true,
            timestamp: true,
          },
          orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
          take: 100,
        }),
        transaction.consistencyScore.findFirst({
          where: { userId },
          select: { score: true },
          orderBy: [{ calculatedAt: 'desc' }, { id: 'desc' }],
        }),
        transaction.adherencePrediction.findFirst({
          where: { userId },
          select: { score: true },
          orderBy: [{ calculatedAt: 'desc' }, { id: 'desc' }],
        }),
        transaction.recommendation.findMany({
          where: { userId },
          select: {
            category: true,
            signalKey: true,
            status: true,
          },
          orderBy: [{ generatedAt: 'desc' }, { id: 'desc' }],
          take: 300,
        }),
      ]);

    if (!user) {
      throw new NotFoundException('Usuário não encontrado');
    }

    const currentMeals = history.filter(
      (meal) => meal.calculatedAt >= windowStart,
    );
    const previousMeals = history.filter(
      (meal) =>
        meal.calculatedAt >= previousWindowStart &&
        meal.calculatedAt < windowStart,
    );
    const consistencyScore =
      consistency?.score ?? this.mealConsistencyScore(currentMeals);
    const adherenceScore =
      adherence?.score ??
      this.average(history.slice(0, 30).map((meal) => meal.goalAdherenceScore));
    const evolution = this.calculator.evolution(
      currentMeals as LongitudinalMealSignal[],
      previousMeals as LongitudinalMealSignal[],
    );
    const relapse = this.calculator.relapse(evolution, consistencyScore);
    const goal = this.resolveGoal(
      user.goalClassification?.goal,
      user.nutritionProfile?.goal,
    );
    const behaviorScore = user.behavioralProfile
      ? Math.round(user.behavioralProfile.confidenceScore.toNumber() * 100)
      : 50;
    const goalProgression = this.calculator.goalProgression({
      goal,
      evolution,
      consistencyScore,
      adherenceScore,
      behaviorScore,
    });
    const preferences = this.foodPreferences(
      history as LongitudinalMealSignal[],
      messages,
      user.nutritionProfile?.restrictions,
      user.nutritionProfile?.allergies,
    );
    const feedback = this.recommendationFeedback(recommendations);
    const adaptation = this.calculator.coachAdaptation({
      historySize: history.length,
      consistencyScore,
      adherenceScore,
      relapseSeverity: relapse?.severity ?? null,
      analytical:
        user.behavioralProfile?.communicationStyle ===
        BehavioralCommunicationStyle.ANALYTICAL,
    });
    const memories = this.longitudinalMemories({
      sourceKey,
      evolution,
      relapse,
      goalProgression,
      adherenceScore,
      preferences,
      generatedAt,
    });
    const periodStart = windowStart;

    await transaction.foodPreferenceSnapshot.createMany({
      data: preferences.map((preference) => ({
        userId,
        sourceKey: `${sourceKey}:food:${preference.normalizedFood}:${preference.kind}`,
        foodName: preference.foodName,
        normalizedFood: preference.normalizedFood,
        kind: preference.kind,
        confidence: new Prisma.Decimal(preference.confidence.toFixed(4)),
        occurrences: preference.occurrences,
        evidence: preference.evidence,
        observedAt: generatedAt,
      })),
      skipDuplicates: true,
    });
    const evolutionRecord = await transaction.nutritionEvolutionSnapshot.create(
      {
        data: {
          userId,
          sourceKey,
          periodStart,
          periodEnd: generatedAt,
          mealsAnalyzed: currentMeals.length,
          qualityScore: evolution.current.quality,
          hydrationScore: evolution.current.hydration,
          vegetableScore: evolution.current.vegetables,
          ultraProcessedScore: evolution.current.ultraProcessed,
          sugarScore: evolution.current.sugar,
          proteinScore: evolution.current.protein,
          qualityDirection: evolution.directions.quality,
          hydrationDirection: evolution.directions.hydration,
          vegetableDirection: evolution.directions.vegetables,
          ultraProcessedDirection: evolution.directions.ultraProcessed,
          sugarDirection: evolution.directions.sugar,
          proteinDirection: evolution.directions.protein,
          overallDirection: evolution.overallDirection,
          evidence: {
            previous: this.jsonDimensions(evolution.previous),
            currentWindowMeals: currentMeals.length,
            previousWindowMeals: previousMeals.length,
          },
          generatedAt,
        },
      },
    );
    const relapseRecord = relapse
      ? await transaction.nutritionRelapse.create({
          data: {
            userId,
            sourceKey,
            severity: relapse.severity,
            reasons: relapse.reasons,
            evidence: {
              directions: evolution.directions,
              consistencyScore,
            },
            detectedAt: generatedAt,
          },
        })
      : null;
    const progressionRecord = await transaction.goalProgressionSnapshot.create({
      data: {
        userId,
        sourceKey,
        goal,
        state: goalProgression.state,
        score: goalProgression.score,
        behaviorScore,
        consistencyScore,
        nutritionScore: goalProgression.nutritionScore,
        adherenceScore,
        evidence: {
          evolution: evolution.overallDirection,
          dimensions: this.jsonDimensions(evolution.current),
        },
        generatedAt,
      },
    });
    const adaptationRecord = await transaction.coachAdaptationSnapshot.create({
      data: {
        userId,
        sourceKey,
        ...adaptation,
        evidence: {
          historySize: history.length,
          consistencyScore,
          adherenceScore,
          relapseSeverity: relapse?.severity ?? null,
        },
        generatedAt,
      },
    });
    await transaction.longitudinalMemory.createMany({
      data: memories.map((memory) => ({
        userId,
        ...memory,
      })),
      skipDuplicates: true,
    });
    await transaction.recommendationFeedbackSnapshot.create({
      data: {
        userId,
        sourceKey,
        ...feedback,
        generatedAt,
      },
    });
    const monthlyReview = await this.createMonthlyReview(
      transaction,
      userId,
      history as LongitudinalMealSignal[],
      preferences,
      generatedAt,
    );
    const profile = await transaction.longitudinalNutritionProfile.create({
      data: {
        userId,
        sourceKey,
        mealAnalysisId,
        historySize: history.length,
        adherenceScore,
        consistencyScore,
        preferenceSummary: preferences.slice(0, 10).map((item) => ({
          food: item.foodName,
          kind: item.kind,
          confidence: item.confidence,
        })),
        evolutionSummary: {
          direction: evolution.overallDirection,
          scores: this.jsonDimensions(evolution.current),
        },
        regressionSummary: relapse
          ? {
              severity: relapse.severity,
              reasons: relapse.reasons,
            }
          : {},
        generatedAt,
      },
    });

    await this.recordEvents(transaction, {
      userId,
      profileId: profile.id,
      preferenceCount: preferences.length,
      evolutionId: evolutionRecord.id,
      direction: evolution.overallDirection,
      relapseId: relapseRecord?.id ?? null,
      relapseSeverity: relapse?.severity ?? null,
      progressionId: progressionRecord.id,
      progressionState: progressionRecord.state,
      adaptationId: adaptationRecord.id,
      adaptationMode: adaptationRecord.mode,
      monthlyReviewId: monthlyReview?.id ?? null,
      generatedAt,
    });

    return this.getResponseContextInTransaction(transaction, userId);
  }

  getResponseContext(userId: string): Promise<LongitudinalResponseContext> {
    return this.getResponseContextInTransaction(this.prisma, userId);
  }

  async refreshRecommendationFeedbackInTransaction(
    transaction: Prisma.TransactionClient,
    userId: string,
    source: string,
    generatedAt: Date,
  ) {
    const sourceKey = `feedback:${source}`;
    const existing =
      await transaction.recommendationFeedbackSnapshot.findUnique({
        where: { sourceKey },
      });

    if (existing) {
      return existing;
    }

    const recommendations = await transaction.recommendation.findMany({
      where: { userId },
      select: {
        category: true,
        signalKey: true,
        status: true,
      },
      orderBy: [{ generatedAt: 'desc' }, { id: 'desc' }],
      take: 300,
    });

    return transaction.recommendationFeedbackSnapshot.create({
      data: {
        userId,
        sourceKey,
        ...this.recommendationFeedback(recommendations),
        generatedAt,
      },
    });
  }

  async recommendationModifiers(
    transaction: Prisma.TransactionClient,
    userId: string,
  ): Promise<{
    categories: Record<string, number>;
    signals: Record<string, number>;
  }> {
    const feedback = await transaction.recommendationFeedbackSnapshot.findFirst(
      {
        where: { userId },
        select: {
          categoryScores: true,
          signalScores: true,
        },
        orderBy: [{ generatedAt: 'desc' }, { id: 'desc' }],
      },
    );

    return {
      categories: this.numericRecord(feedback?.categoryScores),
      signals: this.numericRecord(feedback?.signalScores),
    };
  }

  private async getResponseContextInTransaction(
    transaction: Prisma.TransactionClient | PrismaService,
    userId: string,
  ): Promise<LongitudinalResponseContext> {
    const [
      profile,
      preferences,
      evolution,
      relapse,
      goalProgression,
      coachAdaptation,
      memories,
      monthlyReview,
    ] = await Promise.all([
      transaction.longitudinalNutritionProfile.findFirst({
        where: { userId },
        orderBy: [{ generatedAt: 'desc' }, { id: 'desc' }],
      }),
      transaction.foodPreferenceSnapshot.findMany({
        where: { userId },
        orderBy: [
          { observedAt: 'desc' },
          { confidence: 'desc' },
          { id: 'desc' },
        ],
        take: 40,
      }),
      transaction.nutritionEvolutionSnapshot.findFirst({
        where: { userId },
        orderBy: [{ generatedAt: 'desc' }, { id: 'desc' }],
      }),
      transaction.nutritionRelapse.findFirst({
        where: { userId },
        orderBy: [{ detectedAt: 'desc' }, { id: 'desc' }],
      }),
      transaction.goalProgressionSnapshot.findFirst({
        where: { userId },
        orderBy: [{ generatedAt: 'desc' }, { id: 'desc' }],
      }),
      transaction.coachAdaptationSnapshot.findFirst({
        where: { userId },
        orderBy: [{ generatedAt: 'desc' }, { id: 'desc' }],
      }),
      transaction.longitudinalMemory.findMany({
        where: { userId },
        orderBy: [
          { generatedAt: 'desc' },
          { confidence: 'desc' },
          { id: 'desc' },
        ],
        take: 10,
      }),
      transaction.monthlyEvolutionReview.findFirst({
        where: { userId },
        orderBy: [{ monthStart: 'desc' }, { id: 'desc' }],
      }),
    ]);
    const latestPreferences = new Map<string, (typeof preferences)[number]>();

    for (const preference of preferences) {
      if (!latestPreferences.has(preference.normalizedFood)) {
        latestPreferences.set(preference.normalizedFood, preference);
      }
    }

    return {
      profile: profile
        ? {
            historySize: profile.historySize,
            adherenceScore: profile.adherenceScore,
            consistencyScore: profile.consistencyScore,
          }
        : null,
      preferences: [...latestPreferences.values()].slice(0, 10).map((item) => ({
        foodName: item.foodName,
        kind: item.kind,
        confidence: item.confidence.toNumber(),
      })),
      evolution: evolution
        ? {
            overallDirection: evolution.overallDirection,
            scores: {
              quality: evolution.qualityScore,
              hydration: evolution.hydrationScore,
              vegetables: evolution.vegetableScore,
              ultraProcessed: evolution.ultraProcessedScore,
              sugar: evolution.sugarScore,
              protein: evolution.proteinScore,
            },
          }
        : null,
      relapse:
        relapse && relapse.sourceKey === profile?.sourceKey
          ? {
              severity: relapse.severity,
              reasons: this.stringArray(relapse.reasons),
            }
          : null,
      goalProgression: goalProgression
        ? {
            goal: goalProgression.goal,
            state: goalProgression.state,
            score: goalProgression.score,
          }
        : null,
      coachAdaptation: coachAdaptation
        ? {
            mode: coachAdaptation.mode,
            reason: coachAdaptation.reason,
          }
        : null,
      memories: memories.map((memory) => ({
        kind: memory.kind,
        title: memory.title,
        summary: memory.summary,
      })),
      monthlyReview: monthlyReview
        ? {
            monthStart: monthlyReview.monthStart,
            direction: monthlyReview.direction,
            content: monthlyReview.content,
          }
        : null,
    };
  }

  foodPreferences(
    history: LongitudinalMealSignal[],
    messages: Array<{ content: string; timestamp: Date }>,
    restrictions: unknown,
    allergies: unknown,
  ) {
    const counts = new Map<string, { foodName: string; count: number }>();

    for (const meal of history) {
      for (const item of meal.mealAnalysis.items) {
        const normalizedFood = this.normalize(item.foodName);
        const current = counts.get(normalizedFood);
        counts.set(normalizedFood, {
          foodName: current?.foodName ?? item.foodName.trim(),
          count: (current?.count ?? 0) + 1,
        });
      }
    }

    const totalMeals = Math.max(1, history.length);
    const preferences: Array<{
      foodName: string;
      normalizedFood: string;
      kind: FoodPreferenceKind;
      confidence: number;
      occurrences: number;
      evidence: Prisma.InputJsonObject;
    }> = [...counts.entries()].map(([normalizedFood, item]) => ({
      foodName: item.foodName,
      normalizedFood,
      kind:
        item.count >= 3
          ? FoodPreferenceKind.FREQUENT
          : FoodPreferenceKind.ACCEPTED,
      confidence: Math.min(0.99, 0.55 + item.count / totalMeals),
      occurrences: item.count,
      evidence: {
        source: 'MEAL_HISTORY',
        historyMeals: history.length,
      } as Prisma.InputJsonObject,
    }));
    const explicit = [
      ...this.preferenceTerms(restrictions),
      ...this.preferenceTerms(allergies),
    ];

    for (const term of explicit) {
      preferences.push({
        foodName: term,
        normalizedFood: this.normalize(term),
        kind: FoodPreferenceKind.AVOIDED,
        confidence: 0.98,
        occurrences: 1,
        evidence: {
          source: 'REGISTERED_RESTRICTION',
        } as Prisma.InputJsonObject,
      });
    }

    for (const message of messages) {
      for (const rejected of this.rejectedFoods(message.content)) {
        preferences.push({
          foodName: rejected,
          normalizedFood: this.normalize(rejected),
          kind: FoodPreferenceKind.REJECTED,
          confidence: 0.92,
          occurrences: 1,
          evidence: {
            source: 'EXPLICIT_MESSAGE',
            observedAt: message.timestamp.toISOString(),
          } as Prisma.InputJsonObject,
        });
      }
    }

    const unique = new Map<string, (typeof preferences)[number]>();

    for (const preference of preferences) {
      const key = `${preference.normalizedFood}:${preference.kind}`;
      const current = unique.get(key);

      if (!current || current.confidence < preference.confidence) {
        unique.set(key, preference);
      }
    }

    return [...unique.values()]
      .filter((item) => item.normalizedFood.length >= 2)
      .sort(
        (left, right) =>
          right.confidence - left.confidence ||
          right.occurrences - left.occurrences,
      )
      .slice(0, 50);
  }

  recommendationFeedback(
    recommendations: Array<{
      category: string;
      signalKey: string;
      status: RecommendationStatus;
    }>,
  ) {
    const acceptedCount = recommendations.filter(
      (item) => item.status === RecommendationStatus.ACCEPTED,
    ).length;
    const rejectedCount = recommendations.filter(
      (item) => item.status === RecommendationStatus.DISMISSED,
    ).length;
    const ignoredCount = recommendations.filter(
      (item) => item.status === RecommendationStatus.EXPIRED,
    ).length;
    const handled = acceptedCount + rejectedCount + ignoredCount;
    const categoryScores = this.feedbackScores(
      recommendations,
      (item) => item.category,
    );
    const signalScores = this.feedbackScores(
      recommendations,
      (item) => item.signalKey,
    );

    return {
      acceptedCount,
      ignoredCount,
      rejectedCount,
      acceptanceRate:
        handled > 0 ? Math.round((acceptedCount / handled) * 100) : 0,
      categoryScores,
      signalScores,
    };
  }

  private feedbackScores<T>(
    recommendations: T[],
    key: (item: T) => string,
  ): Prisma.InputJsonObject {
    const groups = new Map<
      string,
      { accepted: number; ignored: number; rejected: number }
    >();

    for (const recommendation of recommendations as Array<
      T & { status: RecommendationStatus }
    >) {
      const groupKey = key(recommendation);
      const group = groups.get(groupKey) ?? {
        accepted: 0,
        ignored: 0,
        rejected: 0,
      };

      if (recommendation.status === RecommendationStatus.ACCEPTED) {
        group.accepted += 1;
      } else if (recommendation.status === RecommendationStatus.DISMISSED) {
        group.rejected += 1;
      } else if (recommendation.status === RecommendationStatus.EXPIRED) {
        group.ignored += 1;
      }

      groups.set(groupKey, group);
    }

    return Object.fromEntries(
      [...groups.entries()].map(([groupKey, group]) => [
        groupKey,
        Math.max(
          -30,
          Math.min(
            30,
            group.accepted * 10 - group.rejected * 10 - group.ignored * 4,
          ),
        ),
      ]),
    );
  }

  longitudinalMemories(input: {
    sourceKey: string;
    evolution: ReturnType<LongitudinalCalculatorService['evolution']>;
    relapse: ReturnType<LongitudinalCalculatorService['relapse']>;
    goalProgression: ReturnType<
      LongitudinalCalculatorService['goalProgression']
    >;
    adherenceScore: number;
    preferences: Array<{
      foodName: string;
      kind: FoodPreferenceKind;
      confidence: number;
    }>;
    generatedAt: Date;
  }) {
    const memories: Array<{
      sourceKey: string;
      kind: LongitudinalMemoryKind;
      title: string;
      summary: string;
      evidence: Prisma.InputJsonObject;
      confidence: Prisma.Decimal;
      generatedAt: Date;
    }> = [];

    if (input.evolution.overallDirection === LongitudinalDirection.IMPROVING) {
      memories.push({
        sourceKey: `${input.sourceKey}:memory:victory`,
        kind: LongitudinalMemoryKind.VICTORY,
        title: 'Evolução nutricional consistente',
        summary: 'A qualidade recente avançou em múltiplas dimensões.',
        evidence: { scores: this.jsonDimensions(input.evolution.current) },
        confidence: new Prisma.Decimal('0.9000'),
        generatedAt: input.generatedAt,
      });
    }

    if (input.evolution.overallDirection === LongitudinalDirection.DECLINING) {
      memories.push({
        sourceKey: `${input.sourceKey}:memory:difficulty`,
        kind: LongitudinalMemoryKind.DIFFICULTY,
        title: 'Dificuldade nutricional recente',
        summary: 'O histórico recente mostra dimensões em queda.',
        evidence: { directions: input.evolution.directions },
        confidence: new Prisma.Decimal('0.8800'),
        generatedAt: input.generatedAt,
      });
    }

    if (input.relapse) {
      memories.push({
        sourceKey: `${input.sourceKey}:memory:relapse`,
        kind: LongitudinalMemoryKind.RELAPSE,
        title: 'Recaída nutricional detectada',
        summary: `Sinais de recaída ${input.relapse.severity.toLocaleLowerCase('pt-BR')} em ${input.relapse.reasons.join(', ')}.`,
        evidence: { reasons: input.relapse.reasons },
        confidence: new Prisma.Decimal('0.9300'),
        generatedAt: input.generatedAt,
      });
    }

    if (
      input.goalProgression.state === GoalProgressionState.IMPROVING ||
      input.adherenceScore >= 80
    ) {
      memories.push({
        sourceKey: `${input.sourceKey}:memory:achievement`,
        kind: LongitudinalMemoryKind.ACHIEVEMENT,
        title: 'Progresso no objetivo',
        summary: `Progressão comportamental estimada em ${input.goalProgression.score}/100.`,
        evidence: { adherenceScore: input.adherenceScore },
        confidence: new Prisma.Decimal('0.8500'),
        generatedAt: input.generatedAt,
      });
    }

    const frequent = input.preferences.find(
      (item) => item.kind === FoodPreferenceKind.FREQUENT,
    );

    if (frequent) {
      memories.push({
        sourceKey: `${input.sourceKey}:memory:habit`,
        kind: LongitudinalMemoryKind.POSITIVE_HABIT,
        title: 'Hábito alimentar recorrente',
        summary: `${frequent.foodName} aparece com frequência e pode ser usado em recomendações aderentes.`,
        evidence: {
          food: frequent.foodName,
          confidence: frequent.confidence,
        },
        confidence: new Prisma.Decimal(frequent.confidence.toFixed(4)),
        generatedAt: input.generatedAt,
      });
    }

    return memories;
  }

  async createMonthlyReview(
    transaction: Prisma.TransactionClient,
    userId: string,
    history: LongitudinalMealSignal[],
    preferences: Array<{
      foodName: string;
      kind: FoodPreferenceKind;
      confidence: number;
    }>,
    generatedAt: Date,
  ) {
    const currentMonth = new Date(
      Date.UTC(generatedAt.getUTCFullYear(), generatedAt.getUTCMonth(), 1),
    );
    const monthStart = new Date(
      Date.UTC(
        currentMonth.getUTCFullYear(),
        currentMonth.getUTCMonth() - 1,
        1,
      ),
    );
    const monthMeals = history.filter(
      (meal) =>
        meal.calculatedAt >= monthStart && meal.calculatedAt < currentMonth,
    );

    if (monthMeals.length < 2) {
      return null;
    }

    const firstHalfEnd = new Date(monthStart.getTime() + 15 * DAY_MS);
    const evolution = this.calculator.evolution(
      monthMeals.filter((meal) => meal.calculatedAt >= firstHalfEnd),
      monthMeals.filter((meal) => meal.calculatedAt < firstHalfEnd),
    );
    const regressions = Object.entries(evolution.directions)
      .filter(([, value]) => value === LongitudinalDirection.DECLINING)
      .map(([key]) => key);
    const victories = Object.entries(evolution.directions)
      .filter(([, value]) => value === LongitudinalDirection.IMPROVING)
      .map(([key]) => key);
    const habits = preferences
      .filter((item) => item.kind === FoodPreferenceKind.FREQUENT)
      .slice(0, 5)
      .map((item) => item.foodName);
    const futureRecommendations =
      regressions.length > 0
        ? regressions.map((item) => `Recuperar ${item} com uma ação pequena.`)
        : ['Preservar os hábitos que sustentaram a evolução do mês.'];
    const content = [
      `Revisão mensal: ${monthMeals.length} refeições analisadas.`,
      `Direção geral ${evolution.overallDirection.toLocaleLowerCase('pt-BR')}.`,
      victories.length > 0
        ? `Evoluções: ${victories.join(', ')}.`
        : 'Sem evolução dimensional consolidada.',
      regressions.length > 0
        ? `Regressões: ${regressions.join(', ')}.`
        : 'Sem regressões relevantes.',
      `Próximo foco: ${futureRecommendations[0]}`,
    ].join(' ');

    return transaction.monthlyEvolutionReview.upsert({
      where: {
        userId_monthStart: { userId, monthStart },
      },
      update: {},
      create: {
        userId,
        monthStart,
        periodEnd: new Date(currentMonth.getTime() - DAY_MS),
        direction: evolution.overallDirection,
        evolution: this.jsonDimensions(evolution.current),
        regressions,
        habits,
        victories,
        recommendations: futureRecommendations,
        content,
        generatedAt,
      },
    });
  }

  private async recordEvents(
    transaction: Prisma.TransactionClient,
    input: {
      userId: string;
      profileId: string;
      preferenceCount: number;
      evolutionId: string;
      direction: LongitudinalDirection;
      relapseId: string | null;
      relapseSeverity: string | null;
      progressionId: string;
      progressionState: GoalProgressionState;
      adaptationId: string;
      adaptationMode: string;
      monthlyReviewId: string | null;
      generatedAt: Date;
    },
  ) {
    const records: Array<{
      eventType: string;
      message: string;
      metadata: Prisma.InputJsonObject;
    }> = [
      {
        eventType: 'LONGITUDINAL_PROFILE_UPDATED',
        message: 'Perfil nutricional longitudinal atualizado',
        metadata: { profileId: input.profileId },
      },
      {
        eventType: 'FOOD_PREFERENCE_UPDATED',
        message: 'Preferências alimentares atualizadas',
        metadata: { preferenceCount: input.preferenceCount },
      },
      {
        eventType: 'NUTRITION_EVOLUTION_RECALCULATED',
        message: 'Evolução nutricional recalculada',
        metadata: {
          evolutionId: input.evolutionId,
          direction: input.direction,
        },
      },
      {
        eventType: 'GOAL_PROGRESSION_UPDATED',
        message: 'Progressão do objetivo atualizada',
        metadata: {
          progressionId: input.progressionId,
          state: input.progressionState,
        },
      },
      {
        eventType: 'COACH_PROFILE_ADAPTED',
        message: 'Perfil longitudinal do coach adaptado',
        metadata: {
          adaptationId: input.adaptationId,
          mode: input.adaptationMode,
        },
      },
    ];

    if (input.relapseId) {
      records.push({
        eventType: 'RELAPSE_DETECTED',
        message: 'Recaída nutricional detectada',
        metadata: {
          relapseId: input.relapseId,
          severity: input.relapseSeverity,
        },
      });
    }

    if (input.monthlyReviewId) {
      records.push({
        eventType: 'MONTHLY_REVIEW_GENERATED',
        message: 'Revisão mensal longitudinal gerada',
        metadata: { monthlyReviewId: input.monthlyReviewId },
      });
    }

    await Promise.all(
      records.map((record) =>
        this.events.recordInTransaction(transaction, {
          source: LONGITUDINAL_SOURCE,
          severity:
            record.eventType === 'RELAPSE_DETECTED'
              ? Severity.WARNING
              : Severity.INFO,
          eventType: record.eventType,
          message: record.message,
          metadata: {
            userId: input.userId,
            generatedAt: input.generatedAt.toISOString(),
            ...record.metadata,
          },
        }),
      ),
    );
  }

  private resolveGoal(
    classified: UserGoalType | undefined,
    nutritionGoal: string | undefined,
  ): UserGoalType {
    if (classified) {
      return classified;
    }

    return nutritionGoal === 'MUSCLE_GAIN'
      ? UserGoalType.HYPERTROPHY
      : nutritionGoal === 'WEIGHT_LOSS'
        ? UserGoalType.WEIGHT_LOSS
        : UserGoalType.MAINTENANCE;
  }

  private mealConsistencyScore(meals: LongitudinalMealSignal[]): number {
    const activeDays = new Set(
      meals.map((meal) => meal.calculatedAt.toISOString().slice(0, 10)),
    ).size;
    return Math.min(
      100,
      Math.round((activeDays / EVOLUTION_WINDOW_DAYS) * 100),
    );
  }

  private preferenceTerms(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .flatMap((item) => {
        if (typeof item === 'string') {
          return [item];
        }

        if (this.isRecord(item)) {
          return [item.description, item.type].filter(
            (entry): entry is string => typeof entry === 'string',
          );
        }

        return [];
      })
      .map((item) => item.trim())
      .filter(Boolean);
  }

  private rejectedFoods(content: string): string[] {
    const normalized = content.replace(/\s+/g, ' ').trim();
    const matches = [
      ...normalized.matchAll(
        /(?:não gosto de|nao gosto de|odeio|não quero|nao quero|evito)\s+([^,.!?;]{2,60})/gi,
      ),
    ];

    return matches
      .map((match) => match[1]?.trim())
      .filter((item): item is string => Boolean(item));
  }

  private numericRecord(value: unknown): Record<string, number> {
    if (!this.isRecord(value)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(value).filter(
        (entry): entry is [string, number] => typeof entry[1] === 'number',
      ),
    );
  }

  private stringArray(value: unknown): string[] {
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : [];
  }

  private normalize(value: string): string {
    return value
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLocaleLowerCase('pt-BR')
      .replace(/[^a-z0-9 ]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private average(values: number[]): number {
    return values.length > 0
      ? Math.round(
          values.reduce((total, value) => total + value, 0) / values.length,
        )
      : 0;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  private lock(transaction: Prisma.TransactionClient, userId: string) {
    return transaction.$queryRaw`
      WITH advisory_lock AS (
        SELECT pg_advisory_xact_lock(hashtext(${`longitudinal:${userId}`}))
      )
      SELECT true AS "locked"
      FROM advisory_lock
    `;
  }

  private jsonDimensions(value: {
    quality: number;
    hydration: number;
    vegetables: number;
    ultraProcessed: number;
    sugar: number;
    protein: number;
  }): Prisma.InputJsonObject {
    return {
      quality: value.quality,
      hydration: value.hydration,
      vegetables: value.vegetables,
      ultraProcessed: value.ultraProcessed,
      sugar: value.sugar,
      protein: value.protein,
    };
  }
}
