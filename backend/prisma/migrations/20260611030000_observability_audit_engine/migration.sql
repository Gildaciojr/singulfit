CREATE TYPE "Severity" AS ENUM (
  'INFO',
  'WARNING',
  'ERROR',
  'CRITICAL'
);

CREATE TABLE "audit_logs" (
  "id" TEXT NOT NULL,
  "userId" TEXT,
  "action" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "system_events" (
  "id" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "severity" "Severity" NOT NULL,
  "eventType" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "system_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_usage_summaries" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "totalTokens" INTEGER NOT NULL,
  "totalCostUsd" DECIMAL(14, 8) NOT NULL,
  CONSTRAINT "ai_usage_summaries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "audit_logs_userId_createdAt_idx"
ON "audit_logs"("userId", "createdAt");

CREATE INDEX "audit_logs_action_createdAt_idx"
ON "audit_logs"("action", "createdAt");

CREATE INDEX "audit_logs_entityType_entityId_createdAt_idx"
ON "audit_logs"("entityType", "entityId", "createdAt");

CREATE INDEX "system_events_severity_createdAt_idx"
ON "system_events"("severity", "createdAt");

CREATE INDEX "system_events_source_eventType_createdAt_idx"
ON "system_events"("source", "eventType", "createdAt");

CREATE UNIQUE INDEX "ai_usage_summaries_userId_date_key"
ON "ai_usage_summaries"("userId", "date");

CREATE INDEX "ai_usage_summaries_date_idx"
ON "ai_usage_summaries"("date");

ALTER TABLE "audit_logs"
ADD CONSTRAINT "audit_logs_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ai_usage_summaries"
ADD CONSTRAINT "ai_usage_summaries_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "audit_logs"
  ADD CONSTRAINT "audit_logs_action_check"
    CHECK ("action" ~ '^[A-Z][A-Z0-9_]{2,99}$'),
  ADD CONSTRAINT "audit_logs_entity_type_check"
    CHECK ("entityType" ~ '^[A-Z][A-Z0-9_]{2,99}$'),
  ADD CONSTRAINT "audit_logs_entity_id_check"
    CHECK (length(btrim("entityId")) BETWEEN 1 AND 255);

ALTER TABLE "system_events"
  ADD CONSTRAINT "system_events_source_check"
    CHECK ("source" ~ '^[A-Z][A-Z0-9_]{2,99}$'),
  ADD CONSTRAINT "system_events_event_type_check"
    CHECK ("eventType" ~ '^[A-Z][A-Z0-9_]{2,99}$'),
  ADD CONSTRAINT "system_events_message_check"
    CHECK (length(btrim("message")) BETWEEN 1 AND 2000);

ALTER TABLE "ai_usage_summaries"
  ADD CONSTRAINT "ai_usage_summaries_total_tokens_check"
    CHECK ("totalTokens" >= 0),
  ADD CONSTRAINT "ai_usage_summaries_total_cost_check"
    CHECK ("totalCostUsd" >= 0);
