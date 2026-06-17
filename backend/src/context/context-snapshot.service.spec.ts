import { ActivityLevel, FitnessGoal, Gender, Prisma } from '@prisma/client';
import { EventBusService } from '../event-bus/event-bus.service';
import { AuditService } from '../observability/audit.service';
import { EventService } from '../observability/event.service';
import { PrismaService } from '../prisma/prisma.service';
import { ContextSnapshotService } from './context-snapshot.service';
import { MemoryService } from './memory.service';

describe('ContextSnapshotService', () => {
  function createSubject() {
    const profile = {
      gender: Gender.FEMALE,
      birthDate: new Date('1990-01-01T00:00:00.000Z'),
      heightCm: 165,
      currentWeightKg: new Prisma.Decimal('70'),
      targetWeightKg: new Prisma.Decimal('62'),
      activityLevel: ActivityLevel.MODERATE,
      goal: FitnessGoal.WEIGHT_LOSS,
      foodRestrictions: [
        {
          type: 'LACTOSE',
          description: 'Evitar lactose',
        },
      ],
    };
    const snapshot = {
      id: 'snapshot-id',
      userId: 'user-id',
      refreshKey: 'message-id',
    };
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([{ locked: true }]),
      nutritionProfile: {
        upsert: jest.fn().mockResolvedValue({ id: 'nutrition-id' }),
      },
      userPreferences: {
        upsert: jest.fn().mockResolvedValue({ id: 'preferences-id' }),
      },
      userContextSnapshot: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(snapshot),
      },
    };
    const prisma = {
      userContextSnapshot: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'user-id',
          fitnessProfile: profile,
          nutritionProfile: null,
        }),
      },
      conversation: {
        findFirst: jest.fn().mockResolvedValue({
          lastMessageAt: new Date('2026-06-10T12:00:00.000Z'),
        }),
      },
      message: {
        count: jest.fn().mockResolvedValueOnce(2).mockResolvedValueOnce(5),
      },
      mealAnalysis: {
        count: jest.fn().mockResolvedValue(3),
      },
      fitnessCheckIn: {
        findFirst: jest.fn().mockResolvedValue({
          adherenceScore: 85,
        }),
      },
      $transaction: jest.fn(
        (operation: (client: typeof transaction) => unknown) =>
          operation(transaction),
      ),
    };
    const memoryService = {
      prepareLongTermMemory: jest.fn().mockResolvedValue({
        content: {
          recentMessages: [],
        },
        summary: 'Resumo',
        relevanceScore: new Prisma.Decimal('1'),
        generatedAt: new Date(),
      }),
      persistLongTermInTransaction: jest
        .fn()
        .mockResolvedValue({ id: 'memory-id' }),
    };
    const eventBus = {
      publish: jest.fn().mockResolvedValue({ id: 'completion-event' }),
    };
    const eventService = {
      recordInTransaction: jest.fn().mockResolvedValue({}),
    };
    const auditService = {
      recordInTransaction: jest.fn().mockResolvedValue({}),
    };
    const service = new ContextSnapshotService(
      prisma as unknown as PrismaService,
      memoryService as unknown as MemoryService,
      eventBus as unknown as EventBusService,
      eventService as unknown as EventService,
      auditService as unknown as AuditService,
    );

    return {
      service,
      prisma,
      transaction,
      memoryService,
      eventBus,
      eventService,
      auditService,
      profile,
      snapshot,
    };
  }

  it('projects the fitness profile and creates context atomically', async () => {
    const subject = createSubject();

    await expect(
      subject.service.refreshFromEvent({
        id: 'outbox-id',
        aggregateId: 'message-id',
        attempts: 1,
        payload: {
          userId: 'user-id',
          messageId: 'message-id',
        },
      }),
    ).resolves.toBe(subject.snapshot);
    expect(subject.transaction.nutritionProfile.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: 'user-id',
        },
        update: expect.objectContaining({
          currentWeightKg: subject.profile.currentWeightKg,
          restrictions: [
            {
              type: 'LACTOSE',
              description: 'Evitar lactose',
            },
          ],
        }),
      }),
    );
    expect(subject.transaction.userContextSnapshot.create).toHaveBeenCalledWith(
      {
        data: expect.objectContaining({
          refreshKey: 'message-id',
          messagesLast7Days: 2,
          messagesLast30Days: 5,
          nutritionAnalysesCount: 3,
          adherenceScore: 85,
        }),
      },
    );
    expect(subject.eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'USER_CONTEXT_REFRESH_COMPLETED',
        aggregateId: 'message-id',
      }),
      subject.transaction,
    );
  });

  it('returns an existing snapshot without duplicating lifecycle records', async () => {
    const subject = createSubject();
    subject.prisma.userContextSnapshot.findUnique.mockResolvedValue(
      subject.snapshot,
    );

    await expect(
      subject.service.refreshFromEvent({
        id: 'outbox-id',
        aggregateId: 'message-id',
        attempts: 2,
        payload: {
          userId: 'user-id',
        },
      }),
    ).resolves.toBe(subject.snapshot);
    expect(subject.prisma.$transaction).not.toHaveBeenCalled();
    expect(subject.eventService.recordInTransaction).not.toHaveBeenCalled();
  });
});
