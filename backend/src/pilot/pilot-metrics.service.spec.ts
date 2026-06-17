import { PilotParticipantStatus, Prisma } from '@prisma/client';
import { EventService } from '../observability/event.service';
import { PrismaService } from '../prisma/prisma.service';
import { PilotMetricsService } from './pilot-metrics.service';

describe('PilotMetricsService', () => {
  it('calculates the controlled cohort funnel, costs, usage and messages', async () => {
    const at = new Date('2026-06-10T12:00:00.000Z');
    const tx = {
      $queryRaw: jest.fn(),
      pilotParticipant: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'participant-id',
            userId: 'user-1',
            user: { activation: { activatedAt: at } },
          },
        ]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const prisma = {
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
      pilotCohort: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'cohort-id',
          startsAt: new Date('2026-06-01T00:00:00.000Z'),
          endsAt: new Date('2026-06-30T00:00:00.000Z'),
          participants: [
            {
              userId: 'user-1',
              status: PilotParticipantStatus.ACTIVATED,
              user: {
                createdAt: new Date('2026-06-01T00:00:00.000Z'),
                subscriptions: [{ id: 'subscription-id', paidAt: at }],
                activation: {
                  paidAt: at,
                  firstMealReceivedAt: at,
                  firstAnalysisCompletedAt: at,
                  firstRecommendationDeliveredAt: at,
                  firstCoachInteractionAt: at,
                  activatedAt: at,
                  abandonedAt: null,
                },
              },
            },
            {
              userId: 'user-2',
              status: PilotParticipantStatus.DROPPED,
              user: {
                createdAt: new Date('2026-06-02T00:00:00.000Z'),
                subscriptions: [],
                activation: {
                  paidAt: null,
                  firstMealReceivedAt: null,
                  firstAnalysisCompletedAt: null,
                  firstRecommendationDeliveredAt: null,
                  firstCoachInteractionAt: null,
                  activatedAt: null,
                  abandonedAt: at,
                },
              },
            },
          ],
        }),
      },
      aIResponseEvaluation: {
        aggregate: jest.fn().mockResolvedValue({
          _avg: { qualityScore: 82.5, safetyScore: 96 },
          _count: { _all: 4 },
        }),
        count: jest.fn().mockResolvedValueOnce(0).mockResolvedValueOnce(1),
      },
      usageDaily: {
        aggregate: jest.fn().mockResolvedValue({ _avg: { imagesUsed: 1.5 } }),
      },
      message: { count: jest.fn().mockResolvedValue(12) },
      outboundMessage: { count: jest.fn().mockResolvedValue(8) },
      scheduledMessage: { count: jest.fn().mockResolvedValue(2) },
      aIUsage: {
        aggregate: jest.fn().mockResolvedValue({
          _sum: { estimatedCost: new Prisma.Decimal('0.20') },
        }),
      },
      whatsAppCostSnapshot: {
        aggregate: jest.fn().mockResolvedValue({
          _sum: { estimatedCost: new Prisma.Decimal('0.50') },
        }),
      },
      storageCostSnapshot: {
        aggregate: jest.fn().mockResolvedValue({
          _sum: { estimatedCost: new Prisma.Decimal('0.10') },
        }),
      },
    };
    const events = {
      recordInTransaction: jest.fn().mockResolvedValue({ id: 'event-id' }),
    };
    const service = new PilotMetricsService(
      prisma as unknown as PrismaService,
      events as unknown as EventService,
    );

    const result = await service.calculate('cohort-id');

    expect(result).toEqual(
      expect.objectContaining({
        invitedUsers: 2,
        registeredUsers: 2,
        paidUsers: 1,
        activatedUsers: 1,
        firstMealUsers: 1,
        firstAnalysisUsers: 1,
        firstRecommendationUsers: 1,
        firstCoachUsers: 1,
        initialChurnUsers: 1,
        activationRate: 50,
        initialChurnRate: 50,
        retentionRate: 50,
        averageAIQuality: 82.5,
        aiEvaluations: 4,
        receivedMessages: 12,
        sentMessages: 10,
      }),
    );
    expect(result.costs).toEqual({
      aiUsd: '0.20000000',
      whatsappBrl: '0.50000000',
      storageBrl: '0.10000000',
      aiUsdPerUser: '0.10000000',
      operationalBrlPerUser: '0.30000000',
    });
    expect(events.recordInTransaction).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ eventType: 'PILOT_PARTICIPANT_ACTIVATED' }),
    );
  });
});
