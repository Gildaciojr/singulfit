import { Injectable } from '@nestjs/common';
import { Prisma, UsageEventStatus } from '@prisma/client';
import { IMAGE_ANALYSIS_ENTITLEMENTS } from '../entitlements/entitlement.constants';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UsageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlementsService: EntitlementsService,
  ) {}

  async checkAvailability(userId: string, at = new Date()) {
    const limits = await this.entitlementsService.getForUser(
      userId,
      [...IMAGE_ANALYSIS_ENTITLEMENTS],
      at,
    );
    const buckets = await this.prisma.usageBucket.findMany({
      where: {
        userId,
        entitlementCode: {
          in: [...IMAGE_ANALYSIS_ENTITLEMENTS],
        },
        periodStart: {
          lte: at,
        },
        periodEnd: {
          gt: at,
        },
      },
    });
    const remaining = IMAGE_ANALYSIS_ENTITLEMENTS.map((code) => {
      const bucket = buckets.find(
        (currentBucket) => currentBucket.entitlementCode === code,
      );

      return (
        (limits.get(code) ?? 0) - (bucket?.used ?? 0) - (bucket?.reserved ?? 0)
      );
    });
    const available = Math.min(...remaining);

    return {
      allowed: available > 0,
      remaining: Math.max(available, 0),
    };
  }

  confirm(aiJobId: string) {
    return this.prisma.$transaction((transaction) =>
      this.confirmInTransaction(transaction, aiJobId),
    );
  }

  reverse(aiJobId: string) {
    return this.prisma.$transaction((transaction) =>
      this.reverseInTransaction(transaction, aiJobId),
    );
  }

  confirmInTransaction(transaction: Prisma.TransactionClient, aiJobId: string) {
    return this.settleInTransaction(
      transaction,
      aiJobId,
      UsageEventStatus.CONFIRMED,
    );
  }

  reverseInTransaction(transaction: Prisma.TransactionClient, aiJobId: string) {
    return this.settleInTransaction(
      transaction,
      aiJobId,
      UsageEventStatus.REVERSED,
    );
  }

  private async settleInTransaction(
    transaction: Prisma.TransactionClient,
    aiJobId: string,
    targetStatus: UsageEventStatus,
  ) {
    const job = await transaction.aIJob.findUnique({
      where: {
        id: aiJobId,
      },
      select: {
        userId: true,
      },
    });

    if (!job) {
      return [];
    }

    await transaction.$queryRaw`
      WITH advisory_lock AS (
        SELECT pg_advisory_xact_lock(hashtext(${`usage:${job.userId}`}))
      )
      SELECT true AS "locked"
      FROM advisory_lock
    `;

    const events = await transaction.usageEvent.findMany({
      where: {
        aiJobId,
        status: UsageEventStatus.RESERVED,
      },
      orderBy: {
        entitlementCode: 'asc',
      },
    });

    for (const event of events) {
      const bucket = await transaction.usageBucket.findFirstOrThrow({
        where: {
          userId: event.userId,
          entitlementCode: event.entitlementCode,
          periodStart: {
            lte: event.createdAt,
          },
          periodEnd: {
            gt: event.createdAt,
          },
        },
      });

      await transaction.usageBucket.update({
        where: {
          id: bucket.id,
        },
        data:
          targetStatus === UsageEventStatus.CONFIRMED
            ? {
                reserved: {
                  decrement: event.quantity,
                },
                used: {
                  increment: event.quantity,
                },
              }
            : {
                reserved: {
                  decrement: event.quantity,
                },
              },
      });
      await transaction.usageEvent.update({
        where: {
          id: event.id,
        },
        data: {
          status: targetStatus,
        },
      });
    }

    return events;
  }
}
