CREATE TYPE "AIResponseEvaluationType" AS ENUM (
    'NUTRITION_RESPONSE',
    'TEXT_RESPONSE'
);

CREATE TYPE "AIResponseRiskLevel" AS ENUM (
    'LOW',
    'MEDIUM',
    'HIGH',
    'BLOCKED'
);

CREATE TYPE "AIReviewStatus" AS ENUM (
    'OPEN',
    'REVIEWED',
    'DISMISSED'
);

CREATE TABLE "ai_response_evaluations" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "aiJobId" TEXT,
    "messageId" TEXT,
    "responseId" TEXT,
    "promptVersionId" TEXT,
    "evaluationType" "AIResponseEvaluationType" NOT NULL,
    "qualityScore" INTEGER NOT NULL,
    "safetyScore" INTEGER NOT NULL,
    "personalizationScore" INTEGER NOT NULL,
    "usefulnessScore" INTEGER NOT NULL,
    "clarityScore" INTEGER NOT NULL,
    "riskLevel" "AIResponseRiskLevel" NOT NULL,
    "flags" JSONB NOT NULL DEFAULT '[]',
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "fallbackUsed" BOOLEAN NOT NULL DEFAULT false,
    "estimatedCost" DECIMAL(14,8) NOT NULL DEFAULT 0,
    "evaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_response_evaluations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_response_evaluations_scores_check" CHECK (
        "qualityScore" BETWEEN 0 AND 100
        AND "safetyScore" BETWEEN 0 AND 100
        AND "personalizationScore" BETWEEN 0 AND 100
        AND "usefulnessScore" BETWEEN 0 AND 100
        AND "clarityScore" BETWEEN 0 AND 100
    ),
    CONSTRAINT "ai_response_evaluations_cost_check" CHECK (
        "estimatedCost" >= 0
    )
);

CREATE TABLE "ai_review_queue" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "aiResponseEvaluationId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "AIReviewStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_review_queue_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_quality_daily_snapshots" (
    "id" TEXT NOT NULL,
    "snapshotDate" DATE NOT NULL,
    "evaluationCount" INTEGER NOT NULL,
    "averageQualityScore" DECIMAL(5,2) NOT NULL,
    "averageSafetyScore" DECIMAL(5,2) NOT NULL,
    "averagePersonalization" DECIMAL(5,2) NOT NULL,
    "averageUsefulness" DECIMAL(5,2) NOT NULL,
    "averageClarity" DECIMAL(5,2) NOT NULL,
    "lowRiskCount" INTEGER NOT NULL,
    "mediumRiskCount" INTEGER NOT NULL,
    "highRiskCount" INTEGER NOT NULL,
    "blockedCount" INTEGER NOT NULL,
    "flaggedCount" INTEGER NOT NULL,
    "fallbackCount" INTEGER NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_quality_daily_snapshots_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_quality_daily_snapshots_scores_check" CHECK (
        "averageQualityScore" BETWEEN 0 AND 100
        AND "averageSafetyScore" BETWEEN 0 AND 100
        AND "averagePersonalization" BETWEEN 0 AND 100
        AND "averageUsefulness" BETWEEN 0 AND 100
        AND "averageClarity" BETWEEN 0 AND 100
    ),
    CONSTRAINT "ai_quality_daily_snapshots_counts_check" CHECK (
        "evaluationCount" >= 0
        AND "lowRiskCount" >= 0
        AND "mediumRiskCount" >= 0
        AND "highRiskCount" >= 0
        AND "blockedCount" >= 0
        AND "flaggedCount" >= 0
        AND "fallbackCount" >= 0
    )
);

CREATE TABLE "prompt_quality_snapshots" (
    "id" TEXT NOT NULL,
    "promptVersionId" TEXT NOT NULL,
    "snapshotDate" DATE NOT NULL,
    "evaluationCount" INTEGER NOT NULL,
    "averageQualityScore" DECIMAL(5,2) NOT NULL,
    "averageSafetyScore" DECIMAL(5,2) NOT NULL,
    "averageCost" DECIMAL(14,8) NOT NULL,
    "flaggedCount" INTEGER NOT NULL,
    "flagRate" DECIMAL(5,2) NOT NULL,
    "blockedCount" INTEGER NOT NULL,
    "fallbackCount" INTEGER NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prompt_quality_snapshots_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "prompt_quality_snapshots_scores_check" CHECK (
        "averageQualityScore" BETWEEN 0 AND 100
        AND "averageSafetyScore" BETWEEN 0 AND 100
        AND "flagRate" BETWEEN 0 AND 100
    ),
    CONSTRAINT "prompt_quality_snapshots_values_check" CHECK (
        "evaluationCount" >= 0
        AND "averageCost" >= 0
        AND "flaggedCount" >= 0
        AND "blockedCount" >= 0
        AND "fallbackCount" >= 0
    )
);

