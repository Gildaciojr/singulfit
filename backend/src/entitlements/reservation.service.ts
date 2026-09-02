import {
  ConflictException,
  Injectable,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, UsageEventStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  IMAGE_ANALYSIS,
  type CommercialUsageEntitlementCode,
} from './entitlement.constants';
import { EntitlementsService } from './entitlements.service';
import { UsageLimitExceededException } from './usage-limit.exception';

export interface ReserveImageAnalysisInput {
  userId: string;
  aiJobId: string;
  quantity?: number;
  at?: Date;
}

export interface ReserveCommercialUsageInput {
  readonly userId: string;
  readonly aiJobId: string;
  readonly entitlementCode: CommercialUsageEntitlementCode;
  readonly quantity?: number;
  readonly at?: Date;
}

@Injectable()
export class ReservationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlementsService: EntitlementsService,
    @Optional() private readonly configService?: ConfigService,
  ) {}

  reserveImageAnalysis(input: ReserveImageAnalysisInput) {
    return this.prisma.$transaction((transaction) =>
      this.reserveImageAnalysisInTransaction(transaction, input),
    );
  }

  async reserveImageAnalysisInTransaction(
    transaction: Prisma.TransactionClient,
    input: ReserveImageAnalysisInput,
  ) {
    return this.reserveCommercialUsageInTransaction(transaction, {
      ...input,
      entitlementCode: IMAGE_ANALYSIS,
    });
  }

  reserveCommercialUsage(input: ReserveCommercialUsageInput) {
    return this.prisma.$transaction((transaction) =>
      this.reserveCommercialUsageInTransaction(transaction, input),
    );
  }

  async reserveCommercialUsageInTransaction(
    transaction: Prisma.TransactionClient,
    input: ReserveCommercialUsageInput,
  ) {
    const quantity = input.quantity ?? 1;

    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new ConflictException('Quantidade de reserva inválida');
    }

    await this.lockUser(transaction, input.userId);

    const existingEvent = await transaction.usageEvent.findUnique({
      where: {
        aiJobId_entitlementCode: {
          aiJobId: input.aiJobId,
          entitlementCode: input.entitlementCode,
        },
      },
    });

    if (existingEvent && existingEvent.status !== UsageEventStatus.REVERSED) {
      if (
        existingEvent.userId === input.userId &&
        existingEvent.quantity === quantity
      ) {
        return [existingEvent];
      }

      throw new ConflictException('Reserva de uso inconsistente para o job');
    }

    const at = input.at ?? new Date();
    const expiresAt = new Date(at.getTime() + this.getReservationTtlMs());
    const grant =
      await this.entitlementsService.resolveCommercialGrantInTransaction(
        transaction,
        input.userId,
        input.entitlementCode,
        at,
      );
    if (grant.unlimited) return [];
    const limit = grant.limit;
    if (limit === null) {
      throw new ConflictException('Limite do entitlement não encontrado');
    }
    const bucket = await transaction.usageBucket.upsert({
      where: {
        userId_entitlementCode_periodStart_periodEnd: {
          userId: input.userId,
          entitlementCode: input.entitlementCode,
          periodStart: grant.periodStart,
          periodEnd: grant.periodEnd,
        },
      },
      update: {},
      create: {
        userId: input.userId,
        entitlementCode: input.entitlementCode,
        periodStart: grant.periodStart,
        periodEnd: grant.periodEnd,
      },
    });

    if (bucket.used + bucket.reserved + quantity > limit) {
      const user = await transaction.user.findUnique({
        where: { id: input.userId },
        select: { name: true },
      });
      throw new UsageLimitExceededException(
        input.entitlementCode,
        limit,
        this.firstName(user?.name),
      );
    }

    await transaction.usageBucket.update({
      where: {
        id: bucket.id,
      },
      data: {
        reserved: {
          increment: quantity,
        },
      },
    });
    const event = existingEvent
      ? await transaction.usageEvent.update({
          where: { id: existingEvent.id },
          data: {
            status: UsageEventStatus.RESERVED,
            expiresAt,
            createdAt: at,
          },
        })
      : await transaction.usageEvent.create({
          data: {
            userId: input.userId,
            aiJobId: input.aiJobId,
            entitlementCode: input.entitlementCode,
            quantity,
            status: UsageEventStatus.RESERVED,
            expiresAt,
          },
        });

    return [event];
  }

  private async lockUser(
    transaction: Prisma.TransactionClient,
    userId: string,
  ): Promise<void> {
    await transaction.$queryRaw`
      WITH advisory_lock AS (
        SELECT pg_advisory_xact_lock(hashtext(${`usage:${userId}`}))
      )
      SELECT true AS "locked"
      FROM advisory_lock
    `;
  }

  private getReservationTtlMs(): number {
    const seconds = Number.parseInt(
      this.configService?.get<string>('AI_RESERVATION_TTL_SECONDS', '300') ??
        '300',
      10,
    );

    if (!Number.isInteger(seconds) || seconds < 60 || seconds > 3600) {
      throw new ServiceUnavailableException(
        'AI_RESERVATION_TTL_SECONDS possui valor inválido',
      );
    }

    return seconds * 1_000;
  }

  private firstName(name: string | null | undefined): string | undefined {
    return name?.trim().split(/\s+/u)[0] || undefined;
  }
}
