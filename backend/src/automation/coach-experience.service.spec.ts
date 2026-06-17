import {
  BehavioralAdherenceStyle,
  BehavioralCommunicationStyle,
  BehavioralMotivationStyle,
  BehavioralPersonalityPattern,
  GoalProgressionState,
  MotivationTriggerType,
  Prisma,
  StageOfChange,
  UserGoalType,
} from '@prisma/client';
import { EventService } from '../observability/event.service';
import { PrismaService } from '../prisma/prisma.service';
import { CoachExperienceCalculatorService } from './coach-experience-calculator.service';
import { CoachExperienceService } from './coach-experience.service';

describe('CoachExperienceService', () => {
  it('persists all daily snapshots and required observability events', async () => {
    const at = new Date('2026-06-15T12:00:00.000Z');
    const upsert = (id: string) =>
      jest.fn().mockResolvedValue({ id, generatedAt: at });
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([{ locked: true }]),
      coachCommunicationProfileSnapshot: {
        upsert: upsert('communication-id'),
      },
      coachMotivationProfileSnapshot: {
        upsert: upsert('motivation-id'),
      },
      messageFatigueSnapshot: { upsert: upsert('fatigue-id') },
      goalMomentumSnapshot: { upsert: upsert('momentum-id') },
      whatsAppExperienceSnapshot: { upsert: upsert('whatsapp-id') },
      retentionStrengthSnapshot: { upsert: upsert('retention-id') },
      coachReengagementClassification: {
        upsert: upsert('reengagement-id'),
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
      coachCommunicationProfileSnapshot: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn(),
      },
      message: {
        findMany: jest.fn().mockResolvedValue([
          { content: 'Como posso melhorar?', timestamp: at },
          { content: 'Vou registrar hoje.', timestamp: at },
        ]),
      },
      scheduledMessage: {
        findMany: jest.fn().mockResolvedValue([
          {
            content: 'Priorize proteína na próxima refeição.',
            scheduledFor: new Date('2026-06-14T09:00:00.000Z'),
          },
        ]),
      },
      outboundMessage: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      user: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          _count: {
            contextSnapshots: 4,
            conversationMemories: 3,
          },
        }),
      },
      recommendation: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ status: 'ACCEPTED' }, { status: 'DISMISSED' }]),
      },
      coachMessage: {
        count: jest.fn().mockResolvedValue(4),
      },
      coachReview: {
        count: jest.fn().mockResolvedValue(1),
      },
      messageFatigueSnapshot: { findMany: jest.fn() },
      goalMomentumSnapshot: { findMany: jest.fn() },
      retentionStrengthSnapshot: { findMany: jest.fn() },
    };
    const service = new CoachExperienceService(
      prisma as unknown as PrismaService,
      new CoachExperienceCalculatorService(),
      new EventService(prisma as unknown as PrismaService),
    );

    const result = await service.refreshForUser(
      'user-id',
      {
        behavior: {
          communicationStyle: BehavioralCommunicationStyle.COACH,
          motivationStyle: BehavioralMotivationStyle.HEALTH,
          adherenceStyle: BehavioralAdherenceStyle.FLEXIBLE,
          personalityPattern: BehavioralPersonalityPattern.SUPPORT_ORIENTED,
          stage: StageOfChange.ACTION,
          adherenceScore: 72,
          engagementScore: 68,
          preferredEngagementHour: 9,
          confidenceScore: 0.82,
          motivations: [{ type: BehavioralMotivationStyle.HEALTH, weight: 70 }],
          triggers: [{ type: MotivationTriggerType.HEALTH, weight: 80 }],
          insights: [],
          useShortMessages: false,
          motivationLine: 'Cuide da energia no dia real.',
        },
        goal: UserGoalType.HEALTH,
        consistencyScore: 70,
        engagementScore: 68,
        adherenceScore: 72,
        activeDays: 9,
        daysInactive: 4,
        churnRisk: 'MEDIUM',
        longitudinal: {
          profile: {
            historySize: 8,
            adherenceScore: 72,
            consistencyScore: 70,
          },
          preferences: [],
          evolution: null,
          relapse: null,
          goalProgression: {
            goal: UserGoalType.HEALTH,
            state: GoalProgressionState.STABLE,
            score: 66,
          },
          coachAdaptation: null,
          memories: [],
          monthlyReview: null,
        },
      },
      at,
    );

    expect(result).toEqual(
      expect.objectContaining({
        momentum: expect.objectContaining({ score: expect.any(Number) }),
        retention: expect.objectContaining({ score: expect.any(Number) }),
        reengagement: expect.objectContaining({
          reason: expect.any(String),
        }),
      }),
    );
    expect(
      transaction.coachCommunicationProfileSnapshot.upsert,
    ).toHaveBeenCalled();
    expect(
      transaction.coachMotivationProfileSnapshot.upsert,
    ).toHaveBeenCalled();
    expect(transaction.messageFatigueSnapshot.upsert).toHaveBeenCalled();
    expect(transaction.goalMomentumSnapshot.upsert).toHaveBeenCalled();
    expect(transaction.whatsAppExperienceSnapshot.upsert).toHaveBeenCalled();
    expect(transaction.retentionStrengthSnapshot.upsert).toHaveBeenCalled();
    expect(
      transaction.coachReengagementClassification.upsert,
    ).toHaveBeenCalled();
    const eventTypes = transaction.systemEvent.create.mock.calls.map(
      ([input]: [{ data: { eventType: string } }]) => input.data.eventType,
    );

    expect(eventTypes).toEqual(
      expect.arrayContaining([
        'COACH_PROFILE_UPDATED',
        'MOTIVATION_PROFILE_UPDATED',
        'MESSAGE_FATIGUE_RECALCULATED',
        'REENGAGEMENT_TRIGGER_CLASSIFIED',
        'GOAL_MOMENTUM_RECALCULATED',
        'RETENTION_SCORE_RECALCULATED',
      ]),
    );
    expect(transaction.retentionStrengthSnapshot.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          recommendationAcceptanceScore: 50,
          contextScore: expect.any(Number),
        }),
      }),
    );
  });

  it('paginates the four admin datasets', async () => {
    const records = [
      { id: 'first', confidence: new Prisma.Decimal('0.8') },
      { id: 'second', confidence: new Prisma.Decimal('0.7') },
    ];
    const prisma = {
      coachCommunicationProfileSnapshot: {
        findMany: jest.fn().mockResolvedValue(records),
      },
      messageFatigueSnapshot: {
        findMany: jest.fn().mockResolvedValue(records),
      },
      goalMomentumSnapshot: {
        findMany: jest.fn().mockResolvedValue(records),
      },
      retentionStrengthSnapshot: {
        findMany: jest.fn().mockResolvedValue(records),
      },
    };
    const service = new CoachExperienceService(
      prisma as unknown as PrismaService,
      new CoachExperienceCalculatorService(),
      {} as EventService,
    );
    const query = { limit: 1 };

    await expect(service.listProfiles(query)).resolves.toEqual({
      items: [records[0]],
      nextCursor: 'first',
    });
    await expect(service.listFatigue(query)).resolves.toEqual({
      items: [records[0]],
      nextCursor: 'first',
    });
    await expect(service.listMomentum(query)).resolves.toEqual({
      items: [records[0]],
      nextCursor: 'first',
    });
    await expect(service.listRetention(query)).resolves.toEqual({
      items: [records[0]],
      nextCursor: 'first',
    });
  });
});