CREATE UNIQUE INDEX "ai_response_evaluations_responseId_key"
ON "ai_response_evaluations"("responseId");

CREATE INDEX "ai_response_evaluations_userId_evaluatedAt_idx"
ON "ai_response_evaluations"("userId", "evaluatedAt");

CREATE INDEX "ai_response_evaluations_aiJobId_evaluatedAt_idx"
ON "ai_response_evaluations"("aiJobId", "evaluatedAt");

CREATE INDEX "ai_response_evaluations_promptVersionId_evaluatedAt_idx"
ON "ai_response_evaluations"("promptVersionId", "evaluatedAt");

CREATE INDEX "ai_response_evaluations_riskLevel_evaluatedAt_idx"
ON "ai_response_evaluations"("riskLevel", "evaluatedAt");

CREATE INDEX "ai_response_evaluations_evaluationType_evaluatedAt_idx"
ON "ai_response_evaluations"("evaluationType", "evaluatedAt");

CREATE UNIQUE INDEX "ai_review_queue_aiResponseEvaluationId_key"
ON "ai_review_queue"("aiResponseEvaluationId");

CREATE INDEX "ai_review_queue_status_createdAt_idx"
ON "ai_review_queue"("status", "createdAt");

CREATE INDEX "ai_review_queue_userId_createdAt_idx"
ON "ai_review_queue"("userId", "createdAt");

CREATE UNIQUE INDEX "ai_quality_daily_snapshots_snapshotDate_key"
ON "ai_quality_daily_snapshots"("snapshotDate");

CREATE INDEX "ai_quality_daily_snapshots_snapshotDate_generatedAt_idx"
ON "ai_quality_daily_snapshots"("snapshotDate", "generatedAt");

CREATE UNIQUE INDEX "prompt_quality_snapshots_promptVersionId_snapshotDate_key"
ON "prompt_quality_snapshots"("promptVersionId", "snapshotDate");

CREATE INDEX "prompt_quality_snapshots_snapshotDate_averageQualityScore_idx"
ON "prompt_quality_snapshots"("snapshotDate", "averageQualityScore");

CREATE INDEX "prompt_quality_snapshots_promptVersionId_generatedAt_idx"
ON "prompt_quality_snapshots"("promptVersionId", "generatedAt");

ALTER TABLE "ai_response_evaluations"
ADD CONSTRAINT "ai_response_evaluations_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ai_response_evaluations"
ADD CONSTRAINT "ai_response_evaluations_aiJobId_fkey"
FOREIGN KEY ("aiJobId") REFERENCES "ai_jobs"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ai_response_evaluations"
ADD CONSTRAINT "ai_response_evaluations_messageId_fkey"
FOREIGN KEY ("messageId") REFERENCES "messages"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ai_response_evaluations"
ADD CONSTRAINT "ai_response_evaluations_responseId_fkey"
FOREIGN KEY ("responseId") REFERENCES "outbound_messages"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ai_response_evaluations"
ADD CONSTRAINT "ai_response_evaluations_promptVersionId_fkey"
FOREIGN KEY ("promptVersionId") REFERENCES "prompt_versions"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ai_review_queue"
ADD CONSTRAINT "ai_review_queue_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ai_review_queue"
ADD CONSTRAINT "ai_review_queue_aiResponseEvaluationId_fkey"
FOREIGN KEY ("aiResponseEvaluationId")
REFERENCES "ai_response_evaluations"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "prompt_quality_snapshots"
ADD CONSTRAINT "prompt_quality_snapshots_promptVersionId_fkey"
FOREIGN KEY ("promptVersionId") REFERENCES "prompt_versions"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
