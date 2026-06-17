import {
  OutboxStatus,
  ScheduledMessageStatus,
  Severity,
  WebhookStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OperationalMetricsService } from './operational-metrics.service';

describe('OperationalMetricsService', () => {
  it('maps persisted statuses to the operational contract', async () => {
    const prisma = {
      outboxEvent: {
        groupBy: jest.fn().mockResolvedValue([
          { status: OutboxStatus.PENDING, _count: { _all: 2 } },
          { status: OutboxStatus.DEAD_LETTER, _count: { _all: 1 } },
        ]),
      },
      webhookEvent: {
        groupBy: jest.fn().mockResolvedValue([
          { status: WebhookStatus.RECEIVED, _count: { _all: 3 } },
          { status: WebhookStatus.IGNORED, _count: { _all: 4 } },
        ]),
      },
      systemEvent: {
        count: jest.fn().mockResolvedValue(5),
        groupBy: jest
          .fn()
          .mockResolvedValueOnce([
            { severity: Severity.WARNING, _count: { _all: 2 } },
          ])
          .mockResolvedValueOnce([{ source: 'OUTBOX', _count: { _all: 5 } }]),
      },
      aIJob: {
        count: jest.fn().mockResolvedValue(0),
      },
      scheduledMessage: {
        groupBy: jest.fn().mockResolvedValue([
          { status: ScheduledMessageStatus.PENDING, _count: { _all: 6 } },
          { status: ScheduledMessageStatus.SENT, _count: { _all: 7 } },
        ]),
      },
      evolutionInboundEvent: {
        count: jest.fn().mockResolvedValue(0),
      },
      outboundMessage: {
        count: jest.fn().mockResolvedValue(0),
      },
      mediaFile: {
        count: jest.fn().mockResolvedValue(0),
      },
      $queryRaw: jest.fn().mockResolvedValue([{ averageDurationMs: 1250.4 }]),
    };
    const service = new OperationalMetricsService(
      prisma as unknown as PrismaService,
    );

    await expect(service.getOutboxStats()).resolves.toEqual({
      pending: 2,
      processing: 0,
      processed: 0,
      failed: 0,
      deadLetter: 1,
    });
    await expect(service.getWebhookStats()).resolves.toEqual({
      received: 3,
      processing: 0,
      processed: 0,
      failed: 0,
      ignored: 4,
    });
    await expect(service.getSystemEventStats()).resolves.toEqual({
      total: 5,
      severity: {
        info: 0,
        warning: 2,
        error: 0,
        critical: 0,
      },
      sources: [{ source: 'OUTBOX', count: 5 }],
    });
  });
});
