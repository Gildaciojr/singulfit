import { ConflictException, Injectable } from '@nestjs/common';
import {
  ChurnRiskLevel,
  CoachCommunicationStyle,
  CoachCoachingStyle,
  CoachCommunicationProfileType,
  CoachMessageType,
  CoachMotivationalTrigger,
  CoachMotivationStyle,
  CoachReengagementReason,
  CoachReviewType,
  CoachTone,
  FitnessGoal,
  MealAnalysisStatus,
  MessageDirection,
  Prisma,
  Severity,
  UserGoalType,
} from '@prisma/client';
import { NutritionIntelligenceService } from '../nutrition/nutrition-intelligence.service';
import { EventService } from '../observability/event.service';
import { PrismaService } from '../prisma/prisma.service';
import { BehavioralIntelligenceService } from '../behavior/behavioral-intelligence.service';
import { BehavioralSignals } from '../behavior/interfaces/behavioral.interface';
import { RecommendationService } from '../recommendations/recommendation.service';
import {
  AUTOMATION_RULE_CODES,
  AutomationRuleCode,
} from './automation.constants';
import {
  CoachMetricsService,
  EngagementInput,
  HabitMetricResult,
} from './coach-metrics.service';
import { ListCoachAdminDto } from './dto/list-coach-admin.dto';
import {
  CoachContext,
  CoachResponseSignals,
} from './interfaces/coach-context.interface';
import { UserGoalEngineService } from './user-goal-engine.service';
import { LongitudinalService } from '../longitudinal/longitudinal.service';
import { CoachExperienceService } from './coach-experience.service';
import { CoachExperienceSignals } from './interfaces/coach-experience.interface';
import { AdaptiveIntelligenceService } from '../adaptive-intelligence/adaptive-intelligence.service';
import { AdaptiveIntelligenceSignals } from '../adaptive-intelligence/interfaces/adaptive-intelligence.interface';

const COACH_SOURCE = 'NUTRITION_COACH';
const METRIC_WINDOW_DAYS = 30;

