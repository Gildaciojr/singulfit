# Async Workout pre-deploy gate

Run on the production database immediately before deploying this release.
Deploy is permitted only if `legacy_inflight_count = 0`. A query error also
blocks deployment. This release does not reconstruct legacy application input
or modify legacy durable ledgers. Do not terminalize these jobs automatically
to make this gate pass. Coordinate the gate with stopping acceptance of new
Workout requests by the old release so no legacy job can appear after the check.

```sql
BEGIN TRANSACTION READ ONLY;
WITH inflight AS (
  SELECT id,
         (result->'durableTextOperation'->>'executionContext')::jsonb AS context
  FROM ai_jobs
  WHERE type = 'WORKOUT'
    AND status IN ('PENDING', 'PROCESSING')
    AND result ? 'durableTextOperation'
)
SELECT count(*) AS legacy_inflight_count
FROM inflight
WHERE context->'applicationInput' IS NULL
   OR jsonb_typeof(context->'applicationInput') IS DISTINCT FROM 'object';
ROLLBACK;
```

An invalid JSON execution context fails the query and blocks the release.
After a zero result, keep old workers drained/stopped until the new release is
active. No DB mutation, migration or infrastructure creation is part of this gate.

## Persistence retry boundary

Prisma 5.22 infrastructure errors P1001 (unreachable server), P1002 (connection
timeout), P1008 (operation timeout), P1017 (closed connection) defer persistence.
Authentication, integrity and unknown failures are not classified as transient.
The existing Outbox policy remains bounded (default 10 attempts, exponential
backoff from 1 second up to 300 seconds; configured values remain authoritative).
Waiting on an active AIJob lease does not consume this failure budget.

Recovery settles a non-terminal Workout after its continuation event reaches
DEAD_LETTER and its AIJob claim is released/expired. It preserves the ledger and
reverses the reservation once. It does not enqueue a separate terminal WhatsApp
message after dead letter; no new delivery retry mechanism is introduced.
