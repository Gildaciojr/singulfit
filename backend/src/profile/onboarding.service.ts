import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';

export type OnboardingStatus = 'PROFILE_INCOMPLETE' | 'PROFILE_COMPLETE';

type DatabaseClient = PrismaService | Prisma.TransactionClient;

@Injectable()
export class OnboardingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptionsService: SubscriptionsService,
  ) {}

  async getChecklist(userId: string) {
    const subscription =
      await this.subscriptionsService.getProfileSubscription(userId);
    const status = await this.getStatus(this.prisma, userId);

    return {
      status,
      completed: status === 'PROFILE_COMPLETE',
      subscriptionStatus: subscription.status,
    };
  }

  async synchronizeInTransaction(
    transaction: Prisma.TransactionClient,
    userId: string,
  ): Promise<OnboardingStatus> {
    const status = await this.getStatus(transaction, userId);

    await transaction.user.update({
      where: {
        id: userId,
      },
      data: {
        onboardingCompleted: status === 'PROFILE_COMPLETE',
      },
    });

    return status;
  }

  private async getStatus(
    client: DatabaseClient,
    userId: string,
  ): Promise<OnboardingStatus> {
    const profile = await client.fitnessProfile.findUnique({
      where: {
        userId,
      },
      select: {
        id: true,
      },
    });

    return profile ? 'PROFILE_COMPLETE' : 'PROFILE_INCOMPLETE';
  }
}
