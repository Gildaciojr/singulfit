import { UsageEventStatus } from '@prisma/client';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { PrismaService } from '../prisma/prisma.service';
import { UsageService } from './usage.service';

describe('UsageService', () => {
  function createSubject() {
    const event = {
      id: 'event-id',
      userId: 'user-id',
      aiJobId: 'job-id',
      entitlementCode: 'IMAGE_ANALYSIS_DAILY',
      quantity: 1,
      status: UsageEventStatus.RESERVED,
      createdAt: new Date('2026-06-10T12:00:00.000Z'),
    };
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      aIJob: {
        findUnique: jest.fn().mockResolvedValue({
          userId: 'user-id',
        }),
      },
      usageEvent: {
        findMany: jest.fn().mockResolvedValue([event]),
        update: jest.fn().mockResolvedValue(event),
      },
      usageBucket: {
        findFirstOrThrow: jest.fn().mockResolvedValue({
          id: 'bucket-id',
        }),
        update: jest.fn().mockResolvedValue({
          id: 'bucket-id',
        }),
      },
    };
    const service = new UsageService(
      {} as PrismaService,
      {} as EntitlementsService,
    );

    return {
      service,
      transaction,
    };
  }

  it('confirms a reservation by moving reserved usage to used', async () => {
    const subject = createSubject();

    await subject.service.confirmInTransaction(
      subject.transaction as never,
      'job-id',
    );

    expect(subject.transaction.usageBucket.update).toHaveBeenCalledWith({
      where: {
        id: 'bucket-id',
      },
      data: {
        reserved: {
          decrement: 1,
        },
        used: {
          increment: 1,
        },
      },
    });
    expect(subject.transaction.usageEvent.update).toHaveBeenCalledWith({
      where: {
        id: 'event-id',
      },
      data: {
        status: UsageEventStatus.CONFIRMED,
      },
    });
  });

  it('reverses a reservation without consuming usage', async () => {
    const subject = createSubject();

    await subject.service.reverseInTransaction(
      subject.transaction as never,
      'job-id',
    );

    expect(subject.transaction.usageBucket.update).toHaveBeenCalledWith({
      where: {
        id: 'bucket-id',
      },
      data: {
        reserved: {
          decrement: 1,
        },
      },
    });
    expect(subject.transaction.usageEvent.update).toHaveBeenCalledWith({
      where: {
        id: 'event-id',
      },
      data: {
        status: UsageEventStatus.REVERSED,
      },
    });
  });
});
