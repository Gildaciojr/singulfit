import { ConflictException } from '@nestjs/common';
import {
  MealAnalysisStatus,
  MealSource,
  OutboundMessageStatus,
  Prisma,
  ResponseType,
} from '@prisma/client';
import { EventBusService } from '../event-bus/event-bus.service';
import { PrismaService } from '../prisma/prisma.service';
import { NutritionResponseFormatter } from './nutrition-response.formatter';
import { ResponseBuilderService } from './response-builder.service';
import { NutritionIntelligenceService } from '../nutrition/nutrition-intelligence.service';
import { CoachIntelligenceService } from '../automation/coach-intelligence.service';
import { BehavioralIntelligenceService } from '../behavior/behavioral-intelligence.service';
import { AIResponseEvaluationService } from '../ai-quality/ai-response-evaluation.service';
import { AIResponseEvaluationType, AIResponseRiskLevel } from '@prisma/client';
import { RecommendationService } from '../recommendations/recommendation.service';
import { LongitudinalService } from '../longitudinal/longitudinal.service';

describe('ResponseBuilderService', () => {
  function createSubject() {
    const outbound = {
      id: 'outbound-id',
      userId: 'user-id',
      conversationId: 'conversation-id',
      sourceMessageId: 'message-id',
      mealAnalysisId: 'analysis-id',
      responseType: ResponseType.NUTRITION_ANALYSIS,
      status: OutboundMessageStatus.PENDING,
      content: 'Resposta nutricional',
    };
    const analysis = {
      id: 'analysis-id',
      status: MealAnalysisStatus.COMPLETED,
      totalCalories: new Prisma.Decimal('523'),
      totalProtein: new Prisma.Decimal('41'),
      totalCarbs: new Prisma.Decimal('52'),
      totalFat: new Prisma.Decimal('11'),
      items: [],
      qualityScore: {
        score: 75,
      },
      aiJob: {
        id: 'ai-job-id',
        promptVersionId: 'prompt-version-id',
        usage: [
          {
            estimatedCost: new Prisma.Decimal('0.0042'),
          },
        ],
      },
      meal: {
        userId: 'user-id',
        conversationId: 'conversation-id',
        messageId: 'message-id',
        source: MealSource.WHATSAPP,
      },
    };
    const transaction = {
      outboundMessage: {
        upsert: jest.fn().mockResolvedValue(outbound),
      },
      mealAnalysis: {
        findUnique: jest.fn().mockResolvedValue(analysis),
      },
      nutritionRecommendation: {
        findMany: jest.fn().mockResolvedValue([
          {
            title: 'Ajuste prático',
            rationale: 'Histórico recente',
            action: 'Inclua vegetais.',
          },
        ]),
      },
      meal: {
        findUnique: jest.fn().mockResolvedValue({
          userId: 'user-id',
          conversationId: 'conversation-id',
          messageId: 'message-id',
          source: MealSource.WHATSAPP,
        }),
      },
    };
    const prisma = {
      $transaction: jest.fn(
        (operation: (client: typeof transaction) => unknown) =>
          operation(transaction),
      ),
      mealAnalysis: {
        findUnique: jest.fn().mockResolvedValue({
          meal: {
            userId: 'user-id',
          },
        }),
      },
      outboundMessage: {
        findMany: jest.fn(),
      },
      conversation: {
        findUnique: jest.fn(),
      },
    };
    const formatter = {
      format: jest.fn().mockReturnValue('Resposta nutricional'),
    };
    const eventBus = {
      publish: jest.fn().mockResolvedValue({ id: 'outbox-id' }),
    };
    const intelligenceService = {
      buildUserNutritionContext: jest.fn().mockResolvedValue({
        userId: 'user-id',
        goal: null,
        memories: [],
        activeInsights: [],
        trends: [],
        recentMeals: [],
      }),
    };
    const coachIntelligence = {
      getResponseSignals: jest.fn().mockResolvedValue({
        goal: 'HYPERTROPHY',
        communicationStyle: 'FRIENDLY',
        coachingStyle: 'MOTIVATIONAL',
        tone: 'MODERATE',
        motivationStyle: 'ACHIEVEMENT',
        consistencyScore: 72,
        engagementScore: 68,
        churnRisk: 'LOW',
        activeDays: 8,
        consecutiveDays: 3,
        motivation: 'Continue avançando.',
        experience: {
          communication: {
            dominantStyle: 'BALANCED',
            confidence: 0.8,
            scores: {},
          },
          motivation: {
            dominantTrigger: 'HEALTH',
            confidence: 0.8,
            scores: {},
          },
          fatigue: {
            score: 20,
            recommendedFrequencyHours: 24,
            repeatedThemeScore: 0,
            repeatedPhraseScore: 0,
            interactionResponseScore: 80,
          },
          reengagement: null,
          momentum: { score: 70 },
          retention: { score: 72 },
          whatsapp: {
            idealMessageLength: 500,
            idealEmojiCount: 0,
            idealFrequencyHours: 24,
            preferredHourUtc: 9,
          },
          canSendCoachMessage: true,
          nextCoachMessageAt: null,
        },
        adaptive: {
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
          foodQuality: null,
          dietaryPatterns: [],
          learning: {
            acceptedCount: 1,
            ignoredCount: 0,
            rejectedCount: 0,
            shortChallengeScore: 70,
            preferredTopics: ['protein'],
            ignoredTopics: [],
            topicScores: { protein: 80 },
            confidence: 0.8,
          },
          communication: {
            profile: 'TECHNICAL',
            confidence: 0.85,
            idealLength: 900,
            structurePreference: 'DATA_ACTION',
          },
          earlyChurn: { score: 20, level: 'LOW', reasons: [] },
          recommendationRanking: [
            {
              recommendationId: 'proactive-id',
              rank: 1,
              adaptiveScore: 90,
            },
          ],
          evolution: [],
          coachMemory: [],
        },
      }),
    };
    const behavioralIntelligence = {
      refreshSignals: jest.fn().mockResolvedValue({
        communicationStyle: 'FRIENDLY',
        motivationStyle: 'HEALTH',
        adherenceStyle: 'FLEXIBLE',
        personalityPattern: 'BALANCED',
        motivationLine: 'Priorize energia e saúde no dia a dia.',
        stage: 'ACTION',
        adherenceScore: 74,
        engagementScore: 68,
        preferredEngagementHour: 9,
        confidenceScore: 0.84,
        motivations: [{ type: 'HEALTH', weight: 60 }],
        triggers: [{ type: 'HEALTH', weight: 70 }],
        insights: [],
        useShortMessages: false,
      }),
    };
    const responseEvaluation = {
      evaluate: jest.fn().mockImplementation((content: string) => ({
        originalContent: content,
        finalContent: content,
        evaluationType: AIResponseEvaluationType.NUTRITION_RESPONSE,
        quality: {
          qualityScore: 84,
          personalizationScore: 80,
          usefulnessScore: 90,
          clarityScore: 82,
          flags: [],
        },
        safety: {
          safetyScore: 100,
          riskLevel: AIResponseRiskLevel.LOW,
          flags: [],
          criticalFlags: [],
        },
        flags: [],
        blocked: false,
        fallbackUsed: false,
      })),
      persistInTransaction: jest
        .fn()
        .mockResolvedValue({ id: 'evaluation-id' }),
    };
    const recommendationService = {
      refreshForUser: jest.fn().mockResolvedValue([
        {
          id: 'proactive-id',
          title: 'Aumente a presença de proteína',
          description: 'Inclua uma fonte de proteína na próxima refeição.',
          reason: 'Proteína baixa recorrente.',
        },
      ]),
    };
    const longitudinal = {
      getResponseContext: jest.fn().mockResolvedValue({
        profile: {
          historySize: 8,
          adherenceScore: 74,
          consistencyScore: 72,
        },
        preferences: [],
        evolution: null,
        relapse: null,
        goalProgression: null,
        coachAdaptation: null,
        memories: [],
        monthlyReview: null,
      }),
    };
    const service = new ResponseBuilderService(
      prisma as unknown as PrismaService,
      formatter as unknown as NutritionResponseFormatter,
      eventBus as unknown as EventBusService,
      intelligenceService as unknown as NutritionIntelligenceService,
      coachIntelligence as unknown as CoachIntelligenceService,
      behavioralIntelligence as unknown as BehavioralIntelligenceService,
      responseEvaluation as unknown as AIResponseEvaluationService,
      recommendationService as unknown as RecommendationService,
      longitudinal as unknown as LongitudinalService,
    );

    return {
      service,
      prisma,
      transaction,
      formatter,
      eventBus,
      intelligenceService,
      coachIntelligence,
      behavioralIntelligence,
      responseEvaluation,
      recommendationService,
      longitudinal,
      outbound,
      analysis,
    };
  }

  it('creates the outbound response and event atomically', async () => {
    const subject = createSubject();

    await expect(
      subject.service.buildNutritionResponse('analysis-id'),
    ).resolves.toBe(subject.outbound);
    expect(subject.transaction.outboundMessage.upsert).toHaveBeenCalledWith({
      where: {
        mealAnalysisId: 'analysis-id',
      },
      update: {
        content: 'Resposta nutricional',
      },
      create: {
        userId: 'user-id',
        conversationId: 'conversation-id',
        sourceMessageId: 'message-id',
        mealAnalysisId: 'analysis-id',
        responseType: ResponseType.NUTRITION_ANALYSIS,
        content: 'Resposta nutricional',
      },
    });
    expect(subject.eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'OUTBOUND_MESSAGE_REQUESTED',
        aggregateId: 'outbound-id',
      }),
      subject.transaction,
    );
    expect(
      subject.responseEvaluation.persistInTransaction,
    ).toHaveBeenCalledWith(
      subject.transaction,
      expect.objectContaining({
        userId: 'user-id',
        aiJobId: 'ai-job-id',
        messageId: 'message-id',
        responseId: 'outbound-id',
        promptVersionId: 'prompt-version-id',
        estimatedCost: new Prisma.Decimal('0.0042'),
      }),
    );
    expect(
      subject.intelligenceService.buildUserNutritionContext,
    ).toHaveBeenCalledWith('user-id');
    expect(subject.formatter.format).toHaveBeenCalledWith(
      subject.analysis,
      expect.objectContaining({
        context: expect.objectContaining({
          userId: 'user-id',
        }),
        recommendations: expect.any(Array),
        coach: expect.objectContaining({
          consistencyScore: 72,
        }),
        behavior: expect.objectContaining({
          stage: 'ACTION',
          adherenceScore: 74,
        }),
        longitudinal: expect.objectContaining({
          profile: expect.objectContaining({ historySize: 8 }),
        }),
      }),
    );
    expect(subject.recommendationService.refreshForUser).toHaveBeenCalledWith(
      'user-id',
    );
    expect(subject.formatter.format).toHaveBeenCalledWith(
      subject.analysis,
      expect.objectContaining({
        recommendations: expect.arrayContaining([
          expect.objectContaining({
            title: 'Aumente a presença de proteína',
            action: 'Inclua uma fonte de proteína na próxima refeição.',
          }),
        ]),
      }),
    );
  });

  it('replaces a risky response with the safe fallback before publishing', async () => {
    const subject = createSubject();
    subject.responseEvaluation.evaluate.mockReturnValue({
      originalContent: 'Tome este medicamento para curar diabetes.',
      finalContent: 'Fallback seguro',
      evaluationType: AIResponseEvaluationType.NUTRITION_RESPONSE,
      quality: {
        qualityScore: 20,
        personalizationScore: 20,
        usefulnessScore: 20,
        clarityScore: 40,
        flags: [],
      },
      safety: {
        safetyScore: 0,
        riskLevel: AIResponseRiskLevel.BLOCKED,
        flags: ['MEDICAL_PRESCRIPTION'],
        criticalFlags: ['MEDICAL_PRESCRIPTION'],
      },
      flags: ['MEDICAL_PRESCRIPTION'],
      blocked: true,
      fallbackUsed: true,
    });

    await subject.service.buildNutritionResponse('analysis-id');

    expect(subject.transaction.outboundMessage.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: {
          content: 'Fallback seguro',
        },
        create: expect.objectContaining({
          content: 'Fallback seguro',
        }),
      }),
    );
    expect(
      subject.responseEvaluation.persistInTransaction.mock
        .invocationCallOrder[0],
    ).toBeLessThan(subject.eventBus.publish.mock.invocationCallOrder[0]);
  });

  it('uses an upsert when the analysis is reprocessed', async () => {
    const subject = createSubject();

    await subject.service.buildNutritionResponse('analysis-id');
    await subject.service.buildNutritionResponse('analysis-id');

    expect(subject.transaction.outboundMessage.upsert).toHaveBeenCalledTimes(2);
    expect(subject.eventBus.publish).toHaveBeenCalledTimes(2);
  });

  it('rejects an analysis that is not completed', async () => {
    const subject = createSubject();
    subject.transaction.mealAnalysis.findUnique.mockResolvedValue({
      ...subject.analysis,
      status: MealAnalysisStatus.PROCESSING,
    });

    await expect(
      subject.service.buildNutritionResponse('analysis-id'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(subject.transaction.outboundMessage.upsert).not.toHaveBeenCalled();
  });

  it('creates an idempotent usage limit response and outbound event', async () => {
    const subject = createSubject();
    const limitOutbound = {
      ...subject.outbound,
      mealAnalysisId: null,
      responseType: ResponseType.USAGE_LIMIT,
      content: 'Limite atingido',
    };
    subject.transaction.outboundMessage.upsert.mockResolvedValue(limitOutbound);

    await expect(
      subject.service.buildUsageLimitResponse('meal-id', 'Limite atingido'),
    ).resolves.toBe(limitOutbound);
    expect(subject.transaction.outboundMessage.upsert).toHaveBeenCalledWith({
      where: {
        sourceMessageId_responseType: {
          sourceMessageId: 'message-id',
          responseType: ResponseType.USAGE_LIMIT,
        },
      },
      update: {},
      create: {
        userId: 'user-id',
        conversationId: 'conversation-id',
        sourceMessageId: 'message-id',
        responseType: ResponseType.USAGE_LIMIT,
        content: 'Limite atingido',
      },
    });
  });
});
