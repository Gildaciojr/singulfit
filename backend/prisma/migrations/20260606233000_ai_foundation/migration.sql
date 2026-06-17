CREATE TYPE "AIJobType" AS ENUM ('TEXT', 'IMAGE', 'AUDIO');

CREATE TYPE "AIJobStatus" AS ENUM (
  'PENDING',
  'PROCESSING',
  'COMPLETED',
  'FAILED'
);

CREATE TABLE "prompt_versions" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "prompt" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "prompt_versions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_jobs" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  "type" "AIJobType" NOT NULL,
  "status" "AIJobStatus" NOT NULL DEFAULT 'PENDING',
  "promptVersionId" TEXT NOT NULL,
  "providerResponseId" TEXT,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ai_jobs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_usage" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "aiJobId" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "promptTokens" INTEGER NOT NULL,
  "completionTokens" INTEGER NOT NULL,
  "totalTokens" INTEGER NOT NULL,
  "estimatedCost" DECIMAL(14,8) NOT NULL,
  "costCurrency" TEXT NOT NULL DEFAULT 'USD',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ai_usage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "prompt_versions_name_version_key"
ON "prompt_versions"("name", "version");

CREATE UNIQUE INDEX "prompt_versions_one_active_name_key"
ON "prompt_versions"("name")
WHERE "isActive" = true;

CREATE INDEX "prompt_versions_name_isActive_idx"
ON "prompt_versions"("name", "isActive");

CREATE UNIQUE INDEX "ai_jobs_providerResponseId_key"
ON "ai_jobs"("providerResponseId");

CREATE UNIQUE INDEX "ai_jobs_messageId_type_promptVersionId_key"
ON "ai_jobs"("messageId", "type", "promptVersionId");

CREATE INDEX "ai_jobs_userId_status_createdAt_idx"
ON "ai_jobs"("userId", "status", "createdAt");

CREATE INDEX "ai_jobs_conversationId_createdAt_idx"
ON "ai_jobs"("conversationId", "createdAt");

CREATE INDEX "ai_jobs_status_createdAt_idx"
ON "ai_jobs"("status", "createdAt");

CREATE INDEX "ai_usage_userId_createdAt_idx"
ON "ai_usage"("userId", "createdAt");

CREATE INDEX "ai_usage_aiJobId_idx"
ON "ai_usage"("aiJobId");

CREATE INDEX "ai_usage_model_createdAt_idx"
ON "ai_usage"("model", "createdAt");

ALTER TABLE "ai_jobs"
ADD CONSTRAINT "ai_jobs_userId_fkey"
FOREIGN KEY ("userId")
REFERENCES "users"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

ALTER TABLE "ai_jobs"
ADD CONSTRAINT "ai_jobs_conversationId_fkey"
FOREIGN KEY ("conversationId")
REFERENCES "conversations"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

ALTER TABLE "ai_jobs"
ADD CONSTRAINT "ai_jobs_messageId_fkey"
FOREIGN KEY ("messageId")
REFERENCES "messages"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

ALTER TABLE "ai_jobs"
ADD CONSTRAINT "ai_jobs_promptVersionId_fkey"
FOREIGN KEY ("promptVersionId")
REFERENCES "prompt_versions"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE "ai_usage"
ADD CONSTRAINT "ai_usage_userId_fkey"
FOREIGN KEY ("userId")
REFERENCES "users"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

ALTER TABLE "ai_usage"
ADD CONSTRAINT "ai_usage_aiJobId_fkey"
FOREIGN KEY ("aiJobId")
REFERENCES "ai_jobs"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

ALTER TABLE "prompt_versions"
  ADD CONSTRAINT "prompt_versions_name_not_blank_check"
    CHECK (btrim("name") <> ''),
  ADD CONSTRAINT "prompt_versions_version_positive_check"
    CHECK ("version" > 0),
  ADD CONSTRAINT "prompt_versions_prompt_not_blank_check"
    CHECK (btrim("prompt") <> '');

ALTER TABLE "ai_jobs"
  ADD CONSTRAINT "ai_jobs_error_not_blank_check"
    CHECK ("error" IS NULL OR btrim("error") <> ''),
  ADD CONSTRAINT "ai_jobs_lifecycle_check"
    CHECK (
      (
        "status" = 'PENDING'
        AND "startedAt" IS NULL
        AND "completedAt" IS NULL
        AND "failedAt" IS NULL
        AND "error" IS NULL
      )
      OR (
        "status" = 'PROCESSING'
        AND "startedAt" IS NOT NULL
        AND "completedAt" IS NULL
        AND "failedAt" IS NULL
        AND "error" IS NULL
      )
      OR (
        "status" = 'COMPLETED'
        AND "startedAt" IS NOT NULL
        AND "completedAt" IS NOT NULL
        AND "failedAt" IS NULL
        AND "error" IS NULL
      )
      OR (
        "status" = 'FAILED'
        AND "startedAt" IS NOT NULL
        AND "completedAt" IS NULL
        AND "failedAt" IS NOT NULL
        AND "error" IS NOT NULL
      )
    );

ALTER TABLE "ai_usage"
  ADD CONSTRAINT "ai_usage_model_not_blank_check"
    CHECK (btrim("model") <> ''),
  ADD CONSTRAINT "ai_usage_tokens_non_negative_check"
    CHECK (
      "promptTokens" >= 0
      AND "completionTokens" >= 0
      AND "totalTokens" >= 0
    ),
  ADD CONSTRAINT "ai_usage_total_tokens_check"
    CHECK ("totalTokens" = "promptTokens" + "completionTokens"),
  ADD CONSTRAINT "ai_usage_estimated_cost_non_negative_check"
    CHECK ("estimatedCost" >= 0),
  ADD CONSTRAINT "ai_usage_cost_currency_check"
    CHECK ("costCurrency" = 'USD');
