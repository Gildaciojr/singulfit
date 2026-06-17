CREATE TYPE "RecommendationCategory" AS ENUM (
    'NUTRITION',
    'HYDRATION',
    'HABIT',
    'BEHAVIOR',
    'ENGAGEMENT',
    'RETENTION',
    'COACHING'
);

CREATE TYPE "RecommendationPriority" AS ENUM (
    'LOW',
    'MEDIUM',
    'HIGH',
    'CRITICAL'
);

CREATE TYPE "RecommendationStatus" AS ENUM (
    'ACTIVE',
    'ACCEPTED',
    'DISMISSED',
    'EXPIRED'
);

CREATE TABLE "recommendations" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "category" "RecommendationCategory" NOT NULL,
    "priority" "RecommendationPriority" NOT NULL,
    "signalKey" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "confidenceScore" INTEGER NOT NULL,
    "status" "RecommendationStatus" NOT NULL DEFAULT 'ACTIVE',
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),
    "dismissedAt" TIMESTAMP(3),
    "expiredAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recommendations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "recommendations_text_check" CHECK (
        btrim("signalKey") <> ''
        AND btrim("sourceKey") <> ''
        AND btrim("title") <> ''
        AND btrim("description") <> ''
        AND btrim("reason") <> ''
    ),
    CONSTRAINT "recommendations_confidence_check" CHECK (
        "confidenceScore" BETWEEN 0 AND 100
    ),
    CONSTRAINT "recommendations_expiration_check" CHECK (
        "expiresAt" IS NULL OR "expiresAt" > "generatedAt"
    ),
    CONSTRAINT "recommendations_lifecycle_check" CHECK (
        (
            "status" = 'ACTIVE'
            AND "acceptedAt" IS NULL
            AND "dismissedAt" IS NULL
            AND "expiredAt" IS NULL
        )
        OR (
            "status" = 'ACCEPTED'
            AND "acceptedAt" IS NOT NULL
            AND "dismissedAt" IS NULL
            AND "expiredAt" IS NULL
        )
        OR (
            "status" = 'DISMISSED'
            AND "acceptedAt" IS NULL
            AND "dismissedAt" IS NOT NULL
            AND "expiredAt" IS NULL
        )
        OR (
            "status" = 'EXPIRED'
            AND "acceptedAt" IS NULL
            AND "dismissedAt" IS NULL
            AND "expiredAt" IS NOT NULL
        )
    )
);

CREATE TABLE "recommendation_daily_snapshots" (
    "id" TEXT NOT NULL,
    "snapshotDate" DATE NOT NULL,
    "generatedCount" INTEGER NOT NULL,
    "acceptedCount" INTEGER NOT NULL,
    "dismissedCount" INTEGER NOT NULL,
    "expiredCount" INTEGER NOT NULL,
    "activeCount" INTEGER NOT NULL,
    "byCategory" JSONB NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recommendation_daily_snapshots_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "recommendation_daily_snapshots_counts_check" CHECK (
        "generatedCount" >= 0
        AND "acceptedCount" >= 0
        AND "dismissedCount" >= 0
        AND "expiredCount" >= 0
        AND "activeCount" >= 0
    )
);

CREATE UNIQUE INDEX "recommendations_userId_sourceKey_key"
ON "recommendations"("userId", "sourceKey");

CREATE INDEX "recommendations_userId_status_priority_generatedAt_idx"
ON "recommendations"("userId", "status", "priority", "generatedAt");

CREATE INDEX "recommendations_userId_signalKey_status_idx"
ON "recommendations"("userId", "signalKey", "status");

CREATE INDEX "recommendations_status_expiresAt_idx"
ON "recommendations"("status", "expiresAt");

CREATE INDEX "recommendations_category_status_generatedAt_idx"
ON "recommendations"("category", "status", "generatedAt");

CREATE UNIQUE INDEX "recommendation_daily_snapshots_snapshotDate_key"
ON "recommendation_daily_snapshots"("snapshotDate");

CREATE INDEX "recommendation_daily_snapshots_snapshotDate_generatedAt_idx"
ON "recommendation_daily_snapshots"("snapshotDate", "generatedAt");

ALTER TABLE "recommendations"
ADD CONSTRAINT "recommendations_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