@Injectable()
export class CoachIntelligenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly nutritionIntelligence: NutritionIntelligenceService,
    private readonly goalEngine: UserGoalEngineService,
    private readonly metrics: CoachMetricsService,
    private readonly eventService: EventService,
    private readonly behavioralIntelligence: BehavioralIntelligenceService,
    private readonly recommendationService: RecommendationService,
    private readonly longitudinalService: LongitudinalService,
    private readonly coachExperience: CoachExperienceService,
    private readonly adaptiveIntelligence: AdaptiveIntelligenceService,
  ) {}

  async buildCoachContext(userId: string): Promise<CoachContext> {
    const nutrition =
      await this.nutritionIntelligence.buildUserNutritionContext(userId);
    const [user, mealPatterns, recommendations, longitudinal] =
      await Promise.all([
        this.prisma.user.findUniqueOrThrow({
          where: {
            id: userId,
          },
          select: {
            name: true,
            fitnessProfile: {
              select: {
                goal: true,
                activityLevel: true,
                currentWeightKg: true,
                targetWeightKg: true,
              },
            },
            coachProfile: {
              select: {
                communicationStyle: true,
                coachingStyle: true,
                tone: true,
                motivationStyle: true,
              },
            },
            goalClassification: {
              select: {
                goal: true,
                confidence: true,
              },
            },
          },
        }),
        this.prisma.mealPattern.findMany({
          where: {
            userId,
          },
          select: {
            category: true,
            mealCount: true,
            frequencyPerWeek: true,
            averageQualityScore: true,
            recurringFoods: true,
          },
          orderBy: [{ mealCount: 'desc' }, { category: 'asc' }],
        }),
        this.prisma.nutritionRecommendation.findMany({
          where: {
            userId,
            active: true,
          },
          select: {
            title: true,
            rationale: true,
            action: true,
            priority: true,
          },
          orderBy: [{ priority: 'asc' }, { generatedAt: 'desc' }],
          take: 5,
        }),
        this.longitudinalService.getResponseContext(userId),
      ]);
    const context: CoachContext = {
      userId,
      name: user.name?.trim()?.split(/\s+/, 1)[0] || 'atleta',
      nutrition,
      fitnessProfile: user.fitnessProfile,
      mealPatterns,
      recommendations,
      coachProfile: user.coachProfile,
      goalClassification: user.goalClassification,
      longitudinal,
    };

    this.assertContext(context);

    return context;
  }

  async recalculateUser(userId: string, at = new Date()) {
    const context = await this.buildCoachContext(userId);
    const snapshotDate = this.utcDay(at);
    const thirtyDaysAgo = new Date(
      at.getTime() - METRIC_WINDOW_DAYS * 86_400_000,
    );
    const fourteenDaysAgo = new Date(at.getTime() - 14 * 86_400_000);
    const sevenDaysAgo = new Date(at.getTime() - 7 * 86_400_000);
    const [meals, messages, previousRisk] = await Promise.all([
      this.prisma.meal.findMany({
        where: {
          userId,
          createdAt: {
            gte: thirtyDaysAgo,
            lte: at,
          },
          analysis: {
            status: MealAnalysisStatus.COMPLETED,
          },
        },
        select: {
          createdAt: true,
        },
        orderBy: {
          createdAt: 'asc',
        },
      }),
      this.prisma.message.findMany({
        where: {
          conversation: {
            userId,
          },
          direction: MessageDirection.INBOUND,
          timestamp: {
            gte: thirtyDaysAgo,
            lte: at,
          },
        },
        select: {
          timestamp: true,
        },
        orderBy: {
          timestamp: 'asc',
        },
      }),
      this.prisma.churnRiskAssessment.findFirst({
        where: {
          userId,
          snapshotDate: {
            lt: snapshotDate,
          },
        },
        orderBy: [{ snapshotDate: 'desc' }, { id: 'desc' }],
      }),
    ]);
    const goal = this.goalEngine.classify({
      nutritionGoal: context.nutrition.goal,
      fitnessGoal: this.fitnessGoal(context),
      snapshotGoal: this.snapshotGoal(context.nutrition.latestSnapshot),
      memorySummaries: context.nutrition.memories.map(
        (memory) => memory.summary,
      ),
    });
    const habit = this.metrics.calculateHabits({
      mealDates: meals.map((meal) => meal.createdAt),
      messageDates: messages.map((message) => message.timestamp),
      at,
      windowDays: METRIC_WINDOW_DAYS,
    });
    const engagementInput = this.engagementInput(
      meals.map((meal) => meal.createdAt),
      messages.map((message) => message.timestamp),
      habit,
      sevenDaysAgo,
    );
    const engagement = this.metrics.calculateEngagement(engagementInput);
    const adherenceScore = this.adherenceScore(context);
    const consistency = this.metrics.calculateConsistency({
      habit,
      adherenceScore,
    });
    const interactionsLast7Days =
      engagementInput.messagesLast7Days + engagementInput.analysesLast7Days;
    const interactionsPrevious7Days =
      messages.filter(
        (message) =>
          message.timestamp >= fourteenDaysAgo &&
          message.timestamp < sevenDaysAgo,
      ).length +
      meals.filter(
        (meal) =>
          meal.createdAt >= fourteenDaysAgo && meal.createdAt < sevenDaysAgo,
      ).length;
    const churn = this.metrics.calculateChurn({
      daysInactive: habit.daysSinceInteraction,
      engagementScore: engagement.score,
      consistencyScore: consistency.score,
      interactionsLast7Days,
      interactionsPrevious7Days,
    });
    const inferredProfile = this.inferProfile(
      goal.goal,
      churn.level,
      consistency.score,
      context.nutrition.memories.map((memory) => memory.summary),
    );

    return this.prisma.$transaction(async (transaction) => {
      const coachProfile = await transaction.coachProfile.upsert({
        where: {
          userId,
        },
        update: {},
        create: {
          userId,
          ...inferredProfile,
        },
      });
      const goalClassification =
        await transaction.userGoalClassification.upsert({
          where: {
            userId,
          },
          update: {
            ...goal,
            classifiedAt: at,
          },
          create: {
            userId,
            ...goal,
            classifiedAt: at,
          },
        });
      const habitSnapshot = await transaction.habitSnapshot.upsert({
        where: {
          userId_snapshotDate: {
            userId,
            snapshotDate,
          },
        },
        update: this.habitData(habit, at),
        create: {
          userId,
          snapshotDate,
          ...this.habitData(habit, at),
        },
      });
      const consistencyRecord = await transaction.consistencyScore.upsert({
        where: {
          userId_snapshotDate: {
            userId,
            snapshotDate,
          },
        },
        update: {
          ...consistency,
          calculatedAt: at,
        },
        create: {
          userId,
          snapshotDate,
          ...consistency,
          calculatedAt: at,
        },
      });
      const engagementRecord = await transaction.engagementScore.upsert({
        where: {
          userId_snapshotDate: {
            userId,
            snapshotDate,
          },
        },
        update: {
          ...engagement,
          ...this.engagementCounts(engagementInput),
          calculatedAt: at,
        },
        create: {
          userId,
          snapshotDate,
          ...engagement,
          ...this.engagementCounts(engagementInput),
          calculatedAt: at,
        },
      });
      const risk = await transaction.churnRiskAssessment.upsert({
        where: {
          userId_snapshotDate: {
            userId,
            snapshotDate,
          },
        },
        update: {
          level: churn.level,
          previousLevel: previousRisk?.level ?? null,
          reasons: churn.reasons,
          daysInactive: habit.daysSinceInteraction,
          engagementScore: engagement.score,
          consistencyScore: consistency.score,
          activityDrop: churn.activityDrop,
          assessedAt: at,
        },
        create: {
          userId,
          snapshotDate,
          level: churn.level,
          previousLevel: previousRisk?.level ?? null,
          reasons: churn.reasons,
          daysInactive: habit.daysSinceInteraction,
          engagementScore: engagement.score,
          consistencyScore: consistency.score,
          activityDrop: churn.activityDrop,
          assessedAt: at,
        },
      });

      await this.recordMetricEvents(transaction, {
        userId,
        at,
        consistencyId: consistencyRecord.id,
        consistencyScore: consistency.score,
        engagementId: engagementRecord.id,
        engagementScore: engagement.score,
      });

      if (previousRisk?.level !== churn.level) {
        await this.eventService.recordInTransaction(transaction, {
          source: COACH_SOURCE,
          severity:
            churn.level === ChurnRiskLevel.HIGH
              ? Severity.WARNING
              : Severity.INFO,
          eventType: 'COACH_CHURN_RISK_CHANGED',
          message: 'Risco de abandono alterado',
          metadata: {
            userId,
            riskAssessmentId: risk.id,
            previousLevel: previousRisk?.level ?? null,
            currentLevel: churn.level,
            daysInactive: habit.daysSinceInteraction,
            activityDrop: churn.activityDrop,
          },
        });
      }

      return {
        context,
        coachProfile,
        goalClassification,
        habit: habitSnapshot,
        consistency: consistencyRecord,
        engagement: engagementRecord,
        churn: risk,
      };
    });
  }

  async generateCoachMessage(
    userId: string,
    ruleCode: AutomationRuleCode,
    scheduledFor: Date,
  ) {
    const state = await this.getDailyState(userId, scheduledFor);
    const behavior = await this.behavioralIntelligence.refreshSignals(
      userId,
      scheduledFor,
    );
    const generatedRecommendations =
      await this.recommendationService.refreshForUser(userId, scheduledFor);
    const adaptive = await this.adaptiveIntelligence.refreshForUser(
      userId,
      scheduledFor,
    );
    const recommendations = this.rankRecommendations(
      generatedRecommendations,
      adaptive,
    );
    const experience = await this.coachExperience.refreshForUser(
      userId,
      this.experienceInput(state, behavior),
      scheduledFor,
    );

    if (
      ruleCode !== AUTOMATION_RULE_CODES.DAILY_COACH &&
      ruleCode !== AUTOMATION_RULE_CODES.REENGAGEMENT
    ) {
      throw new ConflictException('Regra não gera mensagem diária do coach');
    }

    const messageType =
      ruleCode === AUTOMATION_RULE_CODES.REENGAGEMENT ||
      state.churn.level === ChurnRiskLevel.HIGH
        ? CoachMessageType.RECOVERY
        : state.consistency.score >= 75
          ? CoachMessageType.POSITIVE_REINFORCEMENT
          : state.consistency.score < 50
            ? CoachMessageType.FOLLOW_UP
            : CoachMessageType.INCENTIVE;
    const periodKey = this.dayKey(scheduledFor);
    const idempotencyKey = `${userId}:${ruleCode}:${periodKey}`;
    const existing = await this.prisma.coachMessage.findUnique({
      where: {
        idempotencyKey,
      },
    });

    if (existing) {
      return existing;
    }

    const composedContent = this.composeCoachMessage(
      state,
      messageType,
      behavior,
      recommendations,
      experience,
      adaptive,
    );
    const content = await this.ensureNovelMessage(
      userId,
      composedContent,
      scheduledFor,
    );

    return this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        WITH advisory_lock AS (
          SELECT pg_advisory_xact_lock(hashtext(${`coach-message:${idempotencyKey}`}))
        )
        SELECT true AS "locked"
        FROM advisory_lock
      `;
      const concurrent = await transaction.coachMessage.findUnique({
        where: {
          idempotencyKey,
        },
      });

      if (concurrent) {
        return concurrent;
      }

      const message = await transaction.coachMessage.create({
        data: {
          userId,
          type: messageType,
          idempotencyKey,
          content,
          context: this.messageContext(
            state,
            behavior,
            recommendations,
            experience,
            adaptive,
          ),
          generatedAt: new Date(),
          scheduledFor,
        },
      });

      await this.eventService.recordInTransaction(transaction, {
        source: COACH_SOURCE,
        severity: Severity.INFO,
        eventType: 'COACH_MESSAGE_GENERATED',
        message: 'Mensagem contextual do coach gerada',
        metadata: {
          userId,
          coachMessageId: message.id,
          messageType,
          ruleCode,
          churnRisk: state.churn.level,
          behavioralStage: behavior.stage,
          adherencePrediction: behavior.adherenceScore,
        },
      });

      return message;
    });
  }

  async generateReview(
    userId: string,
    type: CoachReviewType,
    generatedAt = new Date(),
  ) {
    const state = await this.getDailyState(userId, generatedAt);
    const behavior = await this.behavioralIntelligence.refreshSignals(
      userId,
      generatedAt,
    );
    const generatedRecommendations =
      await this.recommendationService.refreshForUser(userId, generatedAt);
    const adaptive = await this.adaptiveIntelligence.refreshForUser(
      userId,
      generatedAt,
    );
    const proactiveRecommendations = this.rankRecommendations(
      generatedRecommendations,
      adaptive,
    );
    const experience = await this.coachExperience.refreshForUser(
      userId,
      this.experienceInput(state, behavior),
      generatedAt,
    );
    const period = this.reviewPeriod(type, generatedAt);
    const existing = await this.prisma.coachReview.findUnique({
      where: {
        userId_type_periodStart_periodEnd: {
          userId,
          type,
          periodStart: period.start,
          periodEnd: period.end,
        },
      },
    });

    if (existing) {
      return existing;
    }

    const scores = await this.prisma.nutritionQualityScore.findMany({
      where: {
        userId,
        calculatedAt: {
          gte: period.start,
          lt: period.end,
        },
      },
      select: {
        score: true,
      },
    });
    const averageNutritionScore = this.average(
      scores.map((score) => score.score),
    );
    const trend = state.context.nutrition.trends.find((item) =>
      type === CoachReviewType.WEEKLY
        ? item.windowDays === 7
        : item.windowDays === 30,
    );
    const trendSummary = trend
      ? `Qualidade ${this.trendLabel(trend.direction)}, média ${trend.averageQualityScore}/100 e aderência ${trend.goalAdherenceScore}/100.`
      : 'Ainda não há histórico suficiente para uma tendência consolidada.';
    const achievements = this.reviewAchievements(
      averageNutritionScore,
      state.consistency.score,
      state.habit,
      trend?.direction,
    );
    const opportunities = state.context.nutrition.activeInsights
      .slice(0, 3)
      .map((insight) => insight.title);
    const recommendations = this.mergeCoachRecommendations(
      proactiveRecommendations.map(
        (recommendation) => recommendation.description,
      ),
      state.context.recommendations.map(
        (recommendation) => recommendation.action,
      ),
    );
    const content = this.composeReview(
      state,
      {
        type,
        averageNutritionScore,
        trendSummary,
        achievements,
        opportunities,
        recommendations,
      },
      behavior,
      experience,
      adaptive,
    );

    return this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        WITH advisory_lock AS (
          SELECT pg_advisory_xact_lock(
            hashtext(${`coach-review:${userId}:${type}:${period.start.toISOString()}`})
          )
        )
        SELECT true AS "locked"
        FROM advisory_lock
      `;
      const concurrent = await transaction.coachReview.findUnique({
        where: {
          userId_type_periodStart_periodEnd: {
            userId,
            type,
            periodStart: period.start,
            periodEnd: period.end,
          },
        },
      });

      if (concurrent) {
        return concurrent;
      }

      const review = await transaction.coachReview.create({
        data: {
          userId,
          type,
          periodStart: period.start,
          periodEnd: period.end,
          content,
          averageNutritionScore,
          consistencyScore: state.consistency.score,
          engagementScore: state.engagement.score,
          trendSummary,
          achievements,
          opportunities,
          recommendations,
          generatedAt,
        },
      });

      await this.eventService.recordInTransaction(transaction, {
        source: COACH_SOURCE,
        severity: Severity.INFO,
        eventType:
          type === CoachReviewType.WEEKLY
            ? 'COACH_WEEKLY_REVIEW_GENERATED'
            : 'COACH_MONTHLY_REVIEW_GENERATED',
        message:
          type === CoachReviewType.WEEKLY
            ? 'Revisão semanal do coach gerada'
            : 'Revisão mensal do coach gerada',
        metadata: {
          userId,
          reviewId: review.id,
          reviewType: type,
          averageNutritionScore,
          consistencyScore: state.consistency.score,
          engagementScore: state.engagement.score,
          behavioralStage: behavior.stage,
          adherencePrediction: behavior.adherenceScore,
        },
      });

      return review;
    });
  }

  async getResponseSignals(userId: string): Promise<CoachResponseSignals> {
    const state = await this.getDailyState(userId, new Date());
    const behavior = await this.behavioralIntelligence.refreshSignals(userId);
    const experience = await this.coachExperience.refreshForUser(
      userId,
      this.experienceInput(state, behavior),
    );
    const adaptive = await this.adaptiveIntelligence.refreshForUser(userId);

    return {
      goal: state.goalClassification.goal,
      communicationStyle: state.coachProfile.communicationStyle,
      coachingStyle: state.coachProfile.coachingStyle,
      tone: state.coachProfile.tone,
      motivationStyle: state.coachProfile.motivationStyle,
      consistencyScore: state.consistency.score,
      engagementScore: state.engagement.score,
      churnRisk: state.churn.level,
      activeDays: state.habit.activeDays,
      consecutiveDays: state.habit.consecutiveDays,
      motivation: this.motivationLine(
        state.coachProfile.motivationStyle,
        state.goalClassification.goal,
      ),
      experience,
      adaptive,
    };
  }

  async getExperienceSignals(userId: string, at = new Date()) {
    const state = await this.getDailyState(userId, at);
    const behavior = await this.behavioralIntelligence.refreshSignals(
      userId,
      at,
    );

    return this.coachExperience.refreshForUser(
      userId,
      this.experienceInput(state, behavior),
      at,
    );
  }

  async listUsers(query: ListCoachAdminDto) {
    const records = await this.prisma.user.findMany({
      where: {
        isActive: true,
        id: query.userId,
      },
      select: {
        id: true,
        name: true,
        email: true,
        coachProfile: true,
        goalClassification: true,
        habitSnapshots: {
          orderBy: [{ snapshotDate: 'desc' }, { id: 'desc' }],
          take: 1,
        },
        consistencyScores: {
          orderBy: [{ snapshotDate: 'desc' }, { id: 'desc' }],
          take: 1,
        },
        engagementScores: {
          orderBy: [{ snapshotDate: 'desc' }, { id: 'desc' }],
          take: 1,
        },
        churnAssessments: {
          orderBy: [{ snapshotDate: 'desc' }, { id: 'desc' }],
          take: 1,
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      cursor: query.cursor ? { id: query.cursor } : undefined,
      skip: query.cursor ? 1 : undefined,
      take: query.limit + 1,
    });

    return this.page(
      records.map((record) => ({
        id: record.id,
        name: record.name,
        email: record.email,
        coachProfile: record.coachProfile,
        goal: record.goalClassification,
        habit: record.habitSnapshots[0] ?? null,
        consistency: record.consistencyScores[0] ?? null,
        engagement: record.engagementScores[0] ?? null,
        churn: record.churnAssessments[0] ?? null,
      })),
      query.limit,
    );
  }

  async listEngagement(query: ListCoachAdminDto) {
    return this.page(
      await this.prisma.engagementScore.findMany({
        where: {
          userId: query.userId,
        },
        orderBy: [{ calculatedAt: 'desc' }, { id: 'desc' }],
        cursor: query.cursor ? { id: query.cursor } : undefined,
        skip: query.cursor ? 1 : undefined,
        take: query.limit + 1,
      }),
      query.limit,
    );
  }

  async listChurn(query: ListCoachAdminDto) {
    return this.page(
      await this.prisma.churnRiskAssessment.findMany({
        where: {
          userId: query.userId,
          level: query.risk,
        },
        orderBy: [{ assessedAt: 'desc' }, { id: 'desc' }],
        cursor: query.cursor ? { id: query.cursor } : undefined,
        skip: query.cursor ? 1 : undefined,
        take: query.limit + 1,
      }),
      query.limit,
    );
  }

  async listReviews(query: ListCoachAdminDto) {
    return this.page(
      await this.prisma.coachReview.findMany({
        where: {
          userId: query.userId,
          type: query.reviewType,
        },
        orderBy: [{ generatedAt: 'desc' }, { id: 'desc' }],
        cursor: query.cursor ? { id: query.cursor } : undefined,
        skip: query.cursor ? 1 : undefined,
        take: query.limit + 1,
      }),
      query.limit,
    );
  }

  private async getDailyState(userId: string, at: Date) {
    const snapshotDate = this.utcDay(at);
    const [
      context,
      coachProfile,
      goalClassification,
      habit,
      consistency,
      engagement,
      churn,
    ] = await Promise.all([
      this.buildCoachContext(userId),
      this.prisma.coachProfile.findUnique({ where: { userId } }),
      this.prisma.userGoalClassification.findUnique({ where: { userId } }),
      this.prisma.habitSnapshot.findUnique({
        where: { userId_snapshotDate: { userId, snapshotDate } },
      }),
      this.prisma.consistencyScore.findUnique({
        where: { userId_snapshotDate: { userId, snapshotDate } },
      }),
      this.prisma.engagementScore.findUnique({
        where: { userId_snapshotDate: { userId, snapshotDate } },
      }),
      this.prisma.churnRiskAssessment.findUnique({
        where: { userId_snapshotDate: { userId, snapshotDate } },
      }),
    ]);

    if (
      !coachProfile ||
      !goalClassification ||
      !habit ||
      !consistency ||
      !engagement ||
      !churn
    ) {
      return this.recalculateUser(userId, at);
    }

    return {
      context,
      coachProfile,
      goalClassification,
      habit,
      consistency,
      engagement,
      churn,
    };
  }

  private composeCoachMessage(
    state: Awaited<ReturnType<CoachIntelligenceService['getDailyState']>>,
    type: CoachMessageType,
    behavior: BehavioralSignals,
    proactiveRecommendations: Array<{
      description: string;
    }>,
    experience: CoachExperienceSignals,
    adaptive: AdaptiveIntelligenceSignals,
  ): string {
    const goal = this.goalLabel(state.goalClassification.goal);
    const insight = state.context.nutrition.activeInsights[0];
    const trend = state.context.nutrition.trends.find(
      (item) => item.windowDays === 7,
    );
    const pattern = state.context.mealPatterns[0];
    const proactiveRecommendation = proactiveRecommendations[0];
    const recommendation = state.context.recommendations[0];
    const parts = [
      this.greeting(state.context.name, state.coachProfile),
      this.experienceCoachOpening(experience, behavior),
      this.longitudinalCoachOpening(state.context.longitudinal),
      this.adaptiveCoachOpening(adaptive),
    ];

    if (type === CoachMessageType.RECOVERY) {
      parts.push(
        ...this.reengagementOpening(
          state.context.name,
          goal,
          state.habit.daysSinceInteraction,
          experience,
        ),
      );
    } else if (type === CoachMessageType.POSITIVE_REINFORCEMENT) {
      parts.push(
        `Sua consistência está em ${state.consistency.score}/100, com ${state.habit.consecutiveDays} dia(s) consecutivo(s) de atividade.`,
        `Esse ritmo está sustentando seu objetivo de ${goal}.`,
      );
    } else if (type === CoachMessageType.FOLLOW_UP) {
      parts.push(
        `Sua consistência recente está em ${state.consistency.score}/100 e o engajamento em ${state.engagement.score}/100.`,
        `Para avançar em ${goal}, vamos reduzir a exigência e proteger a continuidade.`,
      );
    } else {
      parts.push(
        `Seu foco continua em ${goal}. Você esteve ativo em ${state.habit.activeDays} dia(s) no último mês.`,
      );
    }

    if (
      trend &&
      (!behavior.useShortMessages ||
        behavior.communicationStyle === 'ANALYTICAL')
    ) {
      parts.push(
        `A tendência de 7 dias está ${this.trendLabel(trend.direction)}, com qualidade média ${trend.averageQualityScore}/100.`,
      );
    }

    if (insight && !behavior.useShortMessages) {
      parts.push(
        `Ponto de atenção: ${insight.title.toLocaleLowerCase('pt-BR')}.`,
      );
    } else if (pattern) {
      parts.push(
        `Seu padrão mais frequente aparece em ${pattern.category.toLocaleLowerCase('pt-BR')}, com média ${pattern.averageQualityScore}/100.`,
      );
    }

    parts.push(
      proactiveRecommendation?.description ??
        recommendation?.action ??
        'Registre a próxima refeição para mantermos o acompanhamento conectado ao que você realmente faz.',
      behavior.motivationLine,
      this.motivationTriggerLine(experience.motivation.dominantTrigger),
      this.momentumLine(experience.momentum.score),
      this.reinforcedMemoryLine(adaptive),
    );

    return this.optimizeAdaptiveMessage(
      this.optimizeWhatsApp(parts.join(' '), experience),
      adaptive,
    );
  }

  private composeReview(
    state: Awaited<ReturnType<CoachIntelligenceService['getDailyState']>>,
    input: {
      type: CoachReviewType;
      averageNutritionScore: number;
      trendSummary: string;
      achievements: string[];
      opportunities: string[];
      recommendations: string[];
    },
    behavior: BehavioralSignals,
    experience: CoachExperienceSignals,
    adaptive: AdaptiveIntelligenceSignals,
  ): string {
    const period = input.type === CoachReviewType.WEEKLY ? 'semana' : 'mês';
    const relapse = state.context.longitudinal.relapse;
    const memories = state.context.longitudinal.memories;
    const strengthenedHabits = memories
      .filter((memory) =>
        ['VICTORY', 'ACHIEVEMENT', 'POSITIVE_HABIT'].includes(memory.kind),
      )
      .slice(0, 3)
      .map((memory) => memory.title);
    const fragileHabits = [
      ...input.opportunities,
      ...(relapse?.reasons ?? []),
    ].slice(0, 3);
    const nextFocus =
      input.recommendations[0] ??
      'Preservar uma ação simples e observável na próxima refeição.';
    const parts =
      input.type === CoachReviewType.WEEKLY
        ? [
            `${state.context.name}, aqui está sua evolução da semana.`,
            `Progresso: qualidade ${input.averageNutritionScore}/100, consistência ${state.consistency.score}/100 e momentum ${experience.momentum.score}/100.`,
            `Pontos fortes: ${input.achievements.length > 0 ? input.achievements.join('; ') : 'você manteve o acompanhamento ativo e produziu dados para ajustar o próximo passo'}.`,
            `Recaídas: ${relapse ? `houve sinais ${relapse.severity.toLocaleLowerCase('pt-BR')} em ${relapse.reasons.join(', ')}` : 'nenhuma recaída relevante foi consolidada'}.`,
            `Aprendizado: ${this.weeklyLearning(experience, behavior)}.`,
            `Evidência nutricional: ${adaptive.nutritionEvidence.score}/100; padrão predominante ${this.patternLabel(adaptive.dietaryPatterns[0]?.pattern)}.`,
            `Memória útil: ${this.reinforcedMemoryLine(adaptive)}`,
            `Foco da próxima semana: ${nextFocus}`,
          ]
        : [
            `${state.context.name}, sua evolução consolidada do mês.`,
            `Tendências: ${input.trendSummary} Momentum ${experience.momentum.score}/100 e força de retenção ${experience.retention.score}/100.`,
            `Hábitos fortalecidos: ${strengthenedHabits.length > 0 ? strengthenedHabits.join('; ') : input.achievements.join('; ') || 'continuidade do registro e observação das refeições'}.`,
            `Hábitos frágeis: ${fragileHabits.length > 0 ? fragileHabits.join('; ') : 'nenhum padrão frágil recorrente foi confirmado'}.`,
            `Evolução alimentar: ${this.evolutionSummary(adaptive)}.`,
            `Aprendizado adaptativo: temas priorizados ${adaptive.learning.preferredTopics.join(', ') || 'ainda em formação'}; risco precoce ${adaptive.earlyChurn.level.toLocaleLowerCase('pt-BR')}.`,
            `Plano recomendado: ${nextFocus}`,
          ];

    parts.push(
      this.motivationTriggerLine(experience.motivation.dominantTrigger),
    );

    return this.optimizeAdaptiveMessage(
      this.optimizeWhatsApp(
        parts.join('\n\n'),
        experience,
        period === 'mês' ? 700 : 500,
      ),
      adaptive,
    );
  }

  private messageContext(
    state: Awaited<ReturnType<CoachIntelligenceService['getDailyState']>>,
    behavior: BehavioralSignals,
    proactiveRecommendations: Array<{
      id: string;
      title: string;
      category: string;
    }>,
    experience: CoachExperienceSignals,
    adaptive: AdaptiveIntelligenceSignals,
  ): Prisma.InputJsonObject {
    const proactiveRecommendation = proactiveRecommendations[0];

    return {
      goal: state.goalClassification.goal,
      consistencyScore: state.consistency.score,
      engagementScore: state.engagement.score,
      churnRisk: state.churn.level,
      daysInactive: state.habit.daysSinceInteraction,
      activeInsight: state.context.nutrition.activeInsights[0]?.type ?? null,
      trend7Days:
        state.context.nutrition.trends.find((item) => item.windowDays === 7)
          ?.direction ?? null,
      recommendation:
        proactiveRecommendation?.title ??
        state.context.recommendations[0]?.title ??
        null,
      recommendationId: proactiveRecommendation?.id ?? null,
      recommendationCategory: proactiveRecommendation?.category ?? null,
      memoryUsed: state.context.nutrition.memories.length > 0,
      patternUsed: state.context.mealPatterns.length > 0,
      behavioralStage: behavior.stage,
      adherencePrediction: behavior.adherenceScore,
      communicationStyle: behavior.communicationStyle,
      motivationStyle: behavior.motivationStyle,
      preferredEngagementHour: behavior.preferredEngagementHour,
      motivationTrigger: behavior.triggers[0]?.type ?? null,
      longitudinalMode:
        state.context.longitudinal.coachAdaptation?.mode ?? null,
      longitudinalDirection:
        state.context.longitudinal.evolution?.overallDirection ?? null,
      relapseSeverity: state.context.longitudinal.relapse?.severity ?? null,
      coachCommunicationProfile: experience.communication.dominantStyle,
      dominantMotivationalTrigger: experience.motivation.dominantTrigger,
      fatigueScore: experience.fatigue.score,
      recommendedFrequencyHours: experience.fatigue.recommendedFrequencyHours,
      goalMomentumScore: experience.momentum.score,
      retentionStrengthScore: experience.retention.score,
      reengagementReason: experience.reengagement?.reason ?? null,
      whatsappIdealMessageLength: experience.whatsapp.idealMessageLength,
      whatsappIdealEmojiCount: experience.whatsapp.idealEmojiCount,
      nutritionEvidenceScore: adaptive.nutritionEvidence.score,
      foodQualityClass: adaptive.foodQuality?.qualityClass ?? null,
      dietaryPatterns: adaptive.dietaryPatterns.map((item) => item.pattern),
      adaptiveCommunicationProfile: adaptive.communication.profile,
      preferredLearningTopics: adaptive.learning.preferredTopics,
      ignoredLearningTopics: adaptive.learning.ignoredTopics,
      earlyChurnScore: adaptive.earlyChurn.score,
      earlyChurnLevel: adaptive.earlyChurn.level,
      reinforcedMemoryCount: adaptive.coachMemory.length,
    };
  }

  private experienceInput(
    state: Awaited<ReturnType<CoachIntelligenceService['getDailyState']>>,
    behavior: BehavioralSignals,
  ) {
    return {
      behavior,
      goal: state.goalClassification.goal,
      consistencyScore: state.consistency.score,
      engagementScore: state.engagement.score,
      adherenceScore: behavior.adherenceScore,
      activeDays: state.habit.activeDays,
      daysInactive: state.habit.daysSinceInteraction,
      churnRisk: state.churn.level,
      longitudinal: state.context.longitudinal,
    };
  }

  private adaptiveCoachOpening(adaptive: AdaptiveIntelligenceSignals): string {
    const evidence = adaptive.nutritionEvidence.score;

    switch (adaptive.communication.profile) {
      case 'EXECUTIVE':
        return `Resumo: evidência nutricional ${evidence}/100 e risco precoce ${adaptive.earlyChurn.level.toLocaleLowerCase('pt-BR')}.`;
      case 'TECHNICAL':
        return `Sinais atuais: evidência ${evidence}/100, proteína ${adaptive.nutritionEvidence.proteinScore}/100, fibras ${adaptive.nutritionEvidence.fiberScore}/100 e hidratação ${adaptive.nutritionEvidence.hydrationScore}/100.`;
      case 'DISCIPLINED':
        return `Indicador atual ${evidence}/100. Vamos proteger uma ação mensurável e repetível.`;
      case 'WARM':
        return `Seu histórico está sendo usado para ajustar o acompanhamento sem julgamento; o indicador atual é ${evidence}/100.`;
      case 'INSPIRATIONAL':
        return `Seu histórico mostra onde uma escolha pequena pode ganhar força; o indicador atual é ${evidence}/100.`;
    }
  }

  private reinforcedMemoryLine(adaptive: AdaptiveIntelligenceSignals): string {
    const memory = adaptive.coachMemory[0];

    if (!memory) {
      return 'Seu histórico ainda está formando uma memória confiável; cada registro melhora o próximo ajuste.';
    }

    return `Lembrando do seu histórico: ${memory.title.toLocaleLowerCase('pt-BR')}. ${memory.summary}`;
  }

  private evolutionSummary(adaptive: AdaptiveIntelligenceSignals): string {
    return adaptive.evolution
      .map(
        (item) =>
          `${item.windowDays} dias ${this.trendLabel(item.direction)} (${item.score}/100)`,
      )
      .join('; ');
  }

  private patternLabel(pattern: string | undefined): string {
    const labels: Record<string, string> = {
      HIGH_PROTEIN: 'alta presença de proteína',
      LOW_PROTEIN: 'baixa presença de proteína',
      EXCESS_SUGAR: 'açúcar elevado',
      HIGH_ULTRA_PROCESSED: 'ultraprocessados elevados',
      LOW_HYDRATION: 'baixa hidratação',
      LOW_VARIETY: 'baixa variedade',
      BALANCED: 'alimentação equilibrada',
    };

    return pattern ? (labels[pattern] ?? pattern.toLowerCase()) : 'em formação';
  }

  private optimizeAdaptiveMessage(
    content: string,
    adaptive: AdaptiveIntelligenceSignals,
  ): string {
    const maximum = adaptive.communication.idealLength;

    if (content.length <= maximum) {
      return content;
    }

    const excerpt = content.slice(0, maximum);
    const boundary = Math.max(
      excerpt.lastIndexOf('. '),
      excerpt.lastIndexOf('\n'),
    );
    const finalLength = boundary >= maximum * 0.7 ? boundary + 1 : maximum;

    return `${excerpt.slice(0, finalLength).trim()} Próximo passo: escolha uma ação viável hoje.`;
  }

  private rankRecommendations<
    T extends {
      id: string;
    },
  >(recommendations: T[], adaptive: AdaptiveIntelligenceSignals): T[] {
    const ranks = new Map(
      adaptive.recommendationRanking.map((item) => [
        item.recommendationId,
        item.rank,
      ]),
    );

    return [...recommendations].sort(
      (left, right) =>
        (ranks.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
        (ranks.get(right.id) ?? Number.MAX_SAFE_INTEGER),
    );
  }

  private experienceCoachOpening(
    experience: CoachExperienceSignals,
    behavior: BehavioralSignals,
  ): string {
    switch (experience.communication.dominantStyle) {
      case CoachCommunicationProfileType.DIRECT:
        return 'Direto ao ponto: escolha uma ação clara para hoje.';
      case CoachCommunicationProfileType.TECHNICAL:
        return `Leitura objetiva: adesão ${behavior.adherenceScore}/100, momentum ${experience.momentum.score}/100.`;
      case CoachCommunicationProfileType.MOTIVATIONAL:
        return 'Seu próximo passo pode recolocar o processo em movimento.';
      case CoachCommunicationProfileType.DISCIPLINARIAN:
        return 'O combinado de hoje é simples: cumprir uma ação possível e registrá-la.';
      case CoachCommunicationProfileType.WARM:
        return 'Vamos retomar com calma, sem transformar uma oscilação em julgamento.';
      case CoachCommunicationProfileType.BALANCED:
        return this.behavioralCoachOpening(behavior);
    }
  }

  private reengagementOpening(
    name: string,
    goal: string,
    daysInactive: number,
    experience: CoachExperienceSignals,
  ): string[] {
    const variant = experience.reengagement?.messageVariant ?? 0;
    const reason =
      experience.reengagement?.reason ?? CoachReengagementReason.FORGOTTEN;
    const messages: Record<CoachReengagementReason, string[]> = {
      [CoachReengagementReason.FORGOTTEN]: [
        `${name}, sua rotina pode ter ficado corrida. Que tal registrar apenas a próxima refeição?`,
        `${name}, passando para recolocar seu objetivo de ${goal} no radar com um passo pequeno.`,
        `${name}, um registro rápido hoje já reconecta o acompanhamento à sua rotina real.`,
        `${name}, sem cobrança: escolha a próxima refeição como ponto de retomada.`,
      ],
      [CoachReengagementReason.MOTIVATION_LOSS]: [
        `${name}, seu ritmo caiu, mas você não precisa recuperar tudo de uma vez.`,
        `${name}, quando a motivação oscila, uma ação mínima funciona melhor que uma meta grande.`,
        `${name}, vamos reduzir a exigência e recuperar a sensação de avanço.`,
        `${name}, hoje o objetivo é apenas voltar a produzir uma pequena vitória.`,
      ],
      [CoachReengagementReason.LACK_OF_RESULTS]: [
        `${name}, entendo que a falta de resultado percebido desanima. Vamos olhar o próximo ajuste observável.`,
        `${name}, o histórico mostrou oscilação. Em vez de apertar tudo, vamos corrigir um ponto por vez.`,
        `${name}, seu progresso precisa ficar mais visível. Registre a próxima refeição para compararmos com o padrão anterior.`,
        `${name}, vamos trocar cobrança por evidência e encontrar o ajuste com maior impacto.`,
      ],
      [CoachReengagementReason.TEMPORARY_ABANDONMENT]: [
        `${name}, foram ${daysInactive} dias sem interação, e isso não apaga o que você já construiu.`,
        `${name}, uma pausa não precisa virar desistência. Recomece com uma única refeição.`,
        `${name}, seu histórico continua aqui. Vamos retomar pelo ponto mais fácil do dia.`,
        `${name}, não é necessário compensar a pausa; basta reconstruir continuidade a partir de hoje.`,
      ],
    };

    return [
      messages[reason][variant % messages[reason].length],
      'Responda com o que parece mais viável agora, e eu ajusto o próximo passo.',
    ];
  }

  private motivationTriggerLine(trigger: CoachMotivationalTrigger): string {
    const lines: Record<CoachMotivationalTrigger, string> = {
      [CoachMotivationalTrigger.VISUAL_RESULT]:
        'Vamos tornar a evolução visível por meio de escolhas que você consiga repetir.',
      [CoachMotivationalTrigger.HEALTH]:
        'O próximo passo deve apoiar sua energia e sua saúde no cotidiano.',
      [CoachMotivationalTrigger.SELF_ESTEEM]:
        'Cumprir um compromisso pequeno reforça confiança no processo.',
      [CoachMotivationalTrigger.PERFORMANCE]:
        'Use a próxima escolha como suporte concreto para desempenho e recuperação.',
      [CoachMotivationalTrigger.DISCIPLINE]:
        'Disciplina aqui significa repetir o básico mesmo quando o dia não está perfeito.',
      [CoachMotivationalTrigger.LONGEVITY]:
        'A melhor estratégia é a que continua funcionando no longo prazo.',
      [CoachMotivationalTrigger.ROUTINE]:
        'Encaixe a ação no horário e contexto em que sua rotina já acontece.',
    };

    return lines[trigger];
  }

  private momentumLine(score: number): string {
    if (score >= 75) {
      return `Seu momentum está forte (${score}/100); preserve a estrutura que já funciona.`;
    }

    if (score >= 45) {
      return `Seu momentum está em construção (${score}/100); consistência vale mais que intensidade agora.`;
    }

    return `Seu momentum está baixo (${score}/100); reduza o esforço e proteja apenas o próximo passo.`;
  }

  private weeklyLearning(
    experience: CoachExperienceSignals,
    behavior: BehavioralSignals,
  ): string {
    if (experience.fatigue.score >= 60) {
      return 'mensagens mais curtas e espaçadas tendem a preservar sua atenção';
    }

    if (behavior.adherenceScore >= 70) {
      return 'ações específicas e registradas estão sustentando melhor sua adesão';
    }

    return 'metas pequenas e ligadas à sua rotina têm mais chance de virar continuidade';
  }

  private optimizeWhatsApp(
    content: string,
    experience: CoachExperienceSignals,
    extraLength = 0,
  ): string {
    const maximum = experience.whatsapp.idealMessageLength + extraLength;
    let optimized =
      experience.whatsapp.idealEmojiCount === 0
        ? content.replace(/\p{Extended_Pictographic}/gu, '').trim()
        : content;

    if (optimized.length <= maximum) {
      return optimized;
    }

    const excerpt = optimized.slice(0, maximum);
    const boundary = Math.max(
      excerpt.lastIndexOf('. '),
      excerpt.lastIndexOf('\n'),
    );
    optimized = excerpt.slice(
      0,
      boundary >= maximum * 0.65 ? boundary + 1 : maximum,
    );

    return `${optimized.trim()} Próximo passo: responda com o que é viável hoje.`;
  }

  private async ensureNovelMessage(
    userId: string,
    content: string,
    generatedAt: Date,
  ): Promise<string> {
    const recent = await this.prisma.coachMessage.findMany({
      where: { userId },
      select: { content: true },
      orderBy: [{ generatedAt: 'desc' }, { id: 'desc' }],
      take: 5,
    });
    const normalized = this.normalizedMessage(content);

    if (
      !recent.some(
        (message) => this.normalizedMessage(message.content) === normalized,
      )
    ) {
      return content;
    }

    const variations = [
      'Hoje, comece pela refeição que parece mais fácil de organizar.',
      'Escolha um horário concreto para executar esse próximo passo.',
      'Quando concluir, registre para que o próximo ajuste use evidência real.',
      'Faça a menor versão possível da ação e preserve a continuidade.',
    ];
    const day = Math.floor(generatedAt.getTime() / 86_400_000);

    return `${content} ${variations[Math.abs(day) % variations.length]}`;
  }

  private normalizedMessage(value: string): string {
    return value
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLocaleLowerCase('pt-BR')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private longitudinalCoachOpening(
    longitudinal: CoachContext['longitudinal'],
  ): string {
    switch (longitudinal.coachAdaptation?.mode) {
      case 'TECHNICAL':
        return 'Seu histórico já permite uma orientação mais técnica e comparativa.';
      case 'PERFORMANCE':
        return 'Sua base está consistente; agora podemos refinar desempenho e precisão.';
      case 'RECOVERY':
        return 'O histórico mostra uma oscilação recente; vamos recuperar o básico antes de aumentar a exigência.';
      case 'ENCOURAGING':
      default:
        return 'A prioridade é consolidar uma ação possível e repetível.';
    }
  }

  private behavioralCoachOpening(behavior: BehavioralSignals): string {
    switch (behavior.communicationStyle) {
      case 'DIRECT':
        return 'Prioridade de hoje: uma ação clara e executável.';
      case 'ANALYTICAL':
        return `Leitura atual: adesão prevista ${behavior.adherenceScore}/100 e engajamento ${behavior.engagementScore}/100.`;
      case 'COACH':
        return 'Vamos escolher um passo que caiba no seu dia real.';
      case 'MOTIVATIONAL':
        return 'Seu próximo passo vale mais do que tentar acertar tudo de uma vez.';
      case 'FRIENDLY':
        return 'Vamos cuidar do próximo passo sem complicar.';
    }
  }

  private mergeCoachRecommendations(
    proactive: string[],
    nutrition: string[],
  ): string[] {
    const seen = new Set<string>();

    return [...proactive, ...nutrition]
      .filter((recommendation) => {
        const key = recommendation
          .normalize('NFD')
          .replace(/\p{Diacritic}/gu, '')
          .toLocaleLowerCase('pt-BR')
          .replace(/\s+/g, ' ')
          .trim();

        if (seen.has(key)) {
          return false;
        }

        seen.add(key);
        return true;
      })
      .slice(0, 3);
  }

  private stageLabel(stage: string): string {
    const labels: Record<string, string> = {
      PRE_CONTEMPLATION: 'observação',
      CONTEMPLATION: 'reflexão',
      PREPARATION: 'preparação',
      ACTION: 'ação',
      MAINTENANCE: 'manutenção',
    };

    return labels[stage] ?? 'ação';
  }

  private inferProfile(
    goal: UserGoalType,
    churn: ChurnRiskLevel,
    consistency: number,
    memories: string[],
  ) {
    const hasDataLanguage = memories.some((summary) =>
      /\b(score|média|media|kg|caloria|proteína|proteina)\b/i.test(summary),
    );

    return {
      communicationStyle: CoachCommunicationStyle.FRIENDLY,
      coachingStyle:
        churn === ChurnRiskLevel.HIGH
          ? CoachCoachingStyle.MOTIVATIONAL
          : consistency < 60
            ? CoachCoachingStyle.ACCOUNTABILITY
            : CoachCoachingStyle.EDUCATOR,
      tone:
        churn === ChurnRiskLevel.HIGH
          ? CoachTone.SOFT
          : consistency >= 80
            ? CoachTone.DIRECT
            : CoachTone.MODERATE,
      motivationStyle: hasDataLanguage
        ? CoachMotivationStyle.DATA_DRIVEN
        : goal === UserGoalType.HYPERTROPHY
          ? CoachMotivationStyle.ACHIEVEMENT
          : goal === UserGoalType.WEIGHT_LOSS
            ? CoachMotivationStyle.APPEARANCE
            : CoachMotivationStyle.HEALTH,
    };
  }

  private greeting(
    name: string,
    profile: {
      communicationStyle: CoachCommunicationStyle;
      tone: CoachTone;
    },
  ): string {
    if (profile.communicationStyle === CoachCommunicationStyle.FORMAL) {
      return `${name}, segue seu acompanhamento nutricional.`;
    }

    if (profile.tone === CoachTone.DIRECT) {
      return `${name}, vamos ao ponto.`;
    }

    return `${name}, estou acompanhando seu ritmo de perto.`;
  }

  private motivationLine(
    style: CoachMotivationStyle,
    goal: UserGoalType,
  ): string {
    switch (style) {
      case CoachMotivationStyle.DATA_DRIVEN:
        return 'Use o próximo registro para transformar percepção em dados e ajustar com precisão.';
      case CoachMotivationStyle.ACHIEVEMENT:
        return 'Cada repetição bem executada aproxima você de uma conquista concreta.';
      case CoachMotivationStyle.APPEARANCE:
        return `Mudanças visíveis em ${this.goalLabel(goal)} vêm da soma de escolhas sustentáveis.`;
      case CoachMotivationStyle.HEALTH:
        return 'O objetivo é construir um hábito que também cuide da sua energia e bem-estar.';
    }
  }

  private reviewAchievements(
    nutritionScore: number,
    consistencyScore: number,
    habit: { activeDays: number; consecutiveDays: number },
    trendDirection?: string,
  ): string[] {
    const achievements: string[] = [];

    if (nutritionScore >= 70) {
      achievements.push(`qualidade média de ${nutritionScore}/100`);
    }

    if (consistencyScore >= 70) {
      achievements.push(`consistência de ${consistencyScore}/100`);
    }

    if (habit.consecutiveDays >= 3) {
      achievements.push(`${habit.consecutiveDays} dias consecutivos`);
    } else if (habit.activeDays > 0) {
      achievements.push(`${habit.activeDays} dias ativos`);
    }

    if (trendDirection === 'IMPROVING') {
      achievements.push('tendência nutricional em melhora');
    }

    return achievements;
  }

  private reviewPeriod(type: CoachReviewType, at: Date) {
    if (type === CoachReviewType.WEEKLY) {
      const end = this.utcDay(at);
      return {
        start: new Date(end.getTime() - 7 * 86_400_000),
        end,
      };
    }

    const end = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
    const start = new Date(
      Date.UTC(at.getUTCFullYear(), at.getUTCMonth() - 1, 1),
    );

    return { start, end };
  }

  private adherenceScore(context: CoachContext): number {
    const trend = context.nutrition.trends.find(
      (item) => item.windowDays === 30,
    );

    if (trend) {
      return trend.goalAdherenceScore;
    }

    if (
      this.isRecord(context.nutrition.latestSnapshot) &&
      typeof context.nutrition.latestSnapshot.adherenceScore === 'number'
    ) {
      return context.nutrition.latestSnapshot.adherenceScore;
    }

    return 50;
  }

  private engagementInput(
    mealDates: Date[],
    messageDates: Date[],
    habit: HabitMetricResult,
    sevenDaysAgo: Date,
  ): EngagementInput {
    return {
      messagesLast7Days: messageDates.filter((date) => date >= sevenDaysAgo)
        .length,
      messagesLast30Days: messageDates.length,
      analysesLast7Days: mealDates.filter((date) => date >= sevenDaysAgo)
        .length,
      analysesLast30Days: mealDates.length,
      activeDaysLast7: habit.activeDaysLast7,
      activeDaysLast30: habit.activeDays,
    };
  }

  private habitData(habit: HabitMetricResult, calculatedAt: Date) {
    return {
      windowDays: habit.windowDays,
      mealsRegistered: habit.mealsRegistered,
      messagesSent: habit.messagesSent,
      activeDays: habit.activeDays,
      consecutiveDays: habit.consecutiveDays,
      daysSinceInteraction: habit.daysSinceInteraction,
      mealFrequency: new Prisma.Decimal(habit.mealFrequency.toFixed(2)),
      interactionFrequency: new Prisma.Decimal(
        habit.interactionFrequency.toFixed(2),
      ),
      regularityScore: habit.regularityScore,
      calculatedAt,
    };
  }

  private engagementCounts(input: EngagementInput) {
    return {
      messagesLast7Days: input.messagesLast7Days,
      messagesLast30Days: input.messagesLast30Days,
      analysesLast7Days: input.analysesLast7Days,
      analysesLast30Days: input.analysesLast30Days,
    };
  }

  private recordMetricEvents(
    transaction: Prisma.TransactionClient,
    input: {
      userId: string;
      at: Date;
      consistencyId: string;
      consistencyScore: number;
      engagementId: string;
      engagementScore: number;
    },
  ) {
    return Promise.all([
      this.eventService.recordInTransaction(transaction, {
        source: COACH_SOURCE,
        severity: Severity.INFO,
        eventType: 'COACH_CONSISTENCY_RECALCULATED',
        message: 'Score de consistência recalculado',
        metadata: {
          userId: input.userId,
          consistencyScoreId: input.consistencyId,
          score: input.consistencyScore,
          calculatedAt: input.at.toISOString(),
        },
      }),
      this.eventService.recordInTransaction(transaction, {
        source: COACH_SOURCE,
        severity: Severity.INFO,
        eventType: 'COACH_ENGAGEMENT_RECALCULATED',
        message: 'Score de engajamento recalculado',
        metadata: {
          userId: input.userId,
          engagementScoreId: input.engagementId,
          score: input.engagementScore,
          calculatedAt: input.at.toISOString(),
        },
      }),
    ]);
  }

  private fitnessGoal(context: CoachContext): FitnessGoal | null {
    const goal = context.fitnessProfile?.goal;
    return goal && Object.values(FitnessGoal).includes(goal as FitnessGoal)
      ? (goal as FitnessGoal)
      : null;
  }

  private snapshotGoal(value: unknown): FitnessGoal | null {
    if (
      this.isRecord(value) &&
      typeof value.goal === 'string' &&
      Object.values(FitnessGoal).includes(value.goal as FitnessGoal)
    ) {
      return value.goal as FitnessGoal;
    }

    return null;
  }

  private assertContext(context: CoachContext): void {
    const nutrition = context.nutrition;
    const hasIdentity = Boolean(
      nutrition.goal || context.fitnessProfile || nutrition.latestSnapshot,
    );
    const hasBehavior = Boolean(
      nutrition.memories.length ||
      nutrition.recentMeals.length ||
      nutrition.activeInsights.length ||
      nutrition.trends.length ||
      context.mealPatterns.length ||
      context.recommendations.length,
    );

    if (!hasIdentity || !hasBehavior) {
      throw new ConflictException(
        'Contexto insuficiente para gerar acompanhamento do coach',
      );
    }
  }

  private goalLabel(goal: UserGoalType): string {
    const labels: Record<UserGoalType, string> = {
      [UserGoalType.WEIGHT_LOSS]: 'redução de peso',
      [UserGoalType.HYPERTROPHY]: 'hipertrofia',
      [UserGoalType.MAINTENANCE]: 'manutenção',
      [UserGoalType.HEALTH]: 'saúde e bem-estar',
    };

    return labels[goal];
  }

  private trendLabel(direction: string): string {
    return direction === 'IMPROVING'
      ? 'em melhora'
      : direction === 'DECLINING'
        ? 'em queda'
        : 'estável';
  }

  private average(values: number[]): number {
    if (values.length === 0) {
      return 0;
    }

    return Math.round(
      values.reduce((sum, value) => sum + value, 0) / values.length,
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

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
