-- Shadow-only operational state. No official nutrition or AIJob table is changed.
CREATE TYPE "NutritionShadowRunStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED');
CREATE TYPE "NutritionShadowOutputKind" AS ENUM ('PLAN', 'CONVERSATIONAL_ARTIFACT', 'CURRENT_PLAN_PRESENTATION');
CREATE TYPE "NutritionShadowErrorCategory" AS ENUM ('BUILDER_ERROR', 'STRATEGY_ERROR', 'PROVIDER_ERROR', 'PARSER_ERROR', 'VALIDATION_ERROR', 'ACTIVE_PLAN_RESOLUTION_ERROR', 'SHADOW_PERSISTENCE_ERROR', 'UNKNOWN_ERROR');

CREATE TABLE "nutrition_shadow_runs" (
  "id" TEXT NOT NULL,
  "operationKey" TEXT NOT NULL,
  "inputFingerprint" TEXT NOT NULL,
  "correlationId" TEXT NOT NULL,
  "traceId" TEXT,
  "userId" TEXT NOT NULL,
  "conversationId" TEXT,
  "messageId" TEXT,
  "status" "NutritionShadowRunStatus" NOT NULL DEFAULT 'PENDING',
  "artifactType" "NutritionArtifactType",
  "kind" "NutritionShadowOutputKind",
  "provider" TEXT,
  "model" TEXT,
  "promptVersionId" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "promptTokens" INTEGER,
  "completionTokens" INTEGER,
  "totalTokens" INTEGER,
  "estimatedCostUsd" DECIMAL(14,8),
  "costCurrency" TEXT,
  "builderDurationMs" INTEGER,
  "strategyDurationMs" INTEGER,
  "providerDurationMs" INTEGER,
  "parsingDurationMs" INTEGER,
  "validationDurationMs" INTEGER,
  "persistenceDurationMs" INTEGER,
  "totalDurationMs" INTEGER,
  "document" JSONB,
  "documentHash" TEXT,
  "resultSummary" TEXT,
  "activePlanReference" TEXT,
  "errorCategory" "NutritionShadowErrorCategory",
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "nutrition_shadow_runs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "nutrition_shadow_runs_attempts_check" CHECK ("attempts" >= 0),
  CONSTRAINT "nutrition_shadow_runs_tokens_check" CHECK (
    ("promptTokens" IS NULL AND "completionTokens" IS NULL AND "totalTokens" IS NULL)
    OR ("promptTokens" >= 0 AND "completionTokens" >= 0 AND "totalTokens" = "promptTokens" + "completionTokens")
  ),
  CONSTRAINT "nutrition_shadow_runs_duration_check" CHECK (
    COALESCE("builderDurationMs", 0) >= 0 AND COALESCE("strategyDurationMs", 0) >= 0
    AND COALESCE("providerDurationMs", 0) >= 0 AND COALESCE("parsingDurationMs", 0) >= 0
    AND COALESCE("validationDurationMs", 0) >= 0 AND COALESCE("persistenceDurationMs", 0) >= 0
    AND COALESCE("totalDurationMs", 0) >= 0
  ),
  CONSTRAINT "nutrition_shadow_runs_state_check" CHECK (
    ("status" IN ('PENDING', 'RUNNING') AND "completedAt" IS NULL AND "document" IS NULL AND "documentHash" IS NULL AND "errorCategory" IS NULL AND "errorMessage" IS NULL)
    OR ("status" = 'SUCCEEDED' AND "completedAt" IS NOT NULL AND "artifactType" IS NOT NULL AND "kind" IS NOT NULL AND "document" IS NOT NULL AND "documentHash" IS NOT NULL AND "errorCategory" IS NULL AND "errorMessage" IS NULL)
    OR ("status" = 'FAILED' AND "completedAt" IS NOT NULL AND "document" IS NULL AND "documentHash" IS NULL AND "errorCategory" IS NOT NULL AND "errorMessage" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "nutrition_shadow_runs_operationKey_key" ON "nutrition_shadow_runs"("operationKey");
CREATE INDEX "nutrition_shadow_runs_userId_createdAt_idx" ON "nutrition_shadow_runs"("userId", "createdAt");
CREATE INDEX "nutrition_shadow_runs_conversationId_createdAt_idx" ON "nutrition_shadow_runs"("conversationId", "createdAt");
CREATE INDEX "nutrition_shadow_runs_messageId_createdAt_idx" ON "nutrition_shadow_runs"("messageId", "createdAt");
CREATE INDEX "nutrition_shadow_runs_status_createdAt_idx" ON "nutrition_shadow_runs"("status", "createdAt");
CREATE INDEX "nutrition_shadow_runs_artifactType_createdAt_idx" ON "nutrition_shadow_runs"("artifactType", "createdAt");

CREATE FUNCTION "protect_completed_nutrition_shadow_run"() RETURNS TRIGGER AS $$
BEGIN
  IF OLD."status" = 'SUCCEEDED' THEN
    RAISE EXCEPTION 'Succeeded NutritionShadowRun is immutable';
  END IF;
  IF OLD."status" = 'FAILED' AND NEW."status" NOT IN ('RUNNING', 'FAILED') THEN
    RAISE EXCEPTION 'Failed NutritionShadowRun may only retry or remain failed';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "nutrition_shadow_run_terminal_guard"
BEFORE UPDATE ON "nutrition_shadow_runs"
FOR EACH ROW EXECUTE FUNCTION "protect_completed_nutrition_shadow_run"();
