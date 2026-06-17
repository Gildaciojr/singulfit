-- CreateEnum
CREATE TYPE "ActivationStage" AS ENUM (
  'REGISTERED',
  'PAID',
  'WHATSAPP_CONNECTED',
  'FIRST_MESSAGE_SENT',
  'FIRST_MEAL_RECEIVED',
  'FIRST_ANALYSIS_COMPLETED',
  'FIRST_RECOMMENDATION_DELIVERED',
  'FIRST_COACH_INTERACTION',
  'ACTIVATED',
  'ABANDONED'
);

-- CreateEnum
CREATE TYPE "ActivationRiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "ActivationEventKind" AS ENUM (
  'STAGE_TRANSITION',
  'FIRST_VALUE',
  'FLOW_MESSAGE',
  'RECOVERY_MESSAGE',
  'SCORE_UPDATED',
  'RISK_UPDATED'
);

-- CreateEnum
CREATE TYPE "ActivationDeliveryStatus" AS ENUM (
  'PENDING',
  'SENDING',
  'SENT',
  'FAILED'
);

-- CreateTable
CREATE TABLE "user_activations" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "currentStage" "ActivationStage" NOT NULL DEFAULT 'REGISTERED',
  "score" INTEGER NOT NULL DEFAULT 5,
  "riskLevel" "ActivationRiskLevel" NOT NULL DEFAULT 'LOW',
  "registeredAt" TIMESTAMP(3) NOT NULL,
  "paidAt" TIMESTAMP(3),
  "whatsappConnectedAt" TIMESTAMP(3),
  "firstMessageSentAt" TIMESTAMP(3),
  "firstMealReceivedAt" TIMESTAMP(3),
  "firstAnalysisCompletedAt" TIMESTAMP(3),
  "firstRecommendationDeliveredAt" TIMESTAMP(3),
  "firstCoachInteractionAt" TIMESTAMP(3),
  "firstValueAt" TIMESTAMP(3),
  "activatedAt" TIMESTAMP(3),
  "abandonedAt" TIMESTAMP(3),
  "lastProgressAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "user_activations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activation_events" (
  "id" TEXT NOT NULL,
  "activationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "kind" "ActivationEventKind" NOT NULL,
  "eventCode" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "fromStage" "ActivationStage",
  "toStage" "ActivationStage",
  "source" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "durationFromPreviousSeconds" INTEGER,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "deliveryStatus" "ActivationDeliveryStatus",
  "scheduledFor" TIMESTAMP(3),
  "sentAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),
  "externalMessageId" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "leaseExpiresAt" TIMESTAMP(3),
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "activation_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activation_snapshots" (
  "id" TEXT NOT NULL,
  "activationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "snapshotDate" DATE NOT NULL,
  "currentStage" "ActivationStage" NOT NULL,
  "score" INTEGER NOT NULL,
  "riskLevel" "ActivationRiskLevel" NOT NULL,
  "stalledHours" INTEGER NOT NULL,
  "stepDurations" JSONB NOT NULL,
  "firstValueAt" TIMESTAMP(3),
  "finalStatus" "ActivationStage",
  "generatedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "activation_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_activations_userId_key" ON "user_activations"("userId");
CREATE INDEX "user_activations_currentStage_updatedAt_idx" ON "user_activations"("currentStage", "updatedAt");
CREATE INDEX "user_activations_riskLevel_lastProgressAt_idx" ON "user_activations"("riskLevel", "lastProgressAt");
CREATE INDEX "user_activations_activatedAt_idx" ON "user_activations"("activatedAt");
CREATE INDEX "user_activations_abandonedAt_idx" ON "user_activations"("abandonedAt");

CREATE UNIQUE INDEX "activation_events_idempotencyKey_key" ON "activation_events"("idempotencyKey");
CREATE INDEX "activation_events_activationId_occurredAt_idx" ON "activation_events"("activationId", "occurredAt");
CREATE INDEX "activation_events_userId_kind_occurredAt_idx" ON "activation_events"("userId", "kind", "occurredAt");
CREATE INDEX "activation_events_deliveryStatus_scheduledFor_idx" ON "activation_events"("deliveryStatus", "scheduledFor");
CREATE INDEX "activation_events_eventCode_occurredAt_idx" ON "activation_events"("eventCode", "occurredAt");

CREATE UNIQUE INDEX "activation_snapshots_userId_snapshotDate_key" ON "activation_snapshots"("userId", "snapshotDate");
CREATE INDEX "activation_snapshots_snapshotDate_currentStage_idx" ON "activation_snapshots"("snapshotDate", "currentStage");
CREATE INDEX "activation_snapshots_riskLevel_snapshotDate_idx" ON "activation_snapshots"("riskLevel", "snapshotDate");
CREATE INDEX "activation_snapshots_activationId_generatedAt_idx" ON "activation_snapshots"("activationId", "generatedAt");

-- AddForeignKey
ALTER TABLE "user_activations"
ADD CONSTRAINT "user_activations_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "activation_events"
ADD CONSTRAINT "activation_events_activationId_fkey"
FOREIGN KEY ("activationId") REFERENCES "user_activations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "activation_events"
ADD CONSTRAINT "activation_events_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "activation_snapshots"
ADD CONSTRAINT "activation_snapshots_activationId_fkey"
FOREIGN KEY ("activationId") REFERENCES "user_activations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "activation_snapshots"
ADD CONSTRAINT "activation_snapshots_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddCheckConstraint
ALTER TABLE "user_activations"
ADD CONSTRAINT "user_activations_score_check" CHECK ("score" BETWEEN 0 AND 100);

ALTER TABLE "activation_events"
ADD CONSTRAINT "activation_events_duration_check"
CHECK ("durationFromPreviousSeconds" IS NULL OR "durationFromPreviousSeconds" >= 0);

ALTER TABLE "activation_snapshots"
ADD CONSTRAINT "activation_snapshots_score_check" CHECK ("score" BETWEEN 0 AND 100);

ALTER TABLE "activation_snapshots"
ADD CONSTRAINT "activation_snapshots_stalled_hours_check" CHECK ("stalledHours" >= 0);
