import {
  ChurnRiskLevel,
  CoachCommunicationStyle,
  CoachCoachingStyle,
  CoachMessageType,
  CoachMotivationStyle,
  CoachReviewType,
  CoachTone,
  Prisma,
  UserGoalType,
} from '@prisma/client';
import { NutritionIntelligenceService } from '../nutrition/nutrition-intelligence.service';
import { EventService } from '../observability/event.service';
import { PrismaService } from '../prisma/prisma.service';
import { AUTOMATION_RULE_CODES } from './automation.constants';
import { CoachIntelligenceService } from './coach-intelligence.service';
import { CoachMetricsService } from './coach-metrics.service';
import { UserGoalEngineService } from './user-goal-engine.service';
import { BehavioralIntelligenceService } from '../behavior/behavioral-intelligence.service';
import { RecommendationService } from '../recommendations/recommendation.service';
import { LongitudinalService } from '../longitudinal/longitudinal.service';
import { CoachExperienceService } from './coach-experience.service';
import { AdaptiveIntelligenceService } from '../adaptive-intelligence/adaptive-intelligence.service';

describe('CoachIntelligenceService', () => {
  function state() {
    return {
      context: {
        userId: 'user-id',
        name: 'Lucy',
        nutrition: {
          userId: 'user-id',
          goal: 'WEIGHT_LOSS',
          activityLevel: 'MODERATE',
          restrictions: [],
          allergies: [],
          preferences: {
            preferredMealTimes: ['12:00'],
            preferredLanguage: 'pt-BR',
            timezone: 'America/Sao_Paulo',
          },
          latestSnapshot: { adherenceScore: 74 },
          memories: [{ summary: 'Quero emagrecer com saúde', content: {} }],
          statistics: {
            nutritionAnalysesCount: 8,
            adherenceScore: 74,
            messagesLast7Days: 4,
            messagesLast30Days: 15,
          },
          recentMeals: [],
          activeInsights: [
            {
              id: 'insight-id',
              type: 'LOW_PROTEIN',
              title: 'Proteína abaixo do ideal',
              summary: 'Padrão recorrente',
              occurrences: 3,
            },
          ],
          trends: [
            {
              windowDays: 7,
              averageQualityScore: 68,
              direction: 'IMPROVING',
              consistencyScore: 72,
              goalAdherenceScore: 74,
            },
          ],
        },
        fitnessProfile: null,
        mealPatterns: [
          {
            category: 'LUNCH',
            mealCount: 5,
            frequencyPerWeek: new Prisma.Decimal('3.5'),
            averageQualityScore: 65,
            recurringFoods: [],
          },
        ],
        recommendations: [
          {
            title: 'Distribua proteína',
            rationale: 'Padrão recente',
            action: 'Inclua uma fonte de proteína no almoço.',
            priority: 1,
          },
        ],
        coachProfile: null,
        goalClassification: null,
        longitudinal: {
          profile: {
            historySize: 8,
            adherenceScore: 74,
            consistencyScore: 72,
          },
          preferences: [],
          evolution: {
            overallDirection: 'IMPROVING',
            scores: {
              quality: 73,
              hydration: 60,
              vegetables: 68,
              ultraProcessed: 80,
              sugar: 78,
              protein: 72,
            },
          },
          relapse: null,
          goalProgression: {
            goal: UserGoalType.WEIGHT_LOSS,
            state: 'IMPROVING',
            score: 76,
          },
          coachAdaptation: {
            mode: 'TECHNICAL',
            reason: 'Histórico suficiente.',
          },
          memories: [],
          monthlyReview: null,
        },
      },
      coachProfile: {
        id: 'profile-id',
        userId: 'user-id',
        communicationStyle: CoachCommunicationStyle.FRIENDLY,
        coachingStyle: CoachCoachingStyle.MOTIVATIONAL,
        tone: CoachTone.SOFT,
        motivationStyle: CoachMotivationStyle.HEALTH,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      goalClassification: {
        id: 'goal-id',
        userId: 'user-id',
        goal: UserGoalType.WEIGHT_LOSS,
        confidence: new Prisma.Decimal('0.9'),
        evidence: {},
        classifiedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      habit: {
        id: 'habit-id',
        userId: 'user-id',
        snapshotDate: new Date('2026-06-13T00:00:00.000Z'),
        windowDays: 30,
        mealsRegistered: 8,
        messagesSent: 15,
        activeDays: 10,
        consecutiveDays: 3,
        daysSinceInteraction: 0,
        mealFrequency: new Prisma.Decimal('1.87'),
        interactionFrequency: new Prisma.Decimal('3.5'),
        regularityScore: 70,
        calculatedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      consistency: {
        id: 'consistency-id',
        userId: 'user-id',
        snapshotDate: new Date('2026-06-13T00:00:00.000Z'),
        score: 72,
        frequencyScore: 65,
        regularityScore: 70,
        adherenceScore: 74,
        continuityScore: 85,
        calculatedAt: new Date(),
        createdAt: new Date(),
      },
      engagement: {
        id: 'engagement-id',
        userId: 'user-id',
        snapshotDate: new Date('2026-06-13T00:00:00.000Z'),
        score: 68,
        messagesScore: 70,
        analysesScore: 65,
        weeklyUsageScore: 80,
        monthlyUsageScore: 60,
        messagesLast7Days: 4,
        messagesLast30Days: 15,
        analysesLast7Days: 3,
        analysesLast30Days: 8,
        calculatedAt: new Date(),
        createdAt: new Date(),
      },
      churn: {
        id: 'churn-id',
        userId: 'user-id',
        snapshotDate: new Date('2026-06-13T00:00:00.000Z'),
        level: ChurnRiskLevel.LOW,
        previousLevel: null,
        reasons: [],
        daysInactive: 0,
        engagementScore: 68,
        consistencyScore: 72,
        activityDrop: 0,
        assessedAt: new Date(),
        createdAt: new Date(),
      },
    };
  }

  function adaptiveSignals() {
    return {
      nutritionEvidence: {
        score: 78,
        vegetableScore: 70,
        proteinScore: 82,
        ultraProcessedScore: 85,
        sugarScore: 80,
        fiberScore: 72,
        hydrationScore: 65,
        mealsAnalyzed: 8,
      },
      foodQuality: {
        qualityClass: 'GOOD',
        score: 78,
        positiveFactors: ['proteína'],
        limitingFactors: ['hidratação'],
        explanation: 'Índice 78/100 com boa presença de proteína.',
      },
      dietaryPatterns: [{ pattern: 'BALANCED', confidence: 0.78 }],
      learning: {
        acceptedCount: 3,
        ignoredCount: 1,
        rejectedCount: 0,
        shortChallengeScore: 75,
        preferredTopics: ['protein'],
        ignoredTopics: [],
        topicScores: { protein: 82 },
        confidence: 0.8,
      },
      communication: {
        profile: 'TECHNICAL',
        confidence: 0.85,
        idealLength: 1200,
        structurePreference: 'DATA_ACTION',
      },
      earlyChurn: { score: 18, level: 'LOW', reasons: [] },
      recommendationRanking: [
        {
          recommendationId: 'proactive-id',
          rank: 1,
          adaptiveScore: 90,
        },
      ],
      evolution: [
        {
          windowDays: 7,
          score: 78,
          previousScore: 72,
          direction: 'IMPROVING',
        },
      ],
      coachMemory: [
        {
          kind: 'VICTORY',
          title: 'Consistência no almoço',
          summary: 'A qualidade do almoço melhorou.',
        },
      ],
    };
  }

  function createSubject() {
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([{ locked: true }]),
      coachMessage: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            id: 'message-id',
            createdAt: new Date(),
            ...data,
          }),
        ),
      },
      coachReview: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            id: 'review-id',
            createdAt: new Date(),
            updatedAt: new Date(),
            ...data,
          }),
        ),
      },
      systemEvent: {
        create: jest.fn().mockResolvedValue({ id: 'event-id' }),
      },
    };
    const prisma = {
      $transaction: jest.fn(
        (callback: (client: typeof transaction) => unknown) =>
          callback(transaction),
      ),
      coachMessage: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      coachReview: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      nutritionQualityScore: {
        findMany: jest.fn().mockResolvedValue([{ score: 70 }, { score: 76 }]),
      },
    };
    const behavioralIntelligence = {
      refreshSignals: jest.fn().mockResolvedValue({
        communicationStyle: 'FRIENDLY',
        motivationStyle: 'HEALTH',
        adherenceStyle: 'FLEXIBLE',
        personalityPattern: 'BALANCED',
        motivationLine: 'Sua saúde ganha força com constância.',
        stage: 'ACTION',
        adherenceScore: 74,
        engagementScore: 68,
        preferredEngagementHour: 9,
        confidenceScore: 0.84,
        motivations: [{ type: 'HEALTH', weight: 60 }],
        triggers: [{ type: 'PROGRESS', weight: 90 }],
        insights: [],
        useShortMessages: false,
      }),
    };
    const recommendationService = {
      refreshForUser: jest.fn().mockResolvedValue([
        {
          id: 'proactive-id',
          title: 'Priorize proteína na próxima refeição',
          description: 'Inclua uma fonte de proteína no próximo almoço.',
          category: 'NUTRITION',
        },
      ]),
    };
    const coachExperience = {
      refreshForUser: jest.fn().mockResolvedValue({
        communication: {
          dominantStyle: 'BALANCED',
          confidence: 0.85,
          scores: {
            DIRECT: 10,
            TECHNICAL: 20,
            MOTIVATIONAL: 15,
            DISCIPLINARIAN: 10,
            WARM: 20,
            BALANCED: 25,
          },
        },
        motivation: {
          dominantTrigger: 'HEALTH',
          confidence: 0.82,
          scores: {
            VISUAL_RESULT: 10,
            HEALTH: 40,
            SELF_ESTEEM: 10,
            PERFORMANCE: 10,
            DISCIPLINE: 10,
            LONGEVITY: 10,
            ROUTINE: 10,
          },
        },
        fatigue: {
          score: 20,
          recommendedFrequencyHours: 24,
          repeatedThemeScore: 0,
          repeatedPhraseScore: 0,
          interactionResponseScore: 80,
        },
        reengagement: {
          reason: 'FORGOTTEN',
          confidence: 0.72,
          messageVariant: 1,
        },
        momentum: { score: 72 },
        retention: { score: 74 },
        whatsapp: {
          idealMessageLength: 900,
          idealEmojiCount: 0,
          idealFrequencyHours: 24,
          preferredHourUtc: 9,
        },
        canSendCoachMessage: true,
        nextCoachMessageAt: null,
      }),
    };
    const adaptiveIntelligence = {
      refreshForUser: jest.fn().mockResolvedValue(adaptiveSignals()),
    };
    const service = new CoachIntelligenceService(
      prisma as unknown as PrismaService,
      {} as NutritionIntelligenceService,
      new UserGoalEngineService(),
      new CoachMetricsService(),
      new EventService({} as PrismaService),
      behavioralIntelligence as unknown as BehavioralIntelligenceService,
      recommendationService as unknown as RecommendationService,
      {
        getResponseContext: jest
          .fn()
          .mockResolvedValue(state().context.longitudinal),
      } as unknown as LongitudinalService,
      coachExperience as unknown as CoachExperienceService,
      adaptiveIntelligence as unknown as AdaptiveIntelligenceService,
    );
    jest.spyOn(service as any, 'getDailyState').mockResolvedValue(state());

    return {
      service,
      prisma,
      transaction,
      behavioralIntelligence,
      recommendationService,
      coachExperience,
      adaptiveIntelligence,
    };
  }

  it('generates and persists a contextual daily coach message', async () => {
    const subject = createSubject();
    const message = await subject.service.generateCoachMessage(
      'user-id',
      AUTOMATION_RULE_CODES.DAILY_COACH,
      new Date('2026-06-13T12:00:00.000Z'),
    );

    expect(message).toEqual(
      expect.objectContaining({
        type: CoachMessageType.INCENTIVE,
        content: expect.stringContaining('proteína abaixo do ideal'),
      }),
    );
    expect(subject.transaction.coachMessage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        idempotencyKey: 'user-id:DAILY_COACH:2026-06-13',
        context: expect.objectContaining({
          memoryUsed: true,
          patternUsed: true,
          recommendationId: 'proactive-id',
        }),
      }),
    });
    expect(subject.transaction.systemEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventType: 'COACH_MESSAGE_GENERATED',
      }),
    });
  });

  it('returns an existing coach message without generating a duplicate', async () => {
    const subject = createSubject();
    subject.prisma.coachMessage.findUnique.mockResolvedValue({
      id: 'existing-message',
      content: 'Mensagem existente',
    });

    await expect(
      subject.service.generateCoachMessage(
        'user-id',
        AUTOMATION_RULE_CODES.DAILY_COACH,
        new Date('2026-06-13T12:00:00.000Z'),
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        id: 'existing-message',
      }),
    );
    expect(subject.transaction.coachMessage.create).not.toHaveBeenCalled();
  });

  it('adds a contextual variation when the previous coach text is identical', async () => {
    const subject = createSubject();
    const first = await subject.service.generateCoachMessage(
      'user-id',
      AUTOMATION_RULE_CODES.DAILY_COACH,
      new Date('2026-06-13T12:00:00.000Z'),
    );
    subject.prisma.coachMessage.findMany.mockResolvedValue([
      { content: first.content },
    ]);

    const second = await subject.service.generateCoachMessage(
      'user-id',
      AUTOMATION_RULE_CODES.DAILY_COACH,
      new Date('2026-06-14T12:00:00.000Z'),
    );

    expect(second.content).not.toBe(first.content);
    expect(second.content.length).toBeGreaterThan(first.content.length);
  });

  it.each([CoachReviewType.WEEKLY, CoachReviewType.MONTHLY])(
    'persists a contextual %s review with observability',
    async (type) => {
      const subject = createSubject();
      const review = await subject.service.generateReview(
        'user-id',
        type,
        new Date('2026-06-13T12:00:00.000Z'),
      );

      expect(review.content).toContain(
        type === CoachReviewType.WEEKLY
          ? 'Progresso: qualidade 73/100'
          : 'evolução consolidada do mês',
      );
      expect(subject.transaction.coachReview.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type,
          consistencyScore: 72,
          engagementScore: 68,
          recommendations: [
            'Inclua uma fonte de proteína no próximo almoço.',
            'Inclua uma fonte de proteína no almoço.',
          ],
        }),
      });
      expect(subject.transaction.systemEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          eventType:
            type === CoachReviewType.WEEKLY
              ? 'COACH_WEEKLY_REVIEW_GENERATED'
              : 'COACH_MONTHLY_REVIEW_GENERATED',
        }),
      });
    },
  );

  it('returns persisted coach signals for response personalization', async () => {
    const subject = createSubject();

    await expect(
      subject.service.getResponseSignals('user-id'),
    ).resolves.toEqual(
      expect.objectContaining({
        goal: UserGoalType.WEIGHT_LOSS,
        consistencyScore: 72,
        engagementScore: 68,
        churnRisk: ChurnRiskLevel.LOW,
        motivation: expect.stringContaining('energia e bem-estar'),
      }),
    );
  });

  it('builds coach context from memory, preferences, nutrition signals and patterns', async () => {
    const nutritionIntelligence = {
      buildUserNutritionContext: jest
        .fn()
        .mockResolvedValue(state().context.nutrition),
    };
    const prisma = {
      user: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          name: 'Lucy Fit',
          fitnessProfile: null,
          coachProfile: state().coachProfile,
          goalClassification: state().goalClassification,
        }),
      },
      mealPattern: {
        findMany: jest.fn().mockResolvedValue(state().context.mealPatterns),
      },
      nutritionRecommendation: {
        findMany: jest.fn().mockResolvedValue(state().context.recommendations),
      },
    };
    const service = new CoachIntelligenceService(
      prisma as unknown as PrismaService,
      nutritionIntelligence as unknown as NutritionIntelligenceService,
      new UserGoalEngineService(),
      new CoachMetricsService(),
      {} as EventService,
      {
        refreshSignals: jest.fn(),
      } as unknown as BehavioralIntelligenceService,
      {
        refreshForUser: jest.fn(),
      } as unknown as RecommendationService,
      {
        getResponseContext: jest
          .fn()
          .mockResolvedValue(state().context.longitudinal),
      } as unknown as LongitudinalService,
      {} as CoachExperienceService,
      {
        refreshForUser: jest.fn().mockResolvedValue(adaptiveSignals()),
      } as unknown as AdaptiveIntelligenceService,
    );

    const context = await service.buildCoachContext('user-id');

    expect(
      nutritionIntelligence.buildUserNutritionContext,
    ).toHaveBeenCalledWith('user-id');
    expect(context.nutrition.memories).toHaveLength(1);
    expect(context.nutrition.preferences).not.toBeNull();
    expect(context.nutrition.activeInsights).toHaveLength(1);
    expect(context.nutrition.trends).toHaveLength(1);
    expect(context.mealPatterns).toHaveLength(1);
    expect(context.recommendations).toHaveLength(1);
    expect(context.longitudinal.coachAdaptation?.mode).toBe('TECHNICAL');
  });

  it('persists daily habits, scores and churn changes with observability', async () => {
    const at = new Date('2026-06-13T18:00:00.000Z');
    const transaction = {
      coachProfile: {
        upsert: jest.fn().mockResolvedValue(state().coachProfile),
      },
      userGoalClassification: {
        upsert: jest.fn().mockResolvedValue(state().goalClassification),
      },
      habitSnapshot: {
        upsert: jest.fn().mockResolvedValue(state().habit),
      },
      consistencyScore: {
        upsert: jest.fn().mockResolvedValue(state().consistency),
      },
      engagementScore: {
        upsert: jest.fn().mockResolvedValue(state().engagement),
      },
      churnRiskAssessment: {
        upsert: jest.fn().mockResolvedValue({
          ...state().churn,
          level: ChurnRiskLevel.LOW,
          previousLevel: ChurnRiskLevel.HIGH,
        }),
      },
      systemEvent: {
        create: jest.fn().mockResolvedValue({ id: 'event-id' }),
      },
    };
    const prisma = {
      $transaction: jest.fn(
        (callback: (client: typeof transaction) => unknown) =>
          callback(transaction),
      ),
      meal: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { createdAt: new Date('2026-06-11T12:00:00.000Z') },
            { createdAt: new Date('2026-06-12T12:00:00.000Z') },
            { createdAt: new Date('2026-06-13T12:00:00.000Z') },
          ]),
      },
      message: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { timestamp: new Date('2026-06-11T18:00:00.000Z') },
            { timestamp: new Date('2026-06-12T18:00:00.000Z') },
            { timestamp: new Date('2026-06-13T18:00:00.000Z') },
          ]),
      },
      churnRiskAssessment: {
        findFirst: jest.fn().mockResolvedValue({
          level: ChurnRiskLevel.HIGH,
        }),
      },
    };
    const service = new CoachIntelligenceService(
      prisma as unknown as PrismaService,
      {} as NutritionIntelligenceService,
      new UserGoalEngineService(),
      new CoachMetricsService(),
      new EventService({} as PrismaService),
      {
        refreshSignals: jest.fn(),
      } as unknown as BehavioralIntelligenceService,
      {
        refreshForUser: jest.fn(),
      } as unknown as RecommendationService,
      {
        getResponseContext: jest
          .fn()
          .mockResolvedValue(state().context.longitudinal),
      } as unknown as LongitudinalService,
      {} as CoachExperienceService,
      {
        refreshForUser: jest.fn().mockResolvedValue(adaptiveSignals()),
      } as unknown as AdaptiveIntelligenceService,
    );
    jest.spyOn(service, 'buildCoachContext').mockResolvedValue(state().context);

    await service.recalculateUser('user-id', at);

    expect(transaction.habitSnapshot.upsert).toHaveBeenCalled();
    expect(transaction.consistencyScore.upsert).toHaveBeenCalled();
    expect(transaction.engagementScore.upsert).toHaveBeenCalled();
    expect(transaction.churnRiskAssessment.upsert).toHaveBeenCalled();
    expect(transaction.systemEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventType: 'COACH_CONSISTENCY_RECALCULATED',
      }),
    });
    expect(transaction.systemEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventType: 'COACH_ENGAGEMENT_RECALCULATED',
      }),
    });
    expect(transaction.systemEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventType: 'COACH_CHURN_RISK_CHANGED',
      }),
    });
  });
});
