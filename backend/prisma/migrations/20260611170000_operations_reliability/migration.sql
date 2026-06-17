CREATE TYPE "WorkerStatus" AS ENUM (
  'RUNNING',
  'STOPPED'
);

CREATE TABLE "worker_heartbeats" (
  "id" TEXT NOT NULL,
  "workerName" TEXT NOT NULL,
  "instanceId" TEXT NOT NULL,
  "status" "WorkerStatus" NOT NULL DEFAULT 'RUNNING',
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "heartbeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "stoppedAt" TIMESTAMP(3),
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "worker_heartbeats_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "worker_heartbeats_workerName_instanceId_key"
  ON "worker_heartbeats"("workerName", "instanceId");

CREATE INDEX "worker_heartbeats_workerName_heartbeatAt_idx"
  ON "worker_heartbeats"("workerName", "heartbeatAt");

CREATE INDEX "worker_heartbeats_status_heartbeatAt_idx"
  ON "worker_heartbeats"("status", "heartbeatAt");

ALTER TABLE "worker_heartbeats"
  ADD CONSTRAINT "worker_heartbeats_worker_name_check"
    CHECK ("workerName" ~ '^[A-Z][A-Z0-9_]{2,99}$'),
  ADD CONSTRAINT "worker_heartbeats_instance_id_check"
    CHECK (length(btrim("instanceId")) BETWEEN 1 AND 255);

CREATE INDEX "outbox_events_status_processedAt_idx"
  ON "outbox_events"("status", "processedAt");

CREATE INDEX "webhook_events_status_processedAt_idx"
  ON "webhook_events"("status", "processedAt");

CREATE INDEX "system_events_createdAt_idx"
  ON "system_events"("createdAt");

CREATE INDEX "audit_logs_createdAt_idx"
  ON "audit_logs"("createdAt");
