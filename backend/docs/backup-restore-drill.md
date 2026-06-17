# NutraFit Backup And Restore Drill

Run this drill before the pilot and after material database or infrastructure
changes. PostgreSQL and local uploads are separate backup domains. Keep
encrypted, off-host copies and record evidence in the pilot report.

Commands assume Docker Compose from `/srv/nutrafit/backend` on Linux.

## 1. Preconditions

- [ ] Confirm `.env.production` permissions are `0600`.
- [ ] Confirm adequate free space for the dump and upload archive.
- [ ] Record current commit, image tag, database size, and migration status.
- [ ] Announce the drill window and identify the rollback operator.

```bash
cd /srv/nutrafit/backend
set -a
. ./.env.production
set +a
docker compose --env-file .env.production -f docker-compose.prod.yml ps
docker compose --env-file .env.production -f docker-compose.prod.yml \
  exec backend-api npx prisma migrate status
```

## 2. PostgreSQL Backup

```bash
sudo install -d -m 0700 -o "$USER" -g "$USER" /srv/backups/nutrafit
BACKUP="/srv/backups/nutrafit/nutrafit-$(date -u +%Y%m%dT%H%M%SZ).dump"
docker compose --env-file .env.production -f docker-compose.prod.yml \
  exec -T postgres sh -c \
  'pg_dump --format=custom --compress=9 --no-owner --no-acl -U "$POSTGRES_USER" "$POSTGRES_DB"' \
  > "$BACKUP"
test -s "$BACKUP"
sha256sum "$BACKUP" > "$BACKUP.sha256"
docker compose --env-file .env.production -f docker-compose.prod.yml \
  exec -T postgres pg_restore --list < "$BACKUP" >/dev/null
sha256sum --check "$BACKUP.sha256"
```

Copy the dump, checksum, and drill record to encrypted off-host storage.

## 3. Upload Backup

Local uploads are not included in `pg_dump`.

```bash
UPLOAD_BACKUP="/srv/backups/nutrafit/uploads-$(date -u +%Y%m%dT%H%M%SZ).tar.gz"
UPLOAD_ARCHIVE="$(basename "$UPLOAD_BACKUP")"
docker run --rm \
  -e UPLOAD_ARCHIVE="$UPLOAD_ARCHIVE" \
  -v nutrafit-production_nutrafit_uploads:/data:ro \
  -v /srv/backups/nutrafit:/backup \
  alpine:3.20 sh -c \
  'tar -czf "/backup/$UPLOAD_ARCHIVE" -C /data .'
test -s "$UPLOAD_BACKUP"
sha256sum "$UPLOAD_BACKUP" > "$UPLOAD_BACKUP.sha256"
```

Verify the actual volume name with `docker volume ls` before running the
archive command.

## 4. Restore Validation In A Separate Database

Create a temporary database in the same PostgreSQL server. This verifies dump
integrity without replacing production data.

```bash
RESTORE_DB="nutrafit_restore_$(date -u +%Y%m%d%H%M%S)"
docker compose --env-file .env.production -f docker-compose.prod.yml \
  exec -T postgres sh -c \
  'createdb -U "$POSTGRES_USER" "'"$RESTORE_DB"'"'
docker compose --env-file .env.production -f docker-compose.prod.yml \
  exec -T postgres sh -c \
  'pg_restore --no-owner --no-acl --exit-on-error -U "$POSTGRES_USER" -d "'"$RESTORE_DB"'"' \
  < "$BACKUP"
docker compose --env-file .env.production -f docker-compose.prod.yml \
  exec -T postgres sh -c \
  'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "'"$RESTORE_DB"'" -c "SELECT COUNT(*) AS migrations FROM \"_prisma_migrations\" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;"'
```

Build a URL-encoded `RESTORE_DATABASE_URL` for the temporary database, then run
Prisma checks in the application image:

```bash
export RESTORE_DB
RESTORE_DATABASE_URL="$(
  node -e "const url = new URL(process.env.DATABASE_URL); url.hostname = 'postgres'; url.port = '5432'; url.pathname = '/' + process.env.RESTORE_DB; console.log(url.toString())"
)"
docker compose --env-file .env.production -f docker-compose.prod.yml \
  run --rm -e DATABASE_URL="$RESTORE_DATABASE_URL" migrate \
  npx prisma migrate status
docker compose --env-file .env.production -f docker-compose.prod.yml \
  run --rm -e DATABASE_URL="$RESTORE_DATABASE_URL" migrate \
  npx prisma migrate deploy
```

Both commands must succeed. `migrate deploy` proves that the restored database
can accept the current migration set; it may apply migrations created after the
backup.

## 5. Controlled In-Place Restore Drill

Use staging whenever possible. For a production in-place drill, schedule
downtime, block public traffic, and take a fresh pre-restore backup first.

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml \
  stop backend-api worker-outbox worker-ai worker-automation
docker compose --env-file .env.production -f docker-compose.prod.yml \
  exec -T postgres sh -c \
  'dropdb --if-exists -U "$POSTGRES_USER" "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" "$POSTGRES_DB"'
docker compose --env-file .env.production -f docker-compose.prod.yml \
  exec -T postgres sh -c \
  'pg_restore --clean --if-exists --no-owner --no-acl --exit-on-error -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  < "$BACKUP"
docker compose --env-file .env.production -f docker-compose.prod.yml up -d
```

## 6. Post-Restore Validation

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml \
  exec backend-api npx prisma migrate status
docker compose --env-file .env.production -f docker-compose.prod.yml \
  exec backend-api npx prisma migrate deploy
curl --fail http://127.0.0.1:3000/api/v1/health/live
curl --fail http://127.0.0.1:3000/api/v1/health/ready
docker compose --env-file .env.production -f docker-compose.prod.yml \
  exec backend-api npm run smoke:test
docker compose --env-file .env.production -f docker-compose.prod.yml \
  logs --tail=200 backend-api worker-outbox worker-ai worker-automation
```

- [ ] Migration status reports no failed or pending migrations.
- [ ] API liveness and readiness return HTTP 200.
- [ ] All worker heartbeats are current.
- [ ] Smoke passes.
- [ ] Critical record counts match the backup source.
- [ ] Recent authentication, subscription, payment, message, and media metadata
      records are present.
- [ ] A sample upload can be read after restoring the upload archive.
- [ ] No secrets or personal data were copied into the drill report.

## 7. Cleanup And Evidence

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml \
  exec -T postgres sh -c \
  'dropdb --if-exists -U "$POSTGRES_USER" "'"$RESTORE_DB"'"'
```

Record dump checksum, start/end time, restore duration, operator, target,
validation results, failures, corrective actions, and final `PASS` or `FAIL`.
A failed or unproven restore is a pilot `NO-GO`.
