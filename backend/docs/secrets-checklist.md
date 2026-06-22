# SingulFit Secrets And Environment Checklist

This document lists production environment inputs without values. Keep the real
`.env.production` out of Git, restrict it to `0600`, and rotate any value that
has been exposed. Sections describe operational ownership; the application uses
one shared production environment and validates the complete set for API and
worker boot.

## API And Core

- [ ] `NODE_ENV` (`production`)
- [ ] `RUNTIME_MODE` (`API` for the API; Compose overrides workers)
- [ ] `PORT`
- [ ] `TRUST_PROXY_HOPS`
- [ ] `DATABASE_URL`
- [ ] `PRISMA_MIGRATIONS_PATH`
- [ ] `CORS_ALLOWED_ORIGINS`
- [ ] `JWT_ACCESS_SECRET` (unique, random, at least 32 characters)
- [ ] `JWT_REFRESH_SECRET` (different from access secret, at least 32 characters)
- [ ] `JWT_ISSUER`
- [ ] `JWT_AUDIENCE`
- [ ] `BASIC_DAILY_IMAGE_LIMIT`
- [ ] `PREMIUM_DAILY_IMAGE_LIMIT`
- [ ] `SUBSCRIPTION_GRACE_PERIOD_DAYS`

## Workers And Retention

- [ ] `NODE_ENV`
- [ ] `RUNTIME_MODE` (`WORKER`)
- [ ] `WORKER_ROLE` (`OUTBOX`, `AI`, or `AUTOMATION`)
- [ ] `DATABASE_URL`
- [ ] `WORKER_POLL_MS`
- [ ] `OUTBOX_WORKER_POLL_MS`
- [ ] `AI_WORKER_POLL_MS`
- [ ] `AUTOMATION_WORKER_POLL_MS`
- [ ] `WORKER_STALE_SECONDS`
- [ ] `OUTBOX_BATCH_SIZE`
- [ ] `OUTBOX_LEASE_SECONDS`
- [ ] `OUTBOX_MAX_ATTEMPTS`
- [ ] `OUTBOX_RETRY_BASE_MS`
- [ ] `OUTBOX_RETRY_MAX_MS`
- [ ] `OUTBOX_BACKLOG_WARNING_MINUTES`
- [ ] `OUTBOX_RETENTION_DAYS`
- [ ] `WEBHOOK_RETENTION_DAYS`
- [ ] `SYSTEM_EVENT_RETENTION_DAYS`
- [ ] `AUDIT_RETENTION_DAYS`
- [ ] `RETENTION_CLEANUP_INTERVAL_MS`
- [ ] `RETENTION_CLEANUP_BATCH_SIZE`

`WORKER_INSTANCE_ID` is optional. When omitted, the runtime generates a unique
identity from hostname, process ID, and a UUID.

## PagBank

- [ ] `PAGBANK_API_URL` (HTTPS in production)
- [ ] `PAGBANK_TOKEN`
- [ ] `PAGBANK_WEBHOOK_SECRET`
- [ ] `WEBHOOK_LEASE_SECONDS`
- [ ] `WEBHOOK_MAX_ATTEMPTS`

Confirm whether the pilot is using sandbox or production. Token, URL, webhook
registration, and webhook secret must all belong to the same environment.

## Evolution

- [ ] `EVOLUTION_BASE_URL` (HTTPS in production)
- [ ] `EVOLUTION_API_KEY`
- [ ] `EVOLUTION_INSTANCE_NAME`
- [ ] `EVOLUTION_WEBHOOK_SECRET`
- [ ] `EVOLUTION_INBOUND_LEASE_SECONDS`
- [ ] `EVOLUTION_INBOUND_POLL_MS`
- [ ] `EVOLUTION_RECOVERY_INTERVAL_MS`
- [ ] `EVOLUTION_SEND_LEASE_SECONDS`

## OpenAI

- [ ] `OPENAI_API_KEY`
- [ ] `OPENAI_MODEL_TEXT`
- [ ] `OPENAI_MODEL_VISION`
- [ ] `AI_JOB_LEASE_SECONDS`
- [ ] `AI_RESERVATION_TTL_SECONDS`
- [ ] `AI_RECOVERY_INTERVAL_MS`

