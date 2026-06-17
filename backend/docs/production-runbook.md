# NutraFit Production Runbook

Operational launch documents:

- [VPS deploy checklist](./vps-deploy-checklist.md)
- [Secrets checklist](./secrets-checklist.md)
- [Backup and restore drill](./backup-restore-drill.md)
- [Pilot launch checklist](./pilot-launch-checklist.md)
- [Pilot report template](./pilot-report-template.md)
- [Controlled pilot execution guide](./pilot-execution-guide.md)
- [VPS deploy execution report](./vps-deploy-execution-report.md)

## Prerequisites

- Node.js 22 LTS and npm 10+ for a PM2 deployment.
- Docker Engine with Docker Compose v2 for a container deployment.
- PostgreSQL 16.
- TLS termination and reverse proxy in front of port 3000.
- A production admin account for the authenticated smoke test.
- Secrets stored outside Git. Never commit `.env.production`.

Copy `.env.example` to `.env.production`, replace every placeholder, and review
all cost rates before deployment. The application exits during bootstrap when a
critical production variable is absent, unsafe, malformed, or outside its
accepted range.

## Required Environment

Core:

`NODE_ENV`, `RUNTIME_MODE`, `PORT`, `TRUST_PROXY_HOPS`, `DATABASE_URL`,
`PRISMA_MIGRATIONS_PATH`, `CORS_ALLOWED_ORIGINS`, `UPLOAD_PATH`.

Authentication:

`JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `JWT_ISSUER`, `JWT_AUDIENCE`.
JWT secrets must be different and contain at least 32 characters.

Providers:

`PAGBANK_API_URL`, `PAGBANK_TOKEN`, `PAGBANK_WEBHOOK_SECRET`,
`EVOLUTION_BASE_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE_NAME`,
`EVOLUTION_WEBHOOK_SECRET`, `OPENAI_API_KEY`, `OPENAI_MODEL_TEXT`,
`OPENAI_MODEL_VISION`.

Workers and retention:

`WORKER_POLL_MS`, `OUTBOX_WORKER_POLL_MS`, `AI_WORKER_POLL_MS`,
`AUTOMATION_WORKER_POLL_MS`, `WORKER_STALE_SECONDS`, `OUTBOX_BATCH_SIZE`,
`OUTBOX_LEASE_SECONDS`, `OUTBOX_MAX_ATTEMPTS`, `OUTBOX_RETRY_BASE_MS`,
`OUTBOX_RETRY_MAX_MS`, `OUTBOX_BACKLOG_WARNING_MINUTES`,
`OUTBOX_RETENTION_DAYS`, `WEBHOOK_RETENTION_DAYS`,
`SYSTEM_EVENT_RETENTION_DAYS`, `AUDIT_RETENTION_DAYS`,
`RETENTION_CLEANUP_INTERVAL_MS`, `RETENTION_CLEANUP_BATCH_SIZE`,
`WEBHOOK_LEASE_SECONDS`, `WEBHOOK_MAX_ATTEMPTS`, `AI_JOB_LEASE_SECONDS`,
`AI_RESERVATION_TTL_SECONDS`, `AI_RECOVERY_INTERVAL_MS`,
`EVOLUTION_INBOUND_LEASE_SECONDS`, `EVOLUTION_INBOUND_POLL_MS`,
`EVOLUTION_RECOVERY_INTERVAL_MS`, `EVOLUTION_SEND_LEASE_SECONDS`.

Limits and internal costs:

`BASIC_DAILY_IMAGE_LIMIT`, `PREMIUM_DAILY_IMAGE_LIMIT`,
`SUBSCRIPTION_GRACE_PERIOD_DAYS`, `MAX_IMAGE_SIZE_MB`, `MAX_AUDIO_SIZE_MB`,
`MAX_DOCUMENT_SIZE_MB`, all `OPENAI_*_COST_PER_1M_USD` values,
`ANALYTICS_USD_TO_BRL_RATE`, all `ANALYTICS_WHATSAPP_*_COST_BRL` values,
and `ANALYTICS_STORAGE_GB_MONTH_COST_BRL`.

Smoke:

`SMOKE_BASE_URL`, `SMOKE_ADMIN_EMAIL`, `SMOKE_ADMIN_PASSWORD`.

## Local Verification

```bash
npm ci
npm run prisma:generate
npm run build
npm run lint
npm run prisma:validate
npm test -- --runInBand
npm run test:e2e -- --runInBand
```

Start PostgreSQL, apply migrations, then run the API and each worker in separate
terminals:

```bash
npm run prisma:migrate
npm run start:prod
npm run start:worker:outbox
npm run start:worker:ai
npm run start:worker:automation
npm run smoke:test
```

The smoke test only calls the local NutraFit API. Provider readiness is checked
from configuration and no paid provider endpoint is called.

## VPS Deploy With PM2

1. Place `.env.production` outside version control and restrict its permissions.
2. Install dependencies and build before changing the running processes.
3. Back up PostgreSQL.
4. Apply migrations with `prisma migrate deploy`.
5. Start or reload PM2.
6. Check readiness and run the smoke test.

```bash
cd /srv/nutrafit
git pull --ff-only
cd /srv/nutrafit/backend
npm ci
npm run prisma:generate

