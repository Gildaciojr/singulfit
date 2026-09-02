import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionAccessService } from '../subscriptions/subscription-access.service';
import type { CommercialUsageEntitlementCode } from './entitlement.constants';

type DatabaseClient = PrismaService | Prisma.TransactionClient;

export interface CommercialEntitlementGrant {
  readonly code: CommercialUsageEntitlementCode;
  readonly unlimited: boolean;
  readonly limit: number | null;
  readonly periodStart: Date;
  readonly periodEnd: Date;
}

@Injectable()
export class EntitlementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptionAccessService: SubscriptionAccessService,
  ) {}

  getForUser(userId: string, codes: readonly string[], at = new Date()) {
    return this.getForUserInTransaction(this.prisma, userId, codes, at);
  }

  async getForUserInTransaction(
    transaction: DatabaseClient,
    userId: string,
    codes: readonly string[],
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
                in: [...codes],
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

  resolveCommercialGrant(
    userId: string,
    code: CommercialUsageEntitlementCode,
    at = new Date(),
  ) {
    return this.resolveCommercialGrantInTransaction(
      this.prisma,
      userId,
      code,
      at,
    );
  }

  async resolveCommercialGrantInTransaction(
    transaction: DatabaseClient,
    userId: string,
    code: CommercialUsageEntitlementCode,
    at = new Date(),
  ): Promise<CommercialEntitlementGrant> {
    const subscription =
      await this.subscriptionAccessService.requireAccessInTransaction(
        transaction,
        userId,
        at,
      );
    const periodStart = subscription.currentPeriodStart;
    const periodEnd = subscription.currentPeriodEnd;
    if (!periodStart || !periodEnd || periodStart > at || periodEnd <= at) {
      throw new ServiceUnavailableException(
        'Ciclo comercial da assinatura não está disponível',
      );
    }
    const entitlement = await transaction.planEntitlement.findFirst({
      where: {
        planId: subscription.planId,
        entitlement: { code },
      },
      select: { value: true, unlimited: true },
    });
    if (!entitlement) {
      throw new ServiceUnavailableException(
        `Entitlement comercial não configurado para o plano: ${code}`,
      );
    }
    return Object.freeze({
      code,
      unlimited: entitlement.unlimited,
      limit: entitlement.unlimited ? null : entitlement.value,
      periodStart,
      periodEnd,
    });
  }
}
