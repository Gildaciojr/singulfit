import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class OperationsConfigService {
  constructor(private readonly configService: ConfigService) {}

  get outboxRetentionDays(): number {
    return this.integer('OUTBOX_RETENTION_DAYS', 30, 1, 3_650);
  }

  get webhookRetentionDays(): number {
    return this.integer('WEBHOOK_RETENTION_DAYS', 90, 1, 3_650);
  }

  get systemEventRetentionDays(): number {
    return this.integer('SYSTEM_EVENT_RETENTION_DAYS', 90, 1, 3_650);
  }

  get auditRetentionDays(): number {
    return this.integer('AUDIT_RETENTION_DAYS', 365, 1, 3_650);
  }

  get cleanupIntervalMs(): number {
    return this.integer(
      'RETENTION_CLEANUP_INTERVAL_MS',
      3_600_000,
      60_000,
      86_400_000,
    );
  }

  get cleanupBatchSize(): number {
    return this.integer('RETENTION_CLEANUP_BATCH_SIZE', 1_000, 10, 10_000);
  }

  get workerStaleSeconds(): number {
    return this.integer('WORKER_STALE_SECONDS', 60, 10, 3_600);
  }

  get backlogWarningMinutes(): number {
    return this.integer('OUTBOX_BACKLOG_WARNING_MINUTES', 10, 1, 1_440);
  }

  configured(key: string): boolean {
    return Boolean(this.configService.get<string>(key)?.trim());
  }

  private integer(
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
}
