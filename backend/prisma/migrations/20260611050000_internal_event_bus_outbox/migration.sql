CREATE TYPE "OutboxStatus" AS ENUM (
  'PENDING',
  'PROCESSING',
  'PROCESSED',
  'FAILED',
  'DEAD_LETTER'
);

CREATE TABLE "outbox_events" (
  "id" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "aggregateType" TEXT NOT NULL,
  "aggregateId" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "claimedAt" TIMESTAMP(3),
  "processedAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "outbox_events_eventType_aggregateType_aggregateId_key"
  ON "outbox_events"("eventType", "aggregateType", "aggregateId");

CREATE INDEX "outbox_events_status_availableAt_createdAt_idx"
  ON "outbox_events"("status", "availableAt", "createdAt");

CREATE INDEX "outbox_events_status_claimedAt_idx"
  ON "outbox_events"("status", "claimedAt");

CREATE INDEX "outbox_events_aggregateType_aggregateId_createdAt_idx"
  ON "outbox_events"("aggregateType", "aggregateId", "createdAt");

ALTER TABLE "outbox_events"
  ADD CONSTRAINT "outbox_events_event_type_check"
    CHECK ("eventType" ~ '^[A-Z][A-Z0-9_]{2,99}$'),
  ADD CONSTRAINT "outbox_events_aggregate_type_check"
    CHECK ("aggregateType" ~ '^[A-Z][A-Z0-9_]{2,99}$'),
  ADD CONSTRAINT "outbox_events_aggregate_id_check"
    CHECK (length(btrim("aggregateId")) BETWEEN 1 AND 255),
  ADD CONSTRAINT "outbox_events_attempts_check"
    CHECK ("attempts" >= 0),
  ADD CONSTRAINT "outbox_events_last_error_check"
    CHECK ("lastError" IS NULL OR length("lastError") <= 2000);
