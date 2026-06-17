import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { ProgressService } from './progress.service';

describe('ProgressService', () => {
  function createSubject() {
    const prisma = {
      progressSnapshot: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      progressInsight: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const subscriptionsService = {
      getProfileSubscription: jest.fn().mockResolvedValue({
        status: 'PAST_DUE',
      }),
    };
    const service = new ProgressService(
      prisma as unknown as PrismaService,
      subscriptionsService as unknown as SubscriptionsService,
    );

    return {
      service,
      prisma,
      subscriptionsService,
    };
  }

  it('returns progress snapshots with their insights', async () => {
    const subject = createSubject();

    await subject.service.getProgress('user-id');

    expect(subject.prisma.progressSnapshot.findMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-id',
      },
      include: {
        insights: {
          orderBy: {
            createdAt: 'asc',
          },
        },
      },
      orderBy: [
        {
          createdAt: 'desc',
        },
        {
          id: 'desc',
        },
      ],
    });
  });

  it('returns only insights owned by the user', async () => {
    const subject = createSubject();

    await subject.service.getInsights('user-id');

    expect(subject.prisma.progressInsight.findMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-id',
      },
      include: {
        snapshot: true,
      },
      orderBy: [
        {
          createdAt: 'desc',
        },
        {
          id: 'desc',
        },
      ],
    });
  });
});
