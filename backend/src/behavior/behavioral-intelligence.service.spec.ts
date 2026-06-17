import { BehavioralInsightStatus, Prisma, StageOfChange } from '@prisma/client';
import { EventService } from '../observability/event.service';
import { PrismaService } from '../prisma/prisma.service';
import { BehavioralEngineService } from './behavioral-engine.service';
import { BehavioralIntelligenceService } from './behavioral-intelligence.service';

describe('BehavioralIntelligenceService', () => {
  function createSubject() {
    const at = new Date('2026-06-13T12:00:00.000Z');
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([{ locked: true }]),
      behavioralProfile: {
        upsert: jest.fn().mockResolvedValue({
          id: 'profile-id',
          userId: 'user-id',
        }),
      },
      behavioralMotivation: {
        upsert: jest.fn().mockResolvedValue({ id: 'motivation-id' }),
      },
      stageOfChangeHistory: {
        upsert: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            id: 'stage-id',
            ...data,
          }),
        ),
      },
      adherencePrediction: {
        upsert: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            id: 'adherence-id',
            ...data,
          }),
        ),
      },
      motivationTrigger: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        upsert: jest.fn().mockResolvedValue({ id: 'trigger-id' }),
      },
      behavioralInsight: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        upsert: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            id: 'insight-id',
            ...data,
          }),
        ),
      },
      behavioralSnapshot: {
        upsert: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            id: 'snapshot-id',
            ...data,
          }),
        ),
      },
    };
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'user-id',
          fitnessProfile: {
            goal: 'MUSCLE_GAIN',
          },
          nutritionProfile: null,
          behavioralProfile: null,
        }),
      },
      message: {
        findMany: jest.fn().mockResolvedValue([
          {
            content: 'Quero meu score de performance',
            timestamp: new Date('2026-06-10T08:00:00.000Z'),
          },
          {
            content: 'Mostre os dados do treino',
            timestamp: new Date('2026-06-11T08:10:00.000Z'),
          },
          {
            content: 'Como está minha média?',
            timestamp: new Date('2026-06-12T08:20:00.000Z'),
          },
        ]),
      },
      conversationMemory: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ summary: 'Objetivo de hipertrofia' }]),
      },
      habitSnapshot: {
        findFirst: jest.fn().mockResolvedValue({
          activeDays: 12,
          consecutiveDays: 6,
          mealFrequency: new Prisma.Decimal('5.5'),
          regularityScore: 78,
        }),
      },
      consistencyScore: {
        findFirst: jest.fn().mockResolvedValue({ score: 76 }),
      },
      engagementScore: {
        findFirst: jest.fn().mockResolvedValue({
          score: 72,
          analysesLast30Days: 9,
        }),
      },
      userContextSnapshot: {
        findFirst: jest.fn().mockResolvedValue({
          goal: 'MUSCLE_GAIN',
          adherenceScore: 75,
          nutritionAnalysesCount: 9,
        }),
      },
      nutritionTrend: {
        findFirst: jest.fn().mockResolvedValue({
          goalAdherenceScore: 77,
          direction: 'IMPROVING',
        }),
      },
      coachMessage: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      outboundMessage: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      progressSnapshot: {
        count: jest.fn().mockResolvedValue(2),
      },
      stageOfChangeHistory: {
        findFirst: jest.fn().mockResolvedValue({
          stage: StageOfChange.PREPARATION,
        }),
      },
      behavioralInsight: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest.fn(
        (callback: (client: typeof transaction) => unknown) =>
          callback(transaction),
      ),
    };
    const events = {
      recordInTransaction: jest.fn().mockResolvedValue({
        id: 'event-id',
      }),
    };
    const service = new BehavioralIntelligenceService(
      prisma as unknown as PrismaService,
      new BehavioralEngineService(),
      events as unknown as EventService,
    );

    return { service, prisma, transaction, events, at };
  }

  it('persists profile, weighted motivations, stage, adherence and daily snapshot', async () => {
    const subject = createSubject();

    const result = await subject.service.recalculateUser('user-id', subject.at);

    expect(subject.transaction.behavioralProfile.upsert).toHaveBeenCalled();
    expect(
      subject.transaction.behavioralMotivation.upsert,
    ).toHaveBeenCalledTimes(5);
    expect(subject.transaction.stageOfChangeHistory.upsert).toHaveBeenCalled();
    expect(subject.transaction.adherencePrediction.upsert).toHaveBeenCalled();
    expect(subject.transaction.behavioralSnapshot.upsert).toHaveBeenCalled();
    expect(result.evaluation.adherence.score).toBeGreaterThan(0);
  });

  it('records profile, adherence, stage and insight observability events', async () => {
    const subject = createSubject();

    await subject.service.recalculateUser('user-id', subject.at);

    for (const eventType of [
      'BEHAVIORAL_PROFILE_GENERATED',
      'BEHAVIORAL_ADHERENCE_RECALCULATED',
      'BEHAVIORAL_STAGE_CHANGED',
      'BEHAVIORAL_INSIGHT_CREATED',
    ]) {
      expect(subject.events.recordInTransaction).toHaveBeenCalledWith(
        subject.transaction,
        expect.objectContaining({
          eventType,
        }),
      );
    }
  });

  it('reactivates a previously resolved insight with a creation event', async () => {
    const subject = createSubject();
    subject.prisma.behavioralInsight.findMany.mockResolvedValue([
      {
        id: 'existing-insight',
        type: 'SHORT_MESSAGES',
        status: BehavioralInsightStatus.RESOLVED,
      },
    ]);

    await subject.service.recalculateUser('user-id', subject.at);

    expect(subject.events.recordInTransaction).toHaveBeenCalledWith(
      subject.transaction,
      expect.objectContaining({
        eventType: 'BEHAVIORAL_INSIGHT_CREATED',
      }),
    );
  });
});
