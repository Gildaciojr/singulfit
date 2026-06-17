import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { WorkoutService } from './workout.service';

describe('WorkoutService', () => {
  function createSubject(plan: object | null = { id: 'plan-id' }) {
    const prisma = {
      workoutPlan: {
        findFirst: jest.fn().mockResolvedValue(plan),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const subscriptionsService = {
      getProfileSubscription: jest.fn().mockResolvedValue({
        status: 'PAST_DUE',
      }),
    };
    const service = new WorkoutService(
      prisma as unknown as PrismaService,
      subscriptionsService as unknown as SubscriptionsService,
    );

    return {
      service,
      prisma,
      subscriptionsService,
    };
  }

  it('loads a workout only when it belongs to the authenticated user', async () => {
    const subject = createSubject();

    await subject.service.getById('user-id', 'plan-id');

    expect(subject.prisma.workoutPlan.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'plan-id',
          userId: 'user-id',
        },
      }),
    );
  });

  it('hides workouts owned by another user', async () => {
    const subject = createSubject(null);

    await expect(
      subject.service.getById('user-id', 'other-plan-id'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns the current active workout', async () => {
    const subject = createSubject();

    await subject.service.getCurrent('user-id');

    expect(subject.prisma.workoutPlan.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: 'user-id',
          status: 'ACTIVE',
        },
      }),
    );
  });

  it('returns workout history from newest to oldest', async () => {
    const subject = createSubject();

    await subject.service.listHistory('user-id');

    expect(subject.prisma.workoutPlan.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: 'user-id',
        },
        orderBy: [
          {
            generatedAt: 'desc',
          },
          {
            id: 'desc',
          },
        ],
      }),
    );
  });
});
