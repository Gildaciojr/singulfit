import { Injectable } from '@nestjs/common';
import {
  AIJobStatus,
  OutboxStatus,
  OutboundMessageStatus,
  ScheduledMessageStatus,
  Severity,
  WebhookStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type CountGroup<T extends string> = Array<
  Record<T, string> & {
    _count: { _all: number };
  }
>;

@Injectable()
export class OperationalMetricsService {
  constructor(private readonly prisma: PrismaService) {}

  async getAll() {
    const [outbox, webhooks, ai, automation, evolution] = await Promise.all([
      this.getOutboxStats(),
      this.getWebhookStats(),
      this.getAIStats(),
      this.getAutomationStats(),
      this.getEvolutionStats(),
    ]);

    return {
      collectedAt: new Date().toISOString(),
      outbox,
      webhooks,
      ai,
      automation,
      evolution,
    };
  }

  async getOutboxStats() {
    const groups = await this.prisma.outboxEvent.groupBy({
      by: ['status'],
      _count: {
        _all: true,
      },
    });
    const counts = this.groupCounts(groups, 'status');

    return {
      pending: counts[OutboxStatus.PENDING] ?? 0,
      processing: counts[OutboxStatus.PROCESSING] ?? 0,
      processed: counts[OutboxStatus.PROCESSED] ?? 0,
      failed: counts[OutboxStatus.FAILED] ?? 0,
      deadLetter: counts[OutboxStatus.DEAD_LETTER] ?? 0,
    };
  }

  async getWebhookStats() {
    const groups = await this.prisma.webhookEvent.groupBy({
      by: ['status'],
      _count: {
        _all: true,
      },
    });
    const counts = this.groupCounts(groups, 'status');

    return {
      received: counts[WebhookStatus.RECEIVED] ?? 0,
      processing: counts[WebhookStatus.PROCESSING] ?? 0,
      processed: counts[WebhookStatus.PROCESSED] ?? 0,
      failed: counts[WebhookStatus.FAILED] ?? 0,
      ignored: counts[WebhookStatus.IGNORED] ?? 0,
    };
  }

  async getSystemEventStats() {
    const [total, severityGroups, sourceGroups] = await Promise.all([
      this.prisma.systemEvent.count(),
      this.prisma.systemEvent.groupBy({
        by: ['severity'],
        _count: {
          _all: true,
        },
      }),
      this.prisma.systemEvent.groupBy({
        by: ['source'],
        _count: {
          _all: true,
        },
        orderBy: {
          _count: {
            source: 'desc',
          },
        },
        take: 20,
      }),
    ]);
    const severity = this.groupCounts(severityGroups, 'severity');

    return {
      total,
      severity: {
        info: severity[Severity.INFO] ?? 0,
        warning: severity[Severity.WARNING] ?? 0,
        error: severity[Severity.ERROR] ?? 0,
        critical: severity[Severity.CRITICAL] ?? 0,
      },
      sources: sourceGroups.map((group) => ({
        source: group.source,
        count: group._count._all,
      })),
    };
  }

  private async getAIStats() {
    const [executions, failures, durations] = await Promise.all([
      this.prisma.aIJob.count({
        where: {
          attempts: {
            gt: 0,
          },
        },
      }),
      this.prisma.aIJob.count({
        where: {
          status: AIJobStatus.FAILED,
        },
      }),
      this.prisma.$queryRaw<Array<{ averageDurationMs: number | null }>>`
        SELECT
          AVG(
            EXTRACT(EPOCH FROM ("completedAt" - "startedAt")) * 1000
          )::double precision AS "averageDurationMs"
        FROM "ai_jobs"
        WHERE
          "status" = 'COMPLETED'::"AIJobStatus"
          AND "startedAt" IS NOT NULL
          AND "completedAt" IS NOT NULL
      `,
    ]);

    return {
      executions,
      failures,
      averageDurationMs: Math.round(durations[0]?.averageDurationMs ?? 0),
    };
  }

  private async getAutomationStats() {
    const groups = await this.prisma.scheduledMessage.groupBy({
      by: ['status'],
      _count: {
        _all: true,
      },
    });
    const counts = this.groupCounts(groups, 'status');

    return {
      scheduled: counts[ScheduledMessageStatus.PENDING] ?? 0,
      executed: counts[ScheduledMessageStatus.SENT] ?? 0,
      failed: counts[ScheduledMessageStatus.FAILED] ?? 0,
    };
  }

  private async getEvolutionStats() {
    const [inbound, outbound, media, inboundFailures, outboundFailures] =
      await Promise.all([
        this.prisma.evolutionInboundEvent.count(),
        this.prisma.outboundMessage.count(),
        this.prisma.mediaFile.count(),
        this.prisma.evolutionInboundEvent.count({
          where: {
            status: WebhookStatus.FAILED,
          },
        }),
        this.prisma.outboundMessage.count({
          where: {
            status: OutboundMessageStatus.FAILED,
          },
        }),
      ]);

    return {
      inbound,
      outbound,
      media,
      failures: inboundFailures + outboundFailures,
    };
  }

  private groupCounts<T extends string>(
    groups: CountGroup<T>,
    key: T,
  ): Record<string, number> {
    return Object.fromEntries(
      groups.map((group) => [group[key], group._count._all]),
    );
  }
}
