import {
  OutboxStatus,
  PrismaClient,
  Severity,
  WorkerStatus,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { WORKER_NAME } from './event-bus/event-bus.constants';
import { validateEnvironment } from './production/environment.validation';
import { RUNTIME_MODE } from './production/runtime-mode';

interface LoginResponse {
  tokens?: {
    accessToken?: string;
    refreshToken?: string;
  };
}

interface HealthResponse {
  status?: string;
}

class SmokeRollback extends Error {}

const prisma = new PrismaClient();

async function main(): Promise<void> {
  validateEnvironment(
    {
      ...process.env,
      RUNTIME_MODE: RUNTIME_MODE.API,
    },
    RUNTIME_MODE.API,
  );

  const baseUrl = new URL(
    process.env.SMOKE_BASE_URL?.trim() || 'http://127.0.0.1:3000',
  ).origin;
  const adminEmail = required('SMOKE_ADMIN_EMAIL');
  const adminPassword = required('SMOKE_ADMIN_PASSWORD');
  const runId = randomUUID();

  await prisma.$connect();
  await recordSmokeEvent('SMOKE_TEST_STARTED', 'Smoke test iniciado', runId, {
    baseUrl,
  });

  try {
    await prisma.$queryRaw`SELECT 1`;
    await assertMigrationsApplied();
    await assertWorkerHeartbeats();
    await assertOutboxClaim();

    const live = await request<HealthResponse>(`${baseUrl}/api/v1/health/live`);
    assert(live.status === 'ok', 'health live não retornou status ok');

    const ready = await request<HealthResponse>(
      `${baseUrl}/api/v1/health/ready`,
    );
    assert(ready.status === 'ok', 'health ready não retornou status ok');

    const login = await request<LoginResponse>(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        email: adminEmail,
        password: adminPassword,
      }),
    });
    const accessToken = login.tokens?.accessToken;
    const refreshToken = login.tokens?.refreshToken;
    assert(accessToken, 'login administrativo não retornou access token');

    const adminHealth = await request<HealthResponse>(
      `${baseUrl}/api/v1/admin/health`,
      {
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      },
    );
    assert(adminHealth.status === 'ok', 'admin health não retornou status ok');

    if (refreshToken) {
      await request(`${baseUrl}/api/v1/auth/logout`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({ refreshToken }),
      });
    }

    await recordSmokeEvent(
      'SMOKE_TEST_PASSED',
      'Smoke test concluído com sucesso',
      runId,
      { baseUrl },
    );
  } catch (error: unknown) {
    await recordSmokeEvent(
      'SMOKE_TEST_FAILED',
      'Smoke test falhou',
      runId,
      {
        baseUrl,
        error: error instanceof Error ? error.message.slice(0, 1_000) : 'Erro',
      },
      Severity.ERROR,
    );
    throw error;
  }

  console.log(
    'Smoke OK: banco, Prisma, migrations, workers, outbox, health e configurações.',
  );
}

function recordSmokeEvent(
  eventType: string,
  message: string,
  runId: string,
  metadata: Record<string, string>,
  severity: Severity = Severity.INFO,
) {
  return prisma.systemEvent.create({
    data: {
      source: 'PRODUCTION_SMOKE',
      severity,
      eventType,
      message,
      metadata: {
        runId,
        ...metadata,
      },
    },
  });
}

async function assertMigrationsApplied(): Promise<void> {
  const migrationsPath = resolve(
    process.env.PRISMA_MIGRATIONS_PATH?.trim() || 'prisma/migrations',
  );
  const entries = await readdir(migrationsPath, { withFileTypes: true });
  const expected = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  const applied = await prisma.$queryRaw<
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
  `;
  const successful = new Set(
    applied
      .filter(
        (migration) =>
          migration.finishedAt !== null && migration.rolledBackAt === null,
      )
      .map((migration) => migration.migrationName),
  );
  const pending = expected.filter((migration) => !successful.has(migration));
  const failed = applied.filter(
    (migration) =>
      migration.finishedAt === null && migration.rolledBackAt === null,
  );

  assert(pending.length === 0, `migrations pendentes: ${pending.join(', ')}`);
  assert(failed.length === 0, 'existem migrations com falha');
}

async function assertWorkerHeartbeats(): Promise<void> {
  const staleSeconds = integerEnvironment('WORKER_STALE_SECONDS');
  const staleBefore = new Date(Date.now() - staleSeconds * 1_000);

  for (const workerName of Object.values(WORKER_NAME)) {
    const heartbeat = await prisma.workerHeartbeat.findFirst({
      where: { workerName },
      orderBy: { heartbeatAt: 'desc' },
    });

    assert(heartbeat, `heartbeat ausente para ${workerName}`);
    assert(
      heartbeat.status === WorkerStatus.RUNNING &&
        heartbeat.heartbeatAt >= staleBefore,
      `worker indisponível ou stale: ${workerName}`,
    );
  }
}

async function assertOutboxClaim(): Promise<void> {
  const eventId = randomUUID();
  let claimed = false;

  try {
    await prisma.$transaction(async (transaction) => {
      await transaction.outboxEvent.create({
        data: {
          id: eventId,
          eventType: 'PRODUCTION_SMOKE_TEST',
          aggregateType: 'SMOKE_TEST',
          aggregateId: randomUUID(),
          payload: {
            smoke: true,
          },
        },
      });
      const events = await transaction.$queryRaw<Array<{ id: string }>>`
        WITH candidate AS (
          SELECT "id"
          FROM "outbox_events"
          WHERE
            "id" = ${eventId}
            AND "status" = 'PENDING'::"OutboxStatus"
          FOR UPDATE SKIP LOCKED
        )
        UPDATE "outbox_events" AS event
        SET
          "status" = 'PROCESSING'::"OutboxStatus",
          "attempts" = event."attempts" + 1,
          "claimedAt" = NOW(),
          "updatedAt" = NOW()
        FROM candidate
        WHERE event."id" = candidate."id"
        RETURNING event."id"
      `;

      claimed =
        events.length === 1 &&
        events[0]?.id === eventId &&
        (
          await transaction.outboxEvent.findUniqueOrThrow({
            where: { id: eventId },
            select: { status: true },
          })
        ).status === OutboxStatus.PROCESSING;

      throw new SmokeRollback('rollback do evento de smoke');
    });
  } catch (error: unknown) {
    if (!(error instanceof SmokeRollback)) {
      throw error;
    }
  }

  assert(claimed, 'claim transacional do outbox falhou');
}

async function request<T = Record<string, unknown>>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(10_000),
  });
  const body = await response.text();

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} em ${url}: ${body.slice(0, 500)}`);
  }

  return (body ? JSON.parse(body) : {}) as T;
}

function required(key: string): string {
  const value = process.env[key]?.trim();

  if (!value) {
    throw new Error(`${key} é obrigatória para o smoke test`);
  }

  return value;
}

function integerEnvironment(key: string): number {
  const value = Number.parseInt(required(key), 10);

  if (!Number.isInteger(value)) {
    throw new Error(`${key} deve ser inteira`);
  }

  return value;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

void main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Smoke falhou: ${message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
