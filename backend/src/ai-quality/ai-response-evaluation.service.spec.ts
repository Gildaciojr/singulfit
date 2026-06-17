import {
  AIResponseEvaluationType,
  AIResponseRiskLevel,
  Prisma,
} from '@prisma/client';
import { EventService } from '../observability/event.service';
import { AIQualityScoringService } from './ai-quality-scoring.service';
import { AIResponseEvaluationService } from './ai-response-evaluation.service';
import { AISafetyClassifierService } from './ai-safety-classifier.service';
import { SafeResponseFallbackService } from './safe-response-fallback.service';

describe('AIResponseEvaluationService', () => {
  function createSubject() {
    const events = {
      recordInTransaction: jest.fn().mockResolvedValue({ id: 'event-id' }),
    };
    const service = new AIResponseEvaluationService(
      new AISafetyClassifierService(),
      new AIQualityScoringService(),
      new SafeResponseFallbackService(),
      events as unknown as EventService,
    );

    return { service, events };
  }

  it('uses the safe fallback for a blocked response', () => {
    const { service } = createSubject();
    const decision = service.evaluate(
      'Você tem diabetes e deve tomar 20 mg deste medicamento.',
      AIResponseEvaluationType.NUTRITION_RESPONSE,
      {
        goal: 'WEIGHT_LOSS',
        memoryCount: 1,
        recentMealCount: 3,
        insightCount: 1,
        recommendationCount: 1,
        behaviorStage: 'ACTION',
        adherenceScore: 70,
      },
    );

    expect(decision.safety.riskLevel).toBe(AIResponseRiskLevel.BLOCKED);
    expect(decision.blocked).toBe(true);
    expect(decision.fallbackUsed).toBe(true);
    expect(decision.finalContent).not.toContain('20 mg');
    expect(decision.finalContent).toContain('acompanhamento profissional');
  });

  it('persists evaluation, review queue, snapshots and observability atomically', async () => {
    const { service, events } = createSubject();
    const decision = service.evaluate(
      'Faça jejum por 72 horas para perder 4 kg em uma semana.',
      AIResponseEvaluationType.NUTRITION_RESPONSE,
      {
        goal: 'WEIGHT_LOSS',
        memoryCount: 0,
        recentMealCount: 1,
        insightCount: 0,
        recommendationCount: 0,
        behaviorStage: 'PREPARATION',
        adherenceScore: 45,
      },
    );
    const evaluation = {
      id: 'evaluation-id',
      userId: 'user-id',
      evaluatedAt: new Date('2026-06-13T12:00:00.000Z'),
      riskLevel: decision.safety.riskLevel,
      qualityScore: decision.quality.qualityScore,
      safetyScore: decision.safety.safetyScore,
      fallbackUsed: true,
    };
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([{ locked: true }]),
      aIResponseEvaluation: {
        upsert: jest.fn().mockResolvedValue(evaluation),
        findMany: jest
          .fn()
          .mockResolvedValueOnce([
            {
              qualityScore: decision.quality.qualityScore,
              safetyScore: decision.safety.safetyScore,
              personalizationScore: decision.quality.personalizationScore,
              usefulnessScore: decision.quality.usefulnessScore,
              clarityScore: decision.quality.clarityScore,
              riskLevel: decision.safety.riskLevel,
              flags: decision.flags,
              fallbackUsed: true,
            },
          ])
          .mockResolvedValueOnce([
            {
              qualityScore: decision.quality.qualityScore,
              safetyScore: decision.safety.safetyScore,
              estimatedCost: new Prisma.Decimal('0.005'),
              riskLevel: decision.safety.riskLevel,
              flags: decision.flags,
              fallbackUsed: true,
            },
          ]),
      },
      aIReviewQueue: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: 'review-id',
        }),
      },
      aIQualityDailySnapshot: {
        upsert: jest.fn().mockResolvedValue({
          id: 'daily-snapshot-id',
        }),
      },
      promptQualitySnapshot: {
        upsert: jest.fn().mockResolvedValue({
          id: 'prompt-snapshot-id',
        }),
      },
    };

    await service.persistInTransaction(transaction as never, {
      userId: 'user-id',
      aiJobId: 'job-id',
      messageId: 'message-id',
      responseId: 'response-id',
      promptVersionId: 'prompt-version-id',
      estimatedCost: new Prisma.Decimal('0.005'),
      evaluatedAt: new Date('2026-06-13T12:00:00.000Z'),
      decision,
    });

    expect(transaction.aIResponseEvaluation.upsert).toHaveBeenCalled();
    expect(transaction.aIReviewQueue.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-id',
        aiResponseEvaluationId: 'evaluation-id',
      }),
    });
    expect(transaction.aIQualityDailySnapshot.upsert).toHaveBeenCalled();
    expect(transaction.promptQualitySnapshot.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          promptVersionId: 'prompt-version-id',
          evaluationCount: 1,
          fallbackCount: 1,
        }),
      }),
    );
    for (const eventType of [
      'AI_RESPONSE_EVALUATED',
      'AI_RESPONSE_BLOCKED',
      'AI_RESPONSE_FALLBACK_USED',
      'AI_REVIEW_QUEUE_CREATED',
      'PROMPT_QUALITY_RECALCULATED',
    ]) {
      expect(events.recordInTransaction).toHaveBeenCalledWith(
        transaction,
        expect.objectContaining({
          eventType,
        }),
      );
    }
  });

  it('does not create a review queue for a safe response', async () => {
    const { service } = createSubject();
    const decision = service.evaluate(
      'Recomendação prática: inclua vegetais e água na próxima refeição.',
      AIResponseEvaluationType.NUTRITION_RESPONSE,
      {
        goal: null,
        memoryCount: 0,
        recentMealCount: 0,
        insightCount: 0,
        recommendationCount: 1,
        behaviorStage: null,
        adherenceScore: null,
      },
    );
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([{ locked: true }]),
      aIResponseEvaluation: {
        upsert: jest.fn().mockResolvedValue({
          id: 'evaluation-id',
          userId: 'user-id',
          evaluatedAt: new Date('2026-06-13T12:00:00.000Z'),
          riskLevel: AIResponseRiskLevel.LOW,
          qualityScore: decision.quality.qualityScore,
          safetyScore: 100,
          fallbackUsed: false,
        }),
        findMany: jest.fn().mockResolvedValue([
          {
            qualityScore: decision.quality.qualityScore,
            safetyScore: 100,
            personalizationScore: decision.quality.personalizationScore,
            usefulnessScore: decision.quality.usefulnessScore,
            clarityScore: decision.quality.clarityScore,
            riskLevel: AIResponseRiskLevel.LOW,
            flags: decision.flags,
            fallbackUsed: false,
          },
        ]),
      },
      aIReviewQueue: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
      aIQualityDailySnapshot: {
        upsert: jest.fn().mockResolvedValue({}),
      },
      promptQualitySnapshot: {
        upsert: jest.fn(),
      },
    };

    await service.persistInTransaction(transaction as never, {
      userId: 'user-id',
      aiJobId: null,
      messageId: 'message-id',
      responseId: 'response-id',
      promptVersionId: null,
      estimatedCost: new Prisma.Decimal(0),
      decision,
    });

    expect(transaction.aIReviewQueue.create).not.toHaveBeenCalled();
    expect(transaction.promptQualitySnapshot.upsert).not.toHaveBeenCalled();
  });
});
