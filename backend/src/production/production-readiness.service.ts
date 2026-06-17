import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OutboxStatus, WorkerStatus } from '@prisma/client';
import { access, mkdir, readdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve } from 'node:path';
import { WORKER_NAME } from '../event-bus/event-bus.constants';
import { PrismaService } from '../prisma/prisma.service';
import { collectEnvironmentIssues } from './environment.validation';
import { RUNTIME_MODE } from './runtime-mode';

export type ProductionCheckStatus = 'UP' | 'DEGRADED' | 'DOWN';

export interface ProductionCheck {
  status: ProductionCheckStatus;
  latencyMs: number;
  detail: Record<string, unknown>;
}

export interface ProductionReadiness {
  status: 'ok' | 'degraded' | 'down';
  checkedAt: string;
  checks: {
    database: ProductionCheck;
    migrations: ProductionCheck;
    workers: ProductionCheck;
    outbox: ProductionCheck;
    openai: ProductionCheck;
    evolution: ProductionCheck;
    pagbank: ProductionCheck;
    storage: ProductionCheck;
    configuration: ProductionCheck;
  };
}

@Injectable()
export class ProductionReadinessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async check(): Promise<ProductionReadiness> {
    const [
      database,
      migrations,
      workers,
      outbox,
      openai,
      evolution,
      pagbank,
      storage,
      configuration,
    ] = await Promise.all([
      this.measure(() => this.databaseCheck()),
      this.measure(() => this.migrationsCheck()),
      this.measure(() => this.workersCheck()),
      this.measure(() => this.outboxCheck()),
      this.measure(() =>
        this.configurationCheck([
          'OPENAI_API_KEY',
          'OPENAI_MODEL_TEXT',
          'OPENAI_MODEL_VISION',
        ]),
      ),
      this.measure(() =>
        this.configurationCheck([
          'EVOLUTION_BASE_URL',
          'EVOLUTION_API_KEY',
          'EVOLUTION_INSTANCE_NAME',
          'EVOLUTION_WEBHOOK_SECRET',
        ]),
      ),
      this.measure(() =>
        this.configurationCheck([
          'PAGBANK_API_URL',
          'PAGBANK_TOKEN',
          'PAGBANK_WEBHOOK_SECRET',
        ]),
      ),
      this.measure(() => this.storageCheck()),
      this.measure(() => this.environmentCheck()),
    ]);
    const checks = {
      database,
      migrations,
      workers,
      outbox,
      openai,
      evolution,
      pagbank,
      storage,
      configuration,
    };
    const values = Object.values(checks);
    const status = values.some((check) => check.status === 'DOWN')
      ? 'down'
      : values.some((check) => check.status === 'DEGRADED')
        ? 'degraded'
        : 'ok';

