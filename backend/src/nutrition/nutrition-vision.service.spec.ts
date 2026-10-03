import { BadGatewayException } from '@nestjs/common';
import {
  AIJobStatus,
  AIJobType,
  MealAnalysisStatus,
  MealCategory,
  Prisma,
} from '@prisma/client';
import { AIService } from '../ai/ai.service';
import { UsageLimitExceededException } from '../entitlements/usage-limit.exception';
import { PrismaService } from '../prisma/prisma.service';
import { MediaService } from '../storage/media.service';
import { NutritionVisionService } from './nutrition-vision.service';
import { NutritionService } from './nutrition.service';
import { AuditService } from '../observability/audit.service';
import { EventBusService } from '../event-bus/event-bus.service';
import { EventService } from '../observability/event.service';
import { NutritionIntelligenceService } from './nutrition-intelligence.service';

describe('NutritionVisionService', () => {
  function createSubject(outputText: string) {
    const meal = {
      id: 'meal-id',
      userId: 'user-id',
      conversationId: 'conversation-id',
      messageId: 'message-id',
      mediaFileId: 'media-id',
      analysis: {
        id: 'analysis-id',
        status: MealAnalysisStatus.PENDING,
      },
    };
    const completedMeal = {
      ...meal,
      analysis: {
        ...meal.analysis,
        status: MealAnalysisStatus.COMPLETED,
      },
    };
    const transaction = {
      mealAnalysis: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'analysis-id', mealId: 'meal-id', meal }),
        updateMany: jest.fn().mockResolvedValue({
          count: 1,
        }),
        update: jest.fn().mockResolvedValue({
          id: 'analysis-id',
        }),
      },
      aIJob: {
        updateMany: jest.fn().mockResolvedValue({
          count: 1,
        }),
        update: jest.fn().mockResolvedValue({
          id: 'job-id',
        }),
      },
      mealItem: {
        createMany: jest.fn().mockResolvedValue({
          count: 1,
        }),
      },
      meal: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(completedMeal),
      },
    };
    const prisma = {
      message: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'message-id',
          conversationId: 'conversation-id',
          conversation: { id: 'conversation-id', userId: 'user-id' },
        }),
      },
      mediaFile: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'media-id',
          userId: 'user-id',
          conversationId: 'conversation-id',
          messageId: 'message-id',
        }),
      },
      mealAnalysis: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'analysis-id', mealId: 'meal-id', meal }),
      },
      $transaction: jest.fn(
        async (callback: (client: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
    };
    const nutritionService = {
      getMeal: jest.fn().mockResolvedValue(meal),
    };
    const aiService = {
      createJob: jest.fn().mockResolvedValue({
        id: 'job-id',
        status: AIJobStatus.PENDING,
        userId: 'user-id',
        conversationId: 'conversation-id',
        messageId: 'message-id',
        promptVersion: {
          prompt: 'Prompt nutricional',
        },
      }),
      runVisionJob: jest.fn().mockResolvedValue({
        responseId: 'response-id',
        model: 'vision-model',
        outputText,
        promptTokens: 250,
        completionTokens: 50,
        totalTokens: 300,
      }),
      completeJobInTransaction: jest.fn().mockResolvedValue({
        id: 'usage-id',
      }),
      failJob: jest.fn().mockResolvedValue(undefined),
    };
    const mediaService = {
      getImageDataUrl: jest.fn().mockResolvedValue({
        dataUrl: 'data:image/jpeg;base64,aW1hZ2U=',
      }),
    };
    const auditService = {
      recordInTransaction: jest.fn().mockResolvedValue({
        id: 'audit-id',
      }),
    };
    const eventBus = {
      publish: jest.fn().mockResolvedValue({
        id: 'outbox-id',
      }),
    };
    const eventService = {
      recordInTransaction: jest.fn().mockResolvedValue({
        id: 'event-id',
      }),
    };
    const intelligenceService = {
      buildUserNutritionContext: jest.fn().mockResolvedValue({
        userId: 'user-id',
        goal: 'WEIGHT_LOSS',
        activityLevel: 'MODERATE',
        restrictions: [],
        allergies: [],
        preferences: null,
        latestSnapshot: null,
        memories: [{ summary: 'Histórico persistido', content: {} }],
        statistics: {
          nutritionAnalysesCount: 2,
          adherenceScore: 80,
          messagesLast7Days: 3,
          messagesLast30Days: 10,
        },
        recentMeals: [],
        activeInsights: [],
        trends: [],
      }),
      processCompletedAnalysis: jest.fn().mockResolvedValue({
        score: {
          score: 75,
        },
      }),
    };
    const service = new NutritionVisionService(
      prisma as unknown as PrismaService,
      nutritionService as unknown as NutritionService,
      aiService as unknown as AIService,
      mediaService as unknown as MediaService,
      auditService as unknown as AuditService,
      eventService as unknown as EventService,
      eventBus as unknown as EventBusService,
      intelligenceService as unknown as NutritionIntelligenceService,
    );

    return {
      service,
      prisma,
      transaction,
      nutritionService,
      aiService,
      mediaService,
      auditService,
      eventService,
      eventBus,
      intelligenceService,
      completedMeal,
    };
  }

  it.each(['meal', 'message', 'media', 'analysis', 'context'] as const)(
    'rejects foreign %s before quota and provider',
    async (source) => {
      const s = createSubject('{}');
      if (source === 'meal')
        s.nutritionService.getMeal.mockResolvedValue({
          ...s.completedMeal,
          userId: 'foreign',
        });
      if (source === 'message')
        s.prisma.message.findUnique.mockResolvedValue({
          id: 'message-id',
          conversationId: 'conversation-id',
          conversation: { id: 'conversation-id', userId: 'foreign' },
        });
      if (source === 'media')
        s.prisma.mediaFile.findUnique.mockResolvedValue({
          id: 'media-id',
          userId: 'foreign',
          conversationId: 'conversation-id',
          messageId: 'message-id',
        });
      if (source === 'analysis')
        s.prisma.mealAnalysis.findUnique.mockResolvedValue({
          id: 'analysis-id',
          mealId: 'meal-id',
          meal: { ...s.completedMeal, userId: 'foreign' },
        });
      if (source === 'context')
        s.intelligenceService.buildUserNutritionContext.mockResolvedValue({
          userId: 'foreign',
        });
      await expect(s.service.analyzeMeal('meal-id', 'user-id')).rejects.toThrow(
        /ownership mismatch/,
      );
      expect(s.aiService.createJob).not.toHaveBeenCalled();
      expect(s.aiService.runVisionJob).not.toHaveBeenCalled();
      expect(s.transaction.mealAnalysis.update).not.toHaveBeenCalled();
      expect(s.eventBus.publish).not.toHaveBeenCalled();
    },
  );

  it('reverses the owned reservation on a mismatched job before provider', async () => {
    const s = createSubject('{}');
    s.aiService.createJob.mockResolvedValue({
      id: 'job-id',
      userId: 'user-id',
      conversationId: 'foreign',
      messageId: 'message-id',
    });
    await expect(s.service.analyzeMeal('meal-id', 'user-id')).rejects.toThrow(
      /ownership mismatch/,
    );
    expect(s.aiService.runVisionJob).not.toHaveBeenCalled();
    expect(s.aiService.failJob).toHaveBeenCalledWith(
      'job-id',
      expect.any(Error),
      undefined,
      'user-id',
    );
  });

  it('rejects late foreign analysis before item persistence and reverses the canonical reservation', async () => {
    const s = createSubject(
      JSON.stringify({
        foods: [],
        totalCalories: 0,
        protein: 0,
        carbs: 0,
        fat: 0,
        fiber: 0,
        sugar: 0,
        ultraProcessedRatio: 0,
        vegetableGrams: 0,
        hydrationMl: 0,
        mealCategory: 'LUNCH',
        confidence: 0.9,
      }),
    );
    s.transaction.mealAnalysis.findUnique.mockResolvedValue({
      id: 'analysis-id',
      mealId: 'meal-id',
      meal: { ...s.completedMeal, userId: 'foreign' },
    });
    await expect(s.service.analyzeMeal('meal-id', 'user-id')).rejects.toThrow(
      /ownership mismatch/,
    );
    expect(s.transaction.mealAnalysis.update).not.toHaveBeenCalled();
    expect(s.transaction.mealItem.createMany).not.toHaveBeenCalled();
    expect(s.aiService.completeJobInTransaction).not.toHaveBeenCalled();
    expect(s.aiService.failJob).toHaveBeenCalledWith(
      'job-id',
      expect.any(Error),
      expect.objectContaining({ model: 'vision-model' }),
      'user-id',
    );
    expect(s.eventBus.publish).not.toHaveBeenCalled();
  });

  it('preserves canonical reversal when the processing claim loses its fence', async () => {
    const s = createSubject('{}');
    s.transaction.mealAnalysis.updateMany.mockResolvedValue({ count: 0 });
    await expect(s.service.analyzeMeal('meal-id', 'user-id')).rejects.toThrow();
    expect(s.aiService.runVisionJob).not.toHaveBeenCalled();
    expect(s.aiService.failJob).toHaveBeenCalledWith(
      'job-id',
      expect.any(Error),
      undefined,
      'user-id',
    );
  });

  it('persists meal items, totals, AI job completion and usage atomically', async () => {
    const subject = createSubject(
      JSON.stringify({
        foods: [
          {
            foodName: 'Arroz branco',
            estimatedGrams: 120,
            calories: 156,
            protein: 3.2,
            carbs: 33.6,
            fat: 0.4,
            fiber: 1.2,
            sugar: 0.2,
            isUltraProcessed: false,
            isVegetable: false,
          },
        ],
        totalCalories: 156,
        protein: 3.2,
        carbs: 33.6,
        fat: 0.4,
        fiber: 1.2,
        sugar: 0.2,
        ultraProcessedRatio: 0,
        vegetableGrams: 0,
        hydrationMl: 0,
        mealCategory: MealCategory.LUNCH,
        confidence: 0.86,
      }),
    );

    await expect(subject.service.analyzeMeal('meal-id')).resolves.toBe(
      subject.completedMeal,
    );
    expect(subject.aiService.createJob).toHaveBeenCalledWith({
      userId: 'user-id',
      conversationId: 'conversation-id',
      messageId: 'message-id',
      type: AIJobType.IMAGE,
      promptName: 'nutrition_vision_brazilian_meal',
    });
    expect(subject.transaction.mealItem.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          mealAnalysisId: 'analysis-id',
          foodName: 'Arroz branco',
          estimatedGrams: expect.any(Prisma.Decimal),
          calories: expect.any(Prisma.Decimal),
          fiber: expect.any(Prisma.Decimal),
          isUltraProcessed: false,
        }),
      ],
    });
    expect(subject.transaction.mealAnalysis.update).toHaveBeenCalledWith({
      where: {
        id: 'analysis-id',
      },
      data: expect.objectContaining({
        status: MealAnalysisStatus.COMPLETED,
        confidence: expect.any(Prisma.Decimal),
        totalCalories: expect.any(Prisma.Decimal),
        totalFiber: expect.any(Prisma.Decimal),
        mealCategory: MealCategory.LUNCH,
        rawResponse: expect.objectContaining({
          foods: expect.any(Array),
        }),
      }),
    });
    expect(subject.aiService.completeJobInTransaction).toHaveBeenCalledWith(
      subject.transaction,
      {
        userId: 'user-id',
        aiJobId: 'job-id',
        jobType: AIJobType.IMAGE,
        response: expect.objectContaining({
          model: 'vision-model',
          totalTokens: 300,
        }),
      },
    );
    expect(subject.auditService.recordInTransaction).toHaveBeenCalledWith(
      subject.transaction,
      expect.objectContaining({
        userId: 'user-id',
        entityId: 'analysis-id',
      }),
    );
    expect(
      subject.intelligenceService.buildUserNutritionContext,
    ).toHaveBeenCalledWith('user-id');
    expect(
      subject.intelligenceService.processCompletedAnalysis,
    ).toHaveBeenCalledWith(
      subject.transaction,
      'user-id',
      'analysis-id',
      expect.objectContaining({
        memories: expect.any(Array),
      }),
    );
    expect(subject.aiService.runVisionJob).toHaveBeenCalledWith(
      'job-id',
      expect.objectContaining({
        input: expect.stringContaining('Histórico persistido'),
      }),
    );
  });

  it('marks the analysis and job as failed when OpenAI returns invalid JSON', async () => {
    const subject = createSubject('not-json');

    await expect(subject.service.analyzeMeal('meal-id')).rejects.toBeInstanceOf(
      BadGatewayException,
    );
    expect(subject.transaction.mealAnalysis.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'analysis-id',
        status: MealAnalysisStatus.PROCESSING,
        meal: { userId: 'user-id' },
      },
      data: expect.objectContaining({
        status: MealAnalysisStatus.FAILED,
        rawResponse: {
          invalidOutput: 'not-json',
        },
      }),
    });
    expect(subject.aiService.failJob).toHaveBeenCalledWith(
      'job-id',
      expect.any(BadGatewayException),
      expect.objectContaining({
        responseId: 'response-id',
      }),
      'user-id',
    );
    expect(subject.eventService.recordInTransaction).toHaveBeenCalledWith(
      subject.transaction,
      expect.objectContaining({
        eventType: 'NUTRITION_ANALYSIS_FAILED',
      }),
    );
  });

  it('returns an already completed analysis without calling OpenAI again', async () => {
    const subject = createSubject('{}');
    subject.nutritionService.getMeal.mockResolvedValue({
      ...subject.completedMeal,
      analysis: {
        id: 'analysis-id',
        status: MealAnalysisStatus.COMPLETED,
      },
    });

    await subject.service.analyzeMeal('meal-id');

    expect(subject.aiService.createJob).not.toHaveBeenCalled();
    expect(subject.aiService.runVisionJob).not.toHaveBeenCalled();
  });

  it('does not call OpenAI when image quota reservation is rejected', async () => {
    const subject = createSubject('{}');
    subject.aiService.createJob.mockRejectedValue(
      new UsageLimitExceededException('IMAGE_ANALYSIS', 5),
    );

    await expect(subject.service.analyzeMeal('meal-id')).rejects.toBeInstanceOf(
      UsageLimitExceededException,
    );
    expect(subject.aiService.runVisionJob).not.toHaveBeenCalled();
  });
});
