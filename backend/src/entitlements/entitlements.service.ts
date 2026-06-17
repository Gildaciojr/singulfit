import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionAccessService } from '../subscriptions/subscription-access.service';

type DatabaseClient = PrismaService | Prisma.TransactionClient;

@Injectable()
export class EntitlementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptionAccessService: SubscriptionAccessService,
  ) {}

  getForUser(userId: string, codes: string[], at = new Date()) {
    return this.getForUserInTransaction(this.prisma, userId, codes, at);
  }

  async getForUserInTransaction(
    transaction: DatabaseClient,
    userId: string,
    codes: string[],
    at = new Date(),
  ): Promise<Map<string, number>> {
    const subscription =
      await this.subscriptionAccessService.requireAccessInTransaction(
        transaction,
        userId,
        at,
      );
    const plan = await transaction.plan.findUnique({
      where: {
        id: subscription.planId,
      },
      include: {
        entitlements: {
          where: {
            entitlement: {
              code: {
                in: codes,
              },
            },
          },
          include: {
            entitlement: true,
          },
        },
      },
    });

    if (!plan) {
      throw new ServiceUnavailableException(
        'Plano da assinatura não encontrado',
      );
    }

    const values = new Map(
      plan.entitlements.map((planEntitlement) => [
        planEntitlement.entitlement.code,
        planEntitlement.value,
      ]),
    );
    const missingCodes = codes.filter((code) => !values.has(code));

    if (missingCodes.length > 0) {
      throw new ServiceUnavailableException(
        `Entitlements não configurados para o plano: ${missingCodes.join(', ')}`,
      );
    }

    return values;
  }
}