    return {
      status,
      checkedAt: new Date().toISOString(),
      checks,
    };
  }

  private async databaseCheck(): Promise<Omit<ProductionCheck, 'latencyMs'>> {
    await this.prisma.$queryRaw`SELECT 1`;

    return {
      status: 'UP',
      detail: {
        connected: true,
      },
    };
  }

  private async migrationsCheck(): Promise<Omit<ProductionCheck, 'latencyMs'>> {
    const migrationsPath = resolve(
      this.config.get<string>('PRISMA_MIGRATIONS_PATH', 'prisma/migrations'),
    );
    const entries = await readdir(migrationsPath, { withFileTypes: true });
    const expected = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    const applied = await this.prisma.$queryRaw<
      Array<{
        migrationName: string;
        finishedAt: Date | null;
        rolledBackAt: Date | null;
      }>
    >`
      SELECT
        migration_name AS "migrationName",
        finished_at AS "finishedAt",
        rolled_back_at AS "rolledBackAt"
      FROM "_prisma_migrations"
      ORDER BY migration_name ASC
    `;
    const successful = new Set(
      applied
        .filter(
          (migration) =>
            migration.finishedAt !== null && migration.rolledBackAt === null,
        )
        .map((migration) => migration.migrationName),
    );
    const pending = expected.filter((name) => !successful.has(name));
    const failed = applied
      .filter(
        (migration) =>
          migration.finishedAt === null && migration.rolledBackAt === null,
      )
      .map((migration) => migration.migrationName);

    return {
      status: pending.length === 0 && failed.length === 0 ? 'UP' : 'DOWN',
      detail: {
        expectedCount: expected.length,
        appliedCount: successful.size,
        pending,
        failed,
      },
    };
  }

  private async workersCheck(): Promise<Omit<ProductionCheck, 'latencyMs'>> {
    const staleSeconds = this.integer('WORKER_STALE_SECONDS', 60);
    const staleBefore = new Date(Date.now() - staleSeconds * 1_000);
    const workerNames = Object.values(WORKER_NAME);
    const records = await Promise.all(
      workerNames.map((workerName) =>
        this.prisma.workerHeartbeat.findFirst({
          where: { workerName },
          orderBy: { heartbeatAt: 'desc' },
        }),
      ),
    );
    const workers = workerNames.map((workerName, index) => {
      const record = records[index];
      const healthy =
        record?.status === WorkerStatus.RUNNING &&
        record.heartbeatAt >= staleBefore;

      return {
        workerName,
        status: healthy ? 'UP' : 'DOWN',
        instanceId: record?.instanceId ?? null,
        heartbeatAt: record?.heartbeatAt.toISOString() ?? null,
      };
    });

    return {
      status: workers.every((worker) => worker.status === 'UP') ? 'UP' : 'DOWN',
      detail: {
        staleSeconds,
        workers,
      },
    };
  }

  private async outboxCheck(): Promise<Omit<ProductionCheck, 'latencyMs'>> {
    const warningMinutes = this.integer('OUTBOX_BACKLOG_WARNING_MINUTES', 10);
    const [counts, oldest] = await Promise.all([
      this.prisma.outboxEvent.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
      this.prisma.outboxEvent.findFirst({
        where: {
          status: {
            in: [OutboxStatus.PENDING, OutboxStatus.FAILED],
          },
        },
        select: { availableAt: true },
        orderBy: { availableAt: 'asc' },
      }),
    ]);
    const byStatus = Object.fromEntries(
      counts.map((entry) => [entry.status, entry._count._all]),
    ) as Partial<Record<OutboxStatus, number>>;
    const backlogAgeMs = oldest
      ? Math.max(0, Date.now() - oldest.availableAt.getTime())
      : 0;
    const degraded = backlogAgeMs > warningMinutes * 60_000;

    return {
      status: degraded ? 'DEGRADED' : 'UP',
      detail: {
        pending: byStatus[OutboxStatus.PENDING] ?? 0,
        processing: byStatus[OutboxStatus.PROCESSING] ?? 0,
        failed: byStatus[OutboxStatus.FAILED] ?? 0,
        deadLetter: byStatus[OutboxStatus.DEAD_LETTER] ?? 0,
        oldestBacklogAgeMs: backlogAgeMs,
      },
    };
  }

  private configurationCheck(
    keys: string[],
  ): Promise<Omit<ProductionCheck, 'latencyMs'>> {
    const missing = keys.filter((key) => !this.config.get<string>(key)?.trim());

    return Promise.resolve({
      status: missing.length === 0 ? 'UP' : 'DOWN',
      detail: {
        configured: missing.length === 0,
        missing,
      },
    });
  }

  private async storageCheck(): Promise<Omit<ProductionCheck, 'latencyMs'>> {
    const configuredPath = this.config.get<string>('UPLOAD_PATH')?.trim();

    if (!configuredPath) {
      return {
        status: 'DOWN',
        detail: {
          configured: false,
          writable: false,
        },
      };
    }

    const absolutePath = resolve(configuredPath);
    await mkdir(absolutePath, { recursive: true });
    await access(absolutePath, constants.R_OK | constants.W_OK);

    return {
      status: 'UP',
      detail: {
        configured: true,
        writable: true,
        path: absolutePath,
      },
    };
  }

  private environmentCheck(): Promise<Omit<ProductionCheck, 'latencyMs'>> {
    const environment = this.configSnapshot();
    const issues = collectEnvironmentIssues(environment, RUNTIME_MODE.API);

    return Promise.resolve({
      status: issues.length === 0 ? 'UP' : 'DOWN',
      detail: {
        valid: issues.length === 0,
        issues,
      },
    });
  }

  private configSnapshot(): Record<string, unknown> {
    return new Proxy<Record<string, unknown>>(
      {},
      {
        get: (_target, key) =>
          typeof key === 'string' ? this.config.get<string>(key) : undefined,
      },
    );
  }

  private integer(key: string, fallback: number): number {
    const value = Number.parseInt(
      this.config.get<string>(key, String(fallback)),
      10,
    );

    if (!Number.isInteger(value)) {
      throw new Error(`${key} inválida`);
    }

    return value;
  }

  private async measure(
    operation: () => Promise<Omit<ProductionCheck, 'latencyMs'>>,
  ): Promise<ProductionCheck> {
    const startedAt = Date.now();

    try {
      return {
        ...(await operation()),
        latencyMs: Date.now() - startedAt,
      };
    } catch {
      return {
        status: 'DOWN',
        latencyMs: Date.now() - startedAt,
        detail: {
          available: false,
        },
      };
    }
  }
}
