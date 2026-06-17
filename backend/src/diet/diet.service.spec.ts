import { NotFoundException } from '@nestjs/common';
import { DietPlanStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { DietService } from './diet.service';

describe('DietService', () => {
  function createSubject(plan: object | null = { id: 'diet-plan-id' }) {
    const prisma = {
      dietPlan: {
        findFirst: jest.fn().mockResolvedValue(plan),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const subscriptionsService = {
      getProfileSubscription: jest.fn().mockResolvedValue({
        status: 'PAST_DUE',
      }),
    };
    const service = new DietService(
      prisma as unknown as PrismaService,
      subscriptionsService as unknown as SubscriptionsService,
    );

    return {
      service,
      prisma,
      subscriptionsService,
    };
  }

  it('loads a diet only when it belongs to the authenticated user', async () => {
    const subject = createSubject();

    await subject.service.getById('user-id', 'diet-plan-id');

    expect(subject.prisma.dietPlan.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'diet-plan-id',
          userId: 'user-id',
        },
      }),
    );
  });

  it('hides diets owned by another user', async () => {
    const subject = createSubject(null);

    await expect(
      subject.service.getById('user-id', 'other-diet-id'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns only the current active diet', async () => {
    const subject = createSubject();

    await subject.service.getCurrent('user-id');

    expect(subject.prisma.dietPlan.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: 'user-id',
          status: DietPlanStatus.ACTIVE,
        },
      }),
    );
  });

  it('returns complete history from newest to oldest', async () => {
    const subject = createSubject();

    await subject.service.listHistory('user-id');

    expect(subject.prisma.dietPlan.findMany).toHaveBeenCalledWith(
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
