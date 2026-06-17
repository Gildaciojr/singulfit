import {
  PilotCohortStatus,
  PilotManualCheckStatus,
  PilotManualCheckType,
  PilotParticipantStatus,
} from '@prisma/client';
import { EventService } from '../observability/event.service';
import { PrismaService } from '../prisma/prisma.service';
import { PilotService } from './pilot.service';

describe('PilotService', () => {
  const at = new Date('2026-06-15T12:00:00.000Z');

  function createSubject<T extends object>(transaction: T) {
    const prisma = {
      $transaction: jest.fn((callback: (client: T) => unknown) =>
        callback(transaction),
      ),
      pilotCohort: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
      },
    };
    const events = {
      recordInTransaction: jest.fn().mockResolvedValue({ id: 'event-id' }),
    };

    return {
      service: new PilotService(
        prisma as unknown as PrismaService,
        events as unknown as EventService,
      ),
      prisma,
      events,
    };
  }

  it('creates a planned cohort and records observability', async () => {
    const cohort = {
      id: 'cohort-id',
      name: 'Pilot',
      description: 'Controlled cohort',
      status: PilotCohortStatus.PLANNED,
      startsAt: at,
      endsAt: new Date('2026-06-30T12:00:00.000Z'),
    };
    const tx = {
      pilotCohort: {
        create: jest.fn().mockResolvedValue(cohort),
      },
    };
    const subject = createSubject(tx);

    await expect(
      subject.service.create({
        name: ' Pilot ',
        description: ' Controlled cohort ',
        status: PilotCohortStatus.PLANNED,
        startsAt: at.toISOString(),
        endsAt: cohort.endsAt.toISOString(),
      }),
    ).resolves.toBe(cohort);
    expect(tx.pilotCohort.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: 'Pilot',
        description: 'Controlled cohort',
      }),
    });
    expect(subject.events.recordInTransaction).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ eventType: 'PILOT_COHORT_CREATED' }),
    );
  });

  it('adds valid participants idempotently', async () => {
    const participants = [
      {
        id: 'participant-id',
        cohortId: 'cohort-id',
        userId: '00000000-0000-4000-8000-000000000001',
      },
    ];
    const tx = {
      $queryRaw: jest.fn(),
      pilotCohort: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'cohort-id',
          status: PilotCohortStatus.ACTIVE,
        }),
      },
      user: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: '00000000-0000-4000-8000-000000000001' }]),
      },
      pilotParticipant: {
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce(participants),
      },
    };
    const subject = createSubject(tx);

    const result = await subject.service.addParticipants('cohort-id', {
      userIds: [
        '00000000-0000-4000-8000-000000000001',
        '00000000-0000-4000-8000-000000000001',
      ],
      notes: 'Consent confirmed',
    });

    expect(result).toBe(participants);
    expect(tx.pilotParticipant.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          status: PilotParticipantStatus.ACTIVE,
        }),
      ],
      skipDuplicates: true,
    });
    expect(subject.events.recordInTransaction).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ eventType: 'PILOT_PARTICIPANT_ADDED' }),
    );
  });

  it('persists a manual check with the authenticated operator', async () => {
    const tx = {
      $queryRaw: jest.fn(),
      pilotCohort: {
        findUnique: jest.fn().mockResolvedValue({ id: 'cohort-id' }),
      },
      pilotManualCheck: {
        upsert: jest.fn().mockResolvedValue({ id: 'check-id' }),
      },
    };
    const subject = createSubject(tx);

    await subject.service.recordManualCheck(
      'cohort-id',
      'admin-id',
      {
        checkType: PilotManualCheckType.RESTORE,
        status: PilotManualCheckStatus.PASSED,
        notes: 'Restore drill passed',
      },
      at,
    );

    expect(tx.pilotManualCheck.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          checkedByUserId: 'admin-id',
          checkedAt: at,
        }),
        update: expect.objectContaining({
          status: PilotManualCheckStatus.PASSED,
        }),
      }),
    );
  });

  it('completes the cohort and all non-dropped participants', async () => {
    const completed = {
      id: 'cohort-id',
      status: PilotCohortStatus.COMPLETED,
    };
    const tx = {
      $queryRaw: jest.fn(),
      pilotCohort: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'cohort-id',
          status: PilotCohortStatus.ACTIVE,
        }),
        update: jest.fn().mockResolvedValue(completed),
      },
      pilotParticipant: {
        updateMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
    };
    const subject = createSubject(tx);

    await expect(subject.service.complete('cohort-id', at)).resolves.toBe(
      completed,
    );
    expect(tx.pilotParticipant.updateMany).toHaveBeenCalledWith({
      where: {
        cohortId: 'cohort-id',
        status: { not: PilotParticipantStatus.DROPPED },
      },
      data: {
        status: PilotParticipantStatus.COMPLETED,
        completedAt: at,
      },
    });
    expect(subject.events.recordInTransaction).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ eventType: 'PILOT_COHORT_COMPLETED' }),
    );
  });
});