Use explicitly approved model identifiers and confirm account limits before the
pilot.

## Storage

- [ ] `UPLOAD_PATH` (absolute path in production)
- [ ] `MAX_IMAGE_SIZE_MB`
- [ ] `MAX_AUDIO_SIZE_MB`
- [ ] `MAX_DOCUMENT_SIZE_MB`

Local storage is not suitable for horizontal scaling. Back up uploads
separately from PostgreSQL, keep one writer, monitor disk usage, and plan a
future migration to S3-compatible object storage before horizontal expansion.

## Costs And Analytics

- [ ] `OPENAI_TEXT_INPUT_COST_PER_1M_USD`
- [ ] `OPENAI_TEXT_OUTPUT_COST_PER_1M_USD`
- [ ] `OPENAI_VISION_INPUT_COST_PER_1M_USD`
- [ ] `OPENAI_VISION_OUTPUT_COST_PER_1M_USD`
- [ ] `ANALYTICS_USD_TO_BRL_RATE`
- [ ] `ANALYTICS_WHATSAPP_INBOUND_COST_BRL`
- [ ] `ANALYTICS_WHATSAPP_RESPONSE_COST_BRL`
- [ ] `ANALYTICS_WHATSAPP_AUTOMATION_COST_BRL`
- [ ] `ANALYTICS_STORAGE_GB_MONTH_COST_BRL`

Zero is accepted for cost fields, but production values must be intentionally
reviewed. `ANALYTICS_USD_TO_BRL_RATE` must be greater than zero.

## Docker Infrastructure

- [ ] `POSTGRES_DB`
- [ ] `POSTGRES_USER`
- [ ] `POSTGRES_PASSWORD`
- [ ] `API_PORT`

`ENV_FILE` and `IMAGE_TAG` are optional Compose controls. PostgreSQL credentials
must agree with the effective container `DATABASE_URL`.

## Smoke Test

- [ ] `SMOKE_BASE_URL`
- [ ] `SMOKE_ADMIN_EMAIL`
- [ ] `SMOKE_ADMIN_PASSWORD`

The smoke account must exist, be active, and have the `ADMIN` role. Treat its
password as a production secret and rotate it under the normal access policy.

## Block 31 Mandatory Environment Gate

The real VPS deployment must not start until every variable below is present in
`.env.production`. Presence does not prove validity or provider connectivity,
and values must never be printed into deployment logs or reports.

- [ ] `DATABASE_URL`
- [ ] `JWT_ACCESS_SECRET`
- [ ] `JWT_REFRESH_SECRET`
- [ ] `JWT_ISSUER`
- [ ] `JWT_AUDIENCE`
- [ ] `CORS_ALLOWED_ORIGINS`
- [ ] `PAGBANK_API_URL`
- [ ] `PAGBANK_TOKEN`
- [ ] `PAGBANK_WEBHOOK_SECRET`
- [ ] `EVOLUTION_BASE_URL`
- [ ] `EVOLUTION_API_KEY`
- [ ] `EVOLUTION_INSTANCE_NAME`
- [ ] `EVOLUTION_WEBHOOK_SECRET`
- [ ] `OPENAI_API_KEY`
- [ ] `OPENAI_MODEL_TEXT`
- [ ] `OPENAI_MODEL_VISION`
- [ ] `UPLOAD_PATH`
- [ ] `SMOKE_ADMIN_EMAIL`
- [ ] `SMOKE_ADMIN_PASSWORD`
- [ ] `SMOKE_BASE_URL`

Use the non-secret presence checker in
[the VPS deploy checklist](./vps-deploy-checklist.md). Also confirm
`.env.production` is owned by the deploy user, has mode `0600`, is ignored by
Git, and contains no example placeholders.

## Pre-Launch Secret Gate

- [ ] No placeholder from `.env.example` remains.
- [ ] JWT secrets are unique and at least 32 characters.
- [ ] Provider keys and webhook secrets are at least 16 characters.
- [ ] Production provider and CORS URLs use HTTPS.
- [ ] `.env.production` is absent from Git history and has mode `0600`.
- [ ] Secrets are backed up in an approved encrypted secret manager.
- [ ] A rotation owner and emergency revocation path are recorded.
- [ ] Application and proxy logs were checked for accidental secret output.
