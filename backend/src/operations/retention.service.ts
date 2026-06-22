import { Injectable } from '@nestjs/common';
import { Prisma, Severity } from '@prisma/client';
import { EventService } from '../observability/event.service';
import { PrismaService } from '../prisma/prisma.service';
import { OperationsConfigService } from './operations-config.service';

const OPERATIONS_SOURCE = 'OPERATIONS';
const CLEANUP_EXECUTED = 'CLEANUP_EXECUTED';

interface CleanupCounts {
  outbox: number;
  webhooks: number;
  systemEvents: number;
  auditLogs: number;
}

@Injectable()
export class RetentionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: OperationsConfigService,
    private readonly eventService: EventService,
  ) {}

  async runIfDue(at = new Date()): Promise<CleanupCounts | null> {
    return this.prisma.$transaction(
      async (transaction) => {
        const [lock] = await transaction.$queryRaw<Array<{ locked: boolean }>>`
          SELECT pg_try_advisory_xact_lock(
            hashtext('singulfit:retention-cleanup')
          ) AS "locked"
        `;

        if (!lock?.locked) {
          return null;
        }

        const lastCleanup = await transaction.systemEvent.findFirst({
          where: {
            source: OPERATIONS_SOURCE,
            eventType: CLEANUP_EXECUTED,
          },
          select: {
            createdAt: true,
          },
          orderBy: {
            createdAt: 'desc',
          },
        });

        if (
          lastCleanup &&
          lastCleanup.createdAt.getTime() >
            at.getTime() - this.config.cleanupIntervalMs
        ) {
          return null;
        }

        const counts = await this.cleanupInTransaction(transaction, at);

        await this.eventService.recordInTransaction(transaction, {
          source: OPERATIONS_SOURCE,
          severity: Severity.INFO,
          eventType: CLEANUP_EXECUTED,
          message: 'Limpeza de retenção executada',
          metadata: {
            at: at.toISOString(),
            batchSize: this.config.cleanupBatchSize,
            counts: {
              outbox: counts.outbox,
              webhooks: counts.webhooks,
              systemEvents: counts.systemEvents,
              auditLogs: counts.auditLogs,
            },
          },
        });

        return counts;
      },
      {
        maxWait: 5_000,
        timeout: 30_000,
      },
    );
  }

  private async cleanupInTransaction(
    transaction: Prisma.TransactionClient,
    at: Date,
  ): Promise<CleanupCounts> {
    const batchSize = this.config.cleanupBatchSize;
    const outboxCutoff = this.cutoff(at, this.config.outboxRetentionDays);
    const webhookCutoff = this.cutoff(at, this.config.webhookRetentionDays);
    const systemEventCutoff = this.cutoff(
      at,
      this.config.systemEventRetentionDays,
    );
    const auditCutoff = this.cutoff(at, this.config.auditRetentionDays);

    const outbox = await transaction.$executeRaw`
      DELETE FROM "outbox_events"
      WHERE "id" IN (
        SELECT "id"
        FROM "outbox_events"
        WHERE
          "status" = 'PROCESSED'::"OutboxStatus"
          AND "processedAt" < ${outboxCutoff}
        ORDER BY "processedAt" ASC, "id" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${batchSize}
      )
    `;
    const webhooks = await transaction.$executeRaw`
      DELETE FROM "webhook_events"
      WHERE "id" IN (
        SELECT "id"
        FROM "webhook_events"
        WHERE
          "status" IN (
            'PROCESSED'::"WebhookStatus",
            'IGNORED'::"WebhookStatus"
          )
          AND "processedAt" < ${webhookCutoff}
        ORDER BY "processedAt" ASC, "id" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${batchSize}
      )
    `;
    const systemEvents = await transaction.$executeRaw`
      DELETE FROM "system_events"
      WHERE "id" IN (
        SELECT "id"
        FROM "system_events"
        WHERE "createdAt" < ${systemEventCutoff}
        ORDER BY "createdAt" ASC, "id" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${batchSize}
      )
    `;
    const auditLogs = await transaction.$executeRaw`
      DELETE FROM "audit_logs"
      WHERE "id" IN (
        SELECT "id"
        FROM "audit_logs"
        WHERE "createdAt" < ${auditCutoff}
        ORDER BY "createdAt" ASC, "id" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${batchSize}
      )
    `;

    return {
      outbox,
      webhooks,
      systemEvents,
      auditLogs,
    };
  }

  private cutoff(at: Date, retentionDays: number): Date {
    return new Date(at.getTime() - retentionDays * 86_400_000);
  }
}
