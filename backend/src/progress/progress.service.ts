import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';

@Injectable()
export class ProgressService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptionsService: SubscriptionsService,
  ) {}

  async getProgress(userId: string) {
    await this.subscriptionsService.getProfileSubscription(userId);

    return this.prisma.progressSnapshot.findMany({
      where: {
        userId,
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
  }

  async getInsights(userId: string) {
    await this.subscriptionsService.getProfileSubscription(userId);

    return this.prisma.progressInsight.findMany({
      where: {
        userId,
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
  }
}
