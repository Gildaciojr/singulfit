import {
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma, SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type DatabaseClient = PrismaService | Prisma.TransactionClient;

const ACCESS_STATUSES = [
  SubscriptionStatus.ACTIVE,
  SubscriptionStatus.PAST_DUE,
];

@Injectable()
export class SubscriptionAccessService {
  constructor(private readonly prisma: PrismaService) {}

  requireAccess(userId: string, at = new Date()) {
    return this.requireAccessInTransaction(this.prisma, userId, at);
  }

  async requireAccessInTransaction(
    client: DatabaseClient,
    userId: string,
    at = new Date(),
  ) {
    const subscription = await client.subscription.findFirst({
      where: {
        userId,
        status: {
          in: ACCESS_STATUSES,
        },
      },
      include: {
        plan: true,
      },
      orderBy: {
        updatedAt: 'desc',
      },
    });

    if (!subscription || !subscription.plan.isActive) {
      throw new ForbiddenException('Usuário sem assinatura com acesso');
    }

    const periodEnd =
      subscription.currentPeriodEnd ?? subscription.billingPeriodEnd;

    if (!periodEnd) {
      throw new ServiceUnavailableException(
        'Assinatura sem período de acesso configurado',
      );
    }

    const ended =
      (subscription.endedAt !== null && subscription.endedAt <= at) ||
      (subscription.cancelAtPeriodEnd && periodEnd <= at);
    const accessEnd = subscription.cancelAtPeriodEnd
      ? periodEnd
      : (subscription.gracePeriodEnd ?? periodEnd);

    if (ended || accessEnd <= at) {
      await this.expire(client, subscription.id, at);
      throw new ForbiddenException('A assinatura do usuário expirou');
    }

    if (subscription.status === SubscriptionStatus.ACTIVE && periodEnd <= at) {
      const changed = await client.subscription.updateMany({
        where: {
          id: subscription.id,
          status: SubscriptionStatus.ACTIVE,
        },
        data: {
          status: SubscriptionStatus.PAST_DUE,
          version: {
            increment: 1,
          },
        },
      });

      if (changed.count === 1) {
        return {
          ...subscription,
          status: SubscriptionStatus.PAST_DUE,
        };
      }
    }

    return subscription;
  }

  private async expire(
    client: DatabaseClient,
    subscriptionId: string,
    at: Date,
  ): Promise<void> {
    await client.subscription.updateMany({
      where: {
        id: subscriptionId,
        status: {
          in: ACCESS_STATUSES,
        },
      },
      data: {
        status: SubscriptionStatus.EXPIRED,
        endedAt: at,
        version: {
          increment: 1,
        },
      },
    });
  }
}
