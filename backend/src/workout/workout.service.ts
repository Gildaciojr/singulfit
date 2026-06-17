import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, WorkoutStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';

export const WORKOUT_PLAN_INCLUDE = {
  days: {
    orderBy: {
      dayNumber: 'asc' as const,
    },
    include: {
      exercises: {
        orderBy: {
          id: 'asc' as const,
        },
      },
    },
  },
} satisfies Prisma.WorkoutPlanInclude;

@Injectable()
export class WorkoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptionsService: SubscriptionsService,
  ) {}

  async getById(userId: string, workoutPlanId: string) {
    await this.subscriptionsService.getProfileSubscription(userId);

    const plan = await this.prisma.workoutPlan.findFirst({
      where: {
        id: workoutPlanId,
        userId,
      },
      include: WORKOUT_PLAN_INCLUDE,
    });

    if (!plan) {
      throw new NotFoundException('Treino não encontrado');
    }

    return plan;
  }

  async getCurrent(userId: string) {
    await this.subscriptionsService.getProfileSubscription(userId);

    const plan = await this.prisma.workoutPlan.findFirst({
      where: {
        userId,
        status: WorkoutStatus.ACTIVE,
      },
      include: WORKOUT_PLAN_INCLUDE,
      orderBy: {
        generatedAt: 'desc',
      },
    });

    if (!plan) {
      throw new NotFoundException('Treino ativo não encontrado');
    }

    return plan;
  }

  async listHistory(userId: string) {
    await this.subscriptionsService.getProfileSubscription(userId);

    return this.prisma.workoutPlan.findMany({
      where: {
        userId,
      },
      include: WORKOUT_PLAN_INCLUDE,
      orderBy: [
        {
          generatedAt: 'desc',
        },
        {
          id: 'desc',
        },
      ],
    });
  }
}
