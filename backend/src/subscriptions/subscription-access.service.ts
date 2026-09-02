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

    if (ended || periodEnd <= at) {
      await this.expire(
        client,
        subscription.id,
        subscription.cancelAtPeriodEnd,
        at,
      );
      throw new ForbiddenException('A assinatura do usuário expirou');
    }

    if (subscription.status !== SubscriptionStatus.ACTIVE) {
      throw new ForbiddenException('A assinatura do usuário não está ativa');
    }

    return subscription;
  }

  private async expire(
    client: DatabaseClient,
    subscriptionId: string,
    canceledAtPeriodEnd: boolean,
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
        status: canceledAtPeriodEnd
          ? SubscriptionStatus.CANCELED
          : SubscriptionStatus.EXPIRED,
        endedAt: at,
        version: {
          increment: 1,
        },
      },
    });
  }
}
