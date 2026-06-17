import { Injectable, NotFoundException } from '@nestjs/common';
import { DietPlanStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';

export const DIET_PLAN_INCLUDE = {
  meals: {
    orderBy: {
      order: 'asc' as const,
    },
    include: {
      items: {
        orderBy: {
          id: 'asc' as const,
        },
      },
    },
  },
  aiJob: {
    include: {
      usage: {
        orderBy: {
          createdAt: 'asc' as const,
        },
      },
    },
  },
} satisfies Prisma.DietPlanInclude;

@Injectable()
export class DietService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptionsService: SubscriptionsService,
  ) {}

  async getById(userId: string, dietPlanId: string) {
    await this.subscriptionsService.getProfileSubscription(userId);

    const plan = await this.prisma.dietPlan.findFirst({
      where: {
        id: dietPlanId,
        userId,
      },
      include: DIET_PLAN_INCLUDE,
    });

    if (!plan) {
      throw new NotFoundException('Dieta não encontrada');
    }

    return plan;
  }

  async getCurrent(userId: string) {
    await this.subscriptionsService.getProfileSubscription(userId);

    const plan = await this.prisma.dietPlan.findFirst({
      where: {
        userId,
        status: DietPlanStatus.ACTIVE,
      },
      include: DIET_PLAN_INCLUDE,
      orderBy: {
        generatedAt: 'desc',
      },
    });

    if (!plan) {
      throw new NotFoundException('Dieta ativa não encontrada');
    }

    return plan;
  }

  async listHistory(userId: string) {
    await this.subscriptionsService.getProfileSubscription(userId);

    return this.prisma.dietPlan.findMany({
      where: {
        userId,
      },
      include: DIET_PLAN_INCLUDE,
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
