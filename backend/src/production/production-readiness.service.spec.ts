import { ConfigService } from '@nestjs/config';
import { OutboxStatus, WorkerStatus } from '@prisma/client';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WORKER_NAME } from '../event-bus/event-bus.constants';
import { PrismaService } from '../prisma/prisma.service';
import { ProductionReadinessService } from './production-readiness.service';

describe('ProductionReadinessService', () => {
  let temporaryRoot: string;

  afterEach(async () => {
    jest.restoreAllMocks();

    if (temporaryRoot) {
      await rm(temporaryRoot, { force: true, recursive: true });
    }
  });

  it('checks production dependencies locally without provider calls', async () => {
    temporaryRoot = await mkdtemp(join(tmpdir(), 'nutrafit-readiness-'));
    const migrationsPath = join(temporaryRoot, 'migrations');
    const uploadPath = join(temporaryRoot, 'uploads');
    await mkdir(join(migrationsPath, '20260613000000_ready'), {
      recursive: true,
    });
    const now = new Date();
    const prisma = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([{ result: 1 }])
        .mockResolvedValueOnce([
          {
            migrationName: '20260613000000_ready',
            finishedAt: now,
            rolledBackAt: null,
          },
        ]),
      workerHeartbeat: {
        findFirst: jest.fn(({ where }: { where: { workerName: string } }) =>
          Promise.resolve({
            workerName: where.workerName,
            instanceId: `${where.workerName}-1`,
            status: WorkerStatus.RUNNING,
            heartbeatAt: now,
          }),
        ),
      },
      outboxEvent: {
        groupBy: jest.fn().mockResolvedValue([
          {
            status: OutboxStatus.DEAD_LETTER,
            _count: { _all: 3 },
          },
        ]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    const values = new Map<string, string>([
      ['PRISMA_MIGRATIONS_PATH', migrationsPath],
      ['UPLOAD_PATH', uploadPath],
      ['OPENAI_API_KEY', 'configured-openai-key'],
      ['OPENAI_MODEL_TEXT', 'text-model'],
      ['OPENAI_MODEL_VISION', 'vision-model'],
      ['EVOLUTION_BASE_URL', 'https://evolution.example.com'],
      ['EVOLUTION_API_KEY', 'configured-evolution-key'],
      ['EVOLUTION_INSTANCE_NAME', 'nutrafit'],
      ['EVOLUTION_WEBHOOK_SECRET', 'configured-evolution-secret'],
      ['PAGBANK_API_URL', 'https://pagbank.example.com'],
      ['PAGBANK_TOKEN', 'configured-pagbank-token'],
      ['PAGBANK_WEBHOOK_SECRET', 'configured-pagbank-secret'],
    ]);
    const config = {
      get: jest.fn(
        (key: string, fallback?: string) => values.get(key) ?? fallback,
      ),
    };
    const fetchSpy = jest.spyOn(global, 'fetch');
    const service = new ProductionReadinessService(
      prisma as unknown as PrismaService,
      config as unknown as ConfigService,
    );

    const result = await service.check();

    expect(result.status).toBe('ok');
    expect(result.checks.migrations.status).toBe('UP');
    expect(result.checks.outbox.status).toBe('UP');
    expect(result.checks.outbox.detail.deadLetter).toBe(3);
    expect(result.checks.workers.detail.workers).toHaveLength(
      Object.keys(WORKER_NAME).length,
    );
    expect(result.checks.storage.status).toBe('UP');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('marks readiness down when a required worker is stale', async () => {
    temporaryRoot = await mkdtemp(join(tmpdir(), 'nutrafit-readiness-'));
    const migrationsPath = join(temporaryRoot, 'migrations');
    await mkdir(join(migrationsPath, '20260613000000_ready'), {
      recursive: true,
    });
    const now = new Date();
    const stale = new Date(now.getTime() - 120_000);
    const prisma = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([{ result: 1 }])
        .mockResolvedValueOnce([
          {
            migrationName: '20260613000000_ready',
            finishedAt: now,
            rolledBackAt: null,
          },
        ]),
      workerHeartbeat: {
        findFirst: jest.fn().mockResolvedValue({
          instanceId: 'stale-worker',
          status: WorkerStatus.RUNNING,
          heartbeatAt: stale,
        }),
      },
      outboxEvent: {
        groupBy: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    const values = new Map<string, string>([
      ['PRISMA_MIGRATIONS_PATH', migrationsPath],
      ['UPLOAD_PATH', join(temporaryRoot, 'uploads')],
      ['OPENAI_API_KEY', 'configured-openai-key'],
      ['OPENAI_MODEL_TEXT', 'text-model'],
      ['OPENAI_MODEL_VISION', 'vision-model'],
      ['EVOLUTION_BASE_URL', 'https://evolution.example.com'],
      ['EVOLUTION_API_KEY', 'configured-evolution-key'],
      ['EVOLUTION_INSTANCE_NAME', 'nutrafit'],
      ['EVOLUTION_WEBHOOK_SECRET', 'configured-evolution-secret'],
      ['PAGBANK_API_URL', 'https://pagbank.example.com'],
      ['PAGBANK_TOKEN', 'configured-pagbank-token'],
      ['PAGBANK_WEBHOOK_SECRET', 'configured-pagbank-secret'],
      ['WORKER_STALE_SECONDS', '60'],
    ]);
    const config = {
      get: jest.fn(
        (key: string, fallback?: string) => values.get(key) ?? fallback,
      ),
    };
    const service = new ProductionReadinessService(
      prisma as unknown as PrismaService,
      config as unknown as ConfigService,
    );

    const result = await service.check();

    expect(result.status).toBe('down');
    expect(result.checks.workers.status).toBe('DOWN');
  });
});
