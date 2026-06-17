import {
  ConflictException,
  Injectable,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, UsageEventStatus } from '@prisma/client';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import { PrismaService } from '../prisma/prisma.service';
import {
  IMAGE_ANALYSIS_DAILY,
  IMAGE_ANALYSIS_ENTITLEMENTS,
  IMAGE_ANALYSIS_MONTHLY,
  ImageAnalysisEntitlementCode,
} from './entitlement.constants';
import { EntitlementsService } from './entitlements.service';
import { UsageLimitExceededException } from './usage-limit.exception';

dayjs.extend(utc);
dayjs.extend(timezone);

const BUSINESS_TIME_ZONE = 'America/Sao_Paulo';

export interface ReserveImageAnalysisInput {
  userId: string;
  aiJobId: string;
  quantity?: number;
  at?: Date;
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
    const quantity = input.quantity ?? 1;

    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new ConflictException('Quantidade de reserva inválida');
    }

    await this.lockUser(transaction, input.userId);

    const existingEvents = await transaction.usageEvent.findMany({
      where: {
        aiJobId: input.aiJobId,
        entitlementCode: {
          in: [...IMAGE_ANALYSIS_ENTITLEMENTS],
        },
      },
      orderBy: {
        entitlementCode: 'asc',
      },
    });

    if (existingEvents.length > 0) {
      if (
        existingEvents.length === IMAGE_ANALYSIS_ENTITLEMENTS.length &&
        existingEvents.every(
          (event) =>
            event.userId === input.userId &&
            event.quantity === quantity &&
            event.status !== UsageEventStatus.REVERSED,
        )
      ) {
        return existingEvents;
      }

      throw new ConflictException('Reserva de uso inconsistente para o job');
    }

    const at = input.at ?? new Date();
    const expiresAt = new Date(at.getTime() + this.getReservationTtlMs());
    const limits = await this.entitlementsService.getForUserInTransaction(
      transaction,
      input.userId,
      [...IMAGE_ANALYSIS_ENTITLEMENTS],
      at,
    );
    const events: Prisma.UsageEventGetPayload<object>[] = [];

    for (const entitlementCode of IMAGE_ANALYSIS_ENTITLEMENTS) {
      const limit = limits.get(entitlementCode);

      if (limit === undefined) {
        throw new ConflictException('Limite do entitlement não encontrado');
      }

      const period = this.getPeriod(entitlementCode, at);
      const bucket = await transaction.usageBucket.upsert({
        where: {
          userId_entitlementCode_periodStart_periodEnd: {
            userId: input.userId,
            entitlementCode,
            periodStart: period.start,
            periodEnd: period.end,
          },
        },
        update: {},
        create: {
          userId: input.userId,
          entitlementCode,
          periodStart: period.start,
          periodEnd: period.end,
        },
      });

      if (bucket.used + bucket.reserved + quantity > limit) {
        throw new UsageLimitExceededException(entitlementCode, limit);
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
      events.push(
        await transaction.usageEvent.create({
          data: {
            userId: input.userId,
            aiJobId: input.aiJobId,
            entitlementCode,
            quantity,
            status: UsageEventStatus.RESERVED,
            expiresAt,
          },
        }),
      );
    }

    return events;
  }

  private getPeriod(code: ImageAnalysisEntitlementCode, at: Date) {
    const local = dayjs(at).tz(BUSINESS_TIME_ZONE);
    const start =
      code === IMAGE_ANALYSIS_DAILY
        ? local.startOf('day')
        : local.startOf('month');
    const end =
      code === IMAGE_ANALYSIS_MONTHLY
        ? start.add(1, 'month')
        : start.add(1, 'day');

    return {
      start: start.toDate(),
      end: end.toDate(),
    };
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
}
