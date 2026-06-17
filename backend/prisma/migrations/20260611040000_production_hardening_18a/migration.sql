ALTER TYPE "AIJobType" ADD VALUE IF NOT EXISTS 'WORKOUT';
ALTER TYPE "AIJobType" ADD VALUE IF NOT EXISTS 'PROGRESS';
ALTER TYPE "OutboundMessageStatus" ADD VALUE IF NOT EXISTS 'SENDING';
ALTER TYPE "ScheduledMessageStatus" ADD VALUE IF NOT EXISTS 'SENDING';

ALTER TABLE "webhook_events"
  ADD COLUMN "claimedAt" TIMESTAMP(3),
  ADD COLUMN "leaseExpiresAt" TIMESTAMP(3);

CREATE INDEX "webhook_events_status_leaseExpiresAt_idx"
  ON "webhook_events"("status", "leaseExpiresAt");

CREATE TABLE "evolution_inbound_events" (
  "id" TEXT NOT NULL,
  "instanceName" TEXT NOT NULL,
  "externalMessageId" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" "WebhookStatus" NOT NULL DEFAULT 'RECEIVED',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "claimedAt" TIMESTAMP(3),
  "leaseExpiresAt" TIMESTAMP(3),
  "lastError" TEXT,
  "processedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "evolution_inbound_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "evolution_inbound_events_instanceName_externalMessageId_key"
  ON "evolution_inbound_events"("instanceName", "externalMessageId");
CREATE INDEX "evolution_inbound_events_status_createdAt_idx"
  ON "evolution_inbound_events"("status", "createdAt");
CREATE INDEX "evolution_inbound_events_status_leaseExpiresAt_idx"
  ON "evolution_inbound_events"("status", "leaseExpiresAt");

ALTER TABLE "ai_jobs"
  ADD COLUMN "operationKey" TEXT,
  ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "leaseExpiresAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "ai_jobs_operationKey_key" ON "ai_jobs"("operationKey");
CREATE INDEX "ai_jobs_status_leaseExpiresAt_idx"
  ON "ai_jobs"("status", "leaseExpiresAt");

CREATE UNIQUE INDEX "ai_usage_aiJobId_key" ON "ai_usage"("aiJobId");

ALTER TABLE "meal_analyses"
  ADD COLUMN "processingStartedAt" TIMESTAMP(3);

ALTER TABLE "usage_events"
  ADD COLUMN "expiresAt" TIMESTAMP(3),
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "usage_events_status_expiresAt_idx"
  ON "usage_events"("status", "expiresAt");

ALTER TABLE "outbound_messages"
  ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "leaseExpiresAt" TIMESTAMP(3);

CREATE INDEX "outbound_messages_status_leaseExpiresAt_idx"
  ON "outbound_messages"("status", "leaseExpiresAt");

ALTER TABLE "scheduled_messages"
  ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "leaseExpiresAt" TIMESTAMP(3);

CREATE INDEX "scheduled_messages_status_leaseExpiresAt_idx"
  ON "scheduled_messages"("status", "leaseExpiresAt");

ALTER TABLE "workout_plans" ADD COLUMN "aiJobId" TEXT;
CREATE UNIQUE INDEX "workout_plans_aiJobId_key" ON "workout_plans"("aiJobId");
ALTER TABLE "workout_plans"
  ADD CONSTRAINT "workout_plans_aiJobId_fkey"
  FOREIGN KEY ("aiJobId") REFERENCES "ai_jobs"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "progress_insights" ADD COLUMN "aiJobId" TEXT;
CREATE UNIQUE INDEX "progress_insights_aiJobId_key"
  ON "progress_insights"("aiJobId");
ALTER TABLE "progress_insights"
  ADD CONSTRAINT "progress_insights_aiJobId_fkey"
  FOREIGN KEY ("aiJobId") REFERENCES "ai_jobs"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
