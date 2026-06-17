import {
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { OutboxEvent, OutboxStatus, Prisma, Severity } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { AuditService } from '../observability/audit.service';
import { EventService } from '../observability/event.service';
import { PrismaService } from '../prisma/prisma.service';
import { ListOutboxEventsDto } from './dto/list-outbox-events.dto';
import { OUTBOX_SOURCE, OUTBOX_SYSTEM_EVENT } from './event-bus.constants';

export interface ClaimedOutboxEvent extends OutboxEvent {
  previousStatus: OutboxStatus;
  previousClaimedAt: Date | null;
}

@Injectable()
export class OutboxService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly eventService: EventService,
    private readonly auditService: AuditService,
  ) {}

  async claimBatch(
    at = new Date(),
    eventTypes?: readonly string[],
  ): Promise<ClaimedOutboxEvent[]> {
    const leaseExpiredBefore = new Date(at.getTime() - this.getLeaseMs());
    const batchSize = this.getBatchSize();
    const maxAttempts = this.getMaxAttempts();
    const eventTypeFilter =
      eventTypes && eventTypes.length > 0
        ? Prisma.sql`AND "eventType" IN (${Prisma.join(eventTypes)})`
        : Prisma.empty;

    return this.prisma.$transaction(async (transaction) => {
      const exhausted = await transaction.$queryRaw<OutboxEvent[]>`
        WITH candidates AS (
          SELECT "id"
          FROM "outbox_events"
          WHERE
            "attempts" >= ${maxAttempts}
            ${eventTypeFilter}
            AND (
              (
                "status" IN (
                  'PENDING'::"OutboxStatus",
                  'FAILED'::"OutboxStatus"
                )
                AND "availableAt" <= ${at}
              )
              OR (
                "status" = 'PROCESSING'::"OutboxStatus"
                AND "claimedAt" <= ${leaseExpiredBefore}
              )
            )
          ORDER BY "availableAt" ASC, "createdAt" ASC, "id" ASC
          FOR UPDATE SKIP LOCKED
          LIMIT ${batchSize}
        )
        UPDATE "outbox_events" AS event
        SET
          "status" = 'DEAD_LETTER'::"OutboxStatus",
          "claimedAt" = NULL,
          "failedAt" = ${at},
          "lastError" = COALESCE(
            event."lastError",
            'Lease expirado após esgotar as tentativas'
          ),
          "updatedAt" = ${at}
        FROM candidates
        WHERE event."id" = candidates."id"
        RETURNING event.*
      `;

      for (const event of exhausted) {
        await this.eventService.recordInTransaction(transaction, {
          source: OUTBOX_SOURCE,
          severity: Severity.CRITICAL,
          eventType: OUTBOX_SYSTEM_EVENT.DEAD_LETTER,
          message: 'Evento com lease expirado movido para dead letter',
          metadata: this.eventMetadata(event),
        });
      }

      const events = await transaction.$queryRaw<ClaimedOutboxEvent[]>`
        WITH candidates AS (
          SELECT
            "id",
            "status",
            "claimedAt"
          FROM "outbox_events"
          WHERE
            "attempts" < ${maxAttempts}
            ${eventTypeFilter}
            AND (
              (
                "status" IN (
                  'PENDING'::"OutboxStatus",
                  'FAILED'::"OutboxStatus"
                )
                AND "availableAt" <= ${at}
              )
              OR (
                "status" = 'PROCESSING'::"OutboxStatus"
                AND "claimedAt" <= ${leaseExpiredBefore}
              )
            )
          ORDER BY "availableAt" ASC, "createdAt" ASC, "id" ASC
          FOR UPDATE SKIP LOCKED
          LIMIT ${batchSize}
        ),
        claimed AS (
          UPDATE "outbox_events" AS event
          SET
            "status" = 'PROCESSING'::"OutboxStatus",
            "attempts" = event."attempts" + 1,
            "claimedAt" = ${at},
            "failedAt" = NULL,
            "lastError" = NULL,
            "updatedAt" = ${at}
          FROM candidates
          WHERE event."id" = candidates."id"
          RETURNING event.*
        )
        SELECT
          claimed.*,
          candidates."status" AS "previousStatus",
          candidates."claimedAt" AS "previousClaimedAt"
        FROM claimed
        JOIN candidates ON candidates."id" = claimed."id"
      `;

      for (const event of events) {
        if (event.previousStatus === OutboxStatus.PROCESSING) {
          await this.eventService.recordInTransaction(transaction, {
            source: OUTBOX_SOURCE,
            severity: Severity.WARNING,
            eventType: OUTBOX_SYSTEM_EVENT.LEASE_EXPIRED,
            message: 'Evento recuperado após expiração do lease',
            metadata: this.eventMetadata(event, {
              previousClaimedAt: event.previousClaimedAt?.toISOString() ?? null,
            }),
          });
        }

        if (event.previousStatus === OutboxStatus.FAILED) {
          await this.eventService.recordInTransaction(transaction, {
            source: OUTBOX_SOURCE,
            severity: Severity.INFO,
            eventType: OUTBOX_SYSTEM_EVENT.RETRY_EXECUTED,
            message: 'Retry de evento iniciado',
            metadata: this.eventMetadata(event),
          });
        }
      }

      return events;
    });
  }

  async markProcessed(event: OutboxEvent): Promise<boolean> {
    const result = await this.prisma.outboxEvent.updateMany({
      where: this.claimFence(event),
      data: {
        status: OutboxStatus.PROCESSED,
        processedAt: new Date(),
        claimedAt: null,
        failedAt: null,
        lastError: null,
      },
    });

    return result.count === 1;
  }

  async markIgnored(event: OutboxEvent): Promise<boolean> {
    return this.prisma.$transaction(async (transaction) => {
      const result = await transaction.outboxEvent.updateMany({
        where: this.claimFence(event),
        data: {
          status: OutboxStatus.PROCESSED,
          processedAt: new Date(),
          claimedAt: null,
          failedAt: null,
          lastError: null,
        },
      });

      if (result.count === 1) {
        await this.eventService.recordInTransaction(transaction, {
          source: OUTBOX_SOURCE,
          severity: Severity.INFO,
          eventType: OUTBOX_SYSTEM_EVENT.EVENT_IGNORED,
          message: 'Evento sem consumidor registrado foi ignorado',
          metadata: this.eventMetadata(event),
        });
      }

      return result.count === 1;
    });
  }

  async markFailed(event: OutboxEvent, error: unknown): Promise<boolean> {
    const failedAt = new Date();
    const lastError = this.safeError(error);
    const deadLetter = event.attempts >= this.getMaxAttempts();
    const nextAvailableAt = deadLetter
      ? event.availableAt
      : new Date(failedAt.getTime() + this.retryDelayMs(event.attempts));

    return this.prisma.$transaction(async (transaction) => {
      const result = await transaction.outboxEvent.updateMany({
        where: this.claimFence(event),
        data: {
          status: deadLetter ? OutboxStatus.DEAD_LETTER : OutboxStatus.FAILED,
          availableAt: nextAvailableAt,
          claimedAt: null,
          failedAt,
          lastError,
        },
      });

      if (result.count !== 1) {
        return false;
      }

      await this.eventService.recordInTransaction(transaction, {
        source: OUTBOX_SOURCE,
        severity: deadLetter ? Severity.CRITICAL : Severity.WARNING,
        eventType: deadLetter
          ? OUTBOX_SYSTEM_EVENT.DEAD_LETTER
          : OUTBOX_SYSTEM_EVENT.RETRY_SCHEDULED,
        message: deadLetter
          ? 'Evento movido para dead letter após falha permanente'
          : 'Retry exponencial agendado para evento',
        metadata: this.eventMetadata(event, {
          lastError,
          nextAvailableAt: deadLetter ? null : nextAvailableAt.toISOString(),
        }),
      });

      return true;
    });
  }

  async retry(eventId: string, adminUserId: string) {
    return this.prisma.$transaction(async (transaction) => {
      const event = await transaction.outboxEvent.findUnique({
        where: {
          id: eventId,
        },
      });

      if (!event) {
        throw new NotFoundException('Evento de outbox não encontrado');
      }

      if (
        event.status !== OutboxStatus.FAILED &&
        event.status !== OutboxStatus.DEAD_LETTER
      ) {
        throw new ConflictException(
          'Somente eventos falhos ou em dead letter podem ser reenfileirados',
        );
      }

      const recovered = await transaction.outboxEvent.update({
        where: {
          id: event.id,
        },
        data: {
          status: OutboxStatus.PENDING,
          attempts: 0,
          availableAt: new Date(),
          claimedAt: null,
          processedAt: null,
          failedAt: null,
          lastError: null,
        },
      });

      await this.eventService.recordInTransaction(transaction, {
        source: OUTBOX_SOURCE,
        severity: Severity.INFO,
        eventType: OUTBOX_SYSTEM_EVENT.EVENT_RECOVERED,
        message: 'Evento reenfileirado manualmente',
        metadata: this.eventMetadata(recovered, {
          adminUserId,
          previousStatus: event.status,
        }),
      });
      await this.auditService.recordInTransaction(transaction, {
        userId: adminUserId,
        action: 'OUTBOX_RETRIED',
        entityType: 'OUTBOX_EVENT',
        entityId: event.id,
        metadata: {
          eventType: event.eventType,
          previousStatus: event.status,
        },
      });

      return recovered;
    });
  }

  async list(query: ListOutboxEventsDto) {
    const records = await this.prisma.outboxEvent.findMany({
      where: {
        eventType: query.eventType,
        aggregateType: query.aggregateType,
        status: query.status,
        createdAt: this.dateRange(query.from, query.to),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      cursor: query.cursor ? { id: query.cursor } : undefined,
      skip: query.cursor ? 1 : undefined,
      take: query.limit + 1,
    });
    const hasMore = records.length > query.limit;
    const items = hasMore ? records.slice(0, query.limit) : records;

    return {
      items,
      nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
    };
  }

  private claimFence(event: OutboxEvent): Prisma.OutboxEventWhereInput {
    if (!event.claimedAt) {
      throw new ConflictException('Evento não possui claim ativo');
    }

    return {
      id: event.id,
      status: OutboxStatus.PROCESSING,
      claimedAt: event.claimedAt,
    };
  }

  private eventMetadata(
    event: Pick<
      OutboxEvent,
      'id' | 'eventType' | 'aggregateType' | 'aggregateId' | 'attempts'
    >,
    extra: Prisma.InputJsonObject = {},
  ): Prisma.InputJsonObject {
    return {
      outboxEventId: event.id,
      eventType: event.eventType,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      attempts: event.attempts,
      ...extra,
    };
  }

  private dateRange(
    from?: string,
    to?: string,
  ): Prisma.DateTimeFilter | undefined {
    if (!from && !to) {
      return undefined;
    }

    return {
      gte: from ? new Date(from) : undefined,
      lte: to ? new Date(to) : undefined,
    };
  }

  private retryDelayMs(attempts: number): number {
    const exponent = Math.max(0, attempts - 1);
    return Math.min(
      this.getRetryBaseMs() * 2 ** exponent,
      this.getRetryMaxMs(),
    );
  }

  private getBatchSize(): number {
    return this.integerConfig('OUTBOX_BATCH_SIZE', 20, 1, 100);
  }

  private getLeaseMs(): number {
    return this.integerConfig('OUTBOX_LEASE_SECONDS', 120, 30, 3600) * 1_000;
  }

  private getMaxAttempts(): number {
    return this.integerConfig('OUTBOX_MAX_ATTEMPTS', 10, 1, 100);
  }

  private getRetryBaseMs(): number {
    return this.integerConfig('OUTBOX_RETRY_BASE_MS', 1_000, 100, 3_600_000);
  }

  private getRetryMaxMs(): number {
    return this.integerConfig(
      'OUTBOX_RETRY_MAX_MS',
      300_000,
      this.getRetryBaseMs(),
      86_400_000,
    );
  }

  private integerConfig(
    key: string,
    fallback: number,
    min: number,
    max: number,
  ): number {
    const value = Number.parseInt(
      this.configService.get<string>(key, String(fallback)),
      10,
    );

    if (!Number.isInteger(value) || value < min || value > max) {
      throw new ServiceUnavailableException(`${key} possui valor inválido`);
    }

    return value;
  }

  private safeError(error: unknown): string {
    if (error instanceof Error && error.message.trim()) {
      return error.message.trim().slice(0, 2_000);
    }

    return 'Falha não identificada no processamento do evento';
  }
}