set -a
. ./.env.production
set +a

npx prisma migrate deploy
npm run build
pm2 start ecosystem.config.js --update-env
pm2 save
curl --fail http://127.0.0.1:3000/api/v1/health/live
curl --fail http://127.0.0.1:3000/api/v1/health/ready
npm run smoke:test
```

For subsequent releases:

```bash
pm2 reload ecosystem.config.js --update-env
pm2 status
pm2 logs --lines 200
```

PM2 runs one API process and one process for each worker role. Do not increase
API instances until rate limiting is backed by shared state or the operational
tradeoff is explicitly accepted.

## VPS Deploy With Docker

Docker Compose binds the API to loopback and does not publish PostgreSQL.
Expose the API only through the TLS reverse proxy.

```bash
cd /srv/nutrafit
git pull --ff-only
cd /srv/nutrafit/backend
npm ci
npm run prisma:generate
npm run build
docker compose --env-file .env.production -f docker-compose.prod.yml build
docker compose --env-file .env.production -f docker-compose.prod.yml up -d postgres
docker compose --env-file .env.production -f docker-compose.prod.yml run --rm migrate npx prisma migrate deploy
docker compose --env-file .env.production -f docker-compose.prod.yml up -d
docker compose --env-file .env.production -f docker-compose.prod.yml ps
docker compose --env-file .env.production -f docker-compose.prod.yml logs --tail=200
docker compose --env-file .env.production -f docker-compose.prod.yml exec backend-api npm run smoke:test
curl --fail http://127.0.0.1:3000/api/v1/health/live
curl --fail http://127.0.0.1:3000/api/v1/health/ready
```

The one-shot `migrate` service must complete successfully before the API and
workers start. Its command is `npx prisma migrate deploy`. Do not run the PM2
and Docker topologies at the same time.

## Seed

Run the seed only for initial controlled provisioning or after reviewing its
idempotency against production data:

```bash
npm run prisma:seed
```

For Docker:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml run --rm migrate npm run prisma:seed
```

## Health Checks

- `GET /api/v1/health/live`: process liveness only.
- `GET /api/v1/health/ready`: database, migrations, workers, outbox, provider
  configuration, environment validation, and writable storage. Returns 503 when
  not ready and omits sensitive details.
- `GET /api/v1/admin/health`: the same checks with operational detail. Requires
  an ADMIN JWT.

A readiness failure is a deployment blocker. A degraded outbox indicates dead
letters or an old backlog and requires investigation before traffic is enabled.

## Worker Checks

```bash
pm2 status
pm2 logs nutrafit-worker-outbox --lines 100
pm2 logs nutrafit-worker-ai --lines 100
pm2 logs nutrafit-worker-automation --lines 100
```

With Docker:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml ps
docker compose --env-file .env.production -f docker-compose.prod.yml logs --tail=100 worker-outbox worker-ai worker-automation
```

Confirm `OUTBOX_WORKER`, `AI_WORKER`, and `AUTOMATION_WORKER` have recent
heartbeats in `/api/v1/admin/health`.

## PostgreSQL Backup

Create an encrypted off-host copy after the dump:

```bash
mkdir -p /srv/backups/nutrafit
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T postgres sh -c 'pg_dump --format=custom --no-owner -U "$POSTGRES_USER" "$POSTGRES_DB"' > /srv/backups/nutrafit/nutrafit-$(date +%Y%m%d-%H%M%S).dump
```

Verify the dump:

```bash
pg_restore --list /srv/backups/nutrafit/nutrafit-YYYYMMDD-HHMMSS.dump > /dev/null
```

## PostgreSQL Restore

Restore into a separate database first whenever possible. Stop API and workers
before an in-place restore.

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml stop backend-api worker-outbox worker-ai worker-automation
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T postgres sh -c 'dropdb --if-exists -U "$POSTGRES_USER" "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" "$POSTGRES_DB"'
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T postgres sh -c 'pg_restore --clean --if-exists --no-owner -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < /srv/backups/nutrafit/nutrafit-YYYYMMDD-HHMMSS.dump
docker compose --env-file .env.production -f docker-compose.prod.yml up -d
```

Run readiness and smoke immediately after restore.

## Basic Rollback

Prisma production migrations do not provide automatic down migrations.
Prefer a forward fix for schema failures.

1. Disable external traffic.
2. Stop API and workers.
3. If no incompatible migration was applied, deploy the previous image or Git
   revision and restart.
4. If an incompatible migration was applied, restore the pre-deploy backup or
   deploy a reviewed forward migration.
5. Run `npm run prisma:migrate:status`, readiness, and smoke before reopening
   traffic.

Never mark a failed migration as applied without verifying the database state
and keeping a written incident record.

## Logs And Incident Triage

Logs must not contain tokens, JWTs, webhook secrets, raw passwords, or provider
credentials.

```bash
pm2 logs --lines 300
pm2 monit
npm run prisma:migrate:status
```

Investigate in this order: process state, environment validation error,
database connectivity, migration status, worker heartbeat, outbox dead letters,
storage permissions, then provider configuration.
