CREATE TYPE "WhatsAppCostCategory" AS ENUM ('INBOUND', 'RESPONSE', 'AUTOMATION');

ALTER TABLE "ai_usage"
ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'OPENAI',
ADD COLUMN "usageDate" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "ai_usage"
SET "usageDate" = "createdAt"::date;

CREATE TABLE "revenue_snapshots" (
    "id" TEXT NOT NULL,
    "snapshotDate" DATE NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'BRL',
    "mrr" DECIMAL(16,2) NOT NULL,
    "arr" DECIMAL(16,2) NOT NULL,
    "arpu" DECIMAL(16,2) NOT NULL,
    "recognizedRevenue" DECIMAL(16,2) NOT NULL,
    "payingUsers" INTEGER NOT NULL,
    "activeSubscriptions" INTEGER NOT NULL,
    "premiumUsers" INTEGER NOT NULL,
    "basicUsers" INTEGER NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "revenue_snapshots_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "revenue_snapshots_nonnegative_check" CHECK (
        "mrr" >= 0 AND "arr" >= 0 AND "arpu" >= 0
        AND "recognizedRevenue" >= 0 AND "payingUsers" >= 0
        AND "activeSubscriptions" >= 0 AND "premiumUsers" >= 0
        AND "basicUsers" >= 0
    )
);

CREATE TABLE "churn_snapshots" (
    "id" TEXT NOT NULL,
    "snapshotDate" DATE NOT NULL,
    "monthlyStartingUsers" INTEGER NOT NULL,
    "monthlyChurnedUsers" INTEGER NOT NULL,
    "monthlyUserChurnRate" DECIMAL(7,4) NOT NULL,
    "monthlyStartingMrr" DECIMAL(16,2) NOT NULL,
    "monthlyChurnedMrr" DECIMAL(16,2) NOT NULL,
    "monthlyRevenueChurnRate" DECIMAL(7,4) NOT NULL,
    "quarterlyStartingUsers" INTEGER NOT NULL,
    "quarterlyChurnedUsers" INTEGER NOT NULL,
    "quarterlyUserChurnRate" DECIMAL(7,4) NOT NULL,
    "quarterlyStartingMrr" DECIMAL(16,2) NOT NULL,
    "quarterlyChurnedMrr" DECIMAL(16,2) NOT NULL,
    "quarterlyRevenueChurnRate" DECIMAL(7,4) NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "churn_snapshots_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "churn_snapshots_rates_check" CHECK (
        "monthlyUserChurnRate" BETWEEN 0 AND 100
        AND "monthlyRevenueChurnRate" BETWEEN 0 AND 100
        AND "quarterlyUserChurnRate" BETWEEN 0 AND 100
        AND "quarterlyRevenueChurnRate" BETWEEN 0 AND 100
    )
);

CREATE TABLE "retention_snapshots" (
    "id" TEXT NOT NULL,
    "snapshotDate" DATE NOT NULL,
    "d1CohortSize" INTEGER NOT NULL,
    "d1Retained" INTEGER NOT NULL,
    "d1Rate" DECIMAL(7,4) NOT NULL,
    "d7CohortSize" INTEGER NOT NULL,
    "d7Retained" INTEGER NOT NULL,
    "d7Rate" DECIMAL(7,4) NOT NULL,
    "d30CohortSize" INTEGER NOT NULL,
    "d30Retained" INTEGER NOT NULL,
    "d30Rate" DECIMAL(7,4) NOT NULL,
    "retentionRate" DECIMAL(7,4) NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "retention_snapshots_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "retention_snapshots_rates_check" CHECK (
        "d1Rate" BETWEEN 0 AND 100
        AND "d7Rate" BETWEEN 0 AND 100
        AND "d30Rate" BETWEEN 0 AND 100
        AND "retentionRate" BETWEEN 0 AND 100
    )
);

CREATE TABLE "cost_snapshots" (
    "id" TEXT NOT NULL,
    "snapshotDate" DATE NOT NULL,
    "aiInputTokens" INTEGER NOT NULL,
    "aiOutputTokens" INTEGER NOT NULL,
    "aiTotalTokens" INTEGER NOT NULL,
    "aiCostUsd" DECIMAL(16,8) NOT NULL,
    "aiCostBrl" DECIMAL(16,8) NOT NULL,
    "aiByProvider" JSONB NOT NULL DEFAULT '{}',
    "aiByModel" JSONB NOT NULL DEFAULT '{}',
    "whatsappSent" INTEGER NOT NULL,
    "whatsappReceived" INTEGER NOT NULL,
    "whatsappCostBrl" DECIMAL(16,8) NOT NULL,
    "storageImages" INTEGER NOT NULL,
    "storageUploads" INTEGER NOT NULL,
    "storageTotalBytes" BIGINT NOT NULL,
    "storageCostBrl" DECIMAL(16,8) NOT NULL,
    "totalOperationalCost" DECIMAL(16,8) NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cost_snapshots_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "cost_snapshots_nonnegative_check" CHECK (
        "aiInputTokens" >= 0 AND "aiOutputTokens" >= 0
        AND "aiTotalTokens" >= 0 AND "aiCostUsd" >= 0
        AND "aiCostBrl" >= 0 AND "whatsappSent" >= 0
        AND "whatsappReceived" >= 0 AND "whatsappCostBrl" >= 0
        AND "storageImages" >= 0 AND "storageUploads" >= 0
        AND "storageTotalBytes" >= 0 AND "storageCostBrl" >= 0
        AND "totalOperationalCost" >= 0
    )
);

CREATE TABLE "whatsapp_cost_snapshots" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "snapshotDate" DATE NOT NULL,
    "category" "WhatsAppCostCategory" NOT NULL,
    "sentMessages" INTEGER NOT NULL,
    "receivedMessages" INTEGER NOT NULL,
    "estimatedCost" DECIMAL(16,8) NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'BRL',
    "generatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_cost_snapshots_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "whatsapp_cost_snapshots_nonnegative_check" CHECK (
        "sentMessages" >= 0 AND "receivedMessages" >= 0
        AND "estimatedCost" >= 0
    )
);

CREATE TABLE "storage_cost_snapshots" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "snapshotDate" DATE NOT NULL,
    "imageCount" INTEGER NOT NULL,
    "uploadCount" INTEGER NOT NULL,
    "totalBytes" BIGINT NOT NULL,
    "estimatedCost" DECIMAL(16,8) NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'BRL',
    "generatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "storage_cost_snapshots_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "storage_cost_snapshots_nonnegative_check" CHECK (
        "imageCount" >= 0 AND "uploadCount" >= 0
        AND "totalBytes" >= 0 AND "estimatedCost" >= 0
    )
);

CREATE TABLE "user_profitability_snapshots" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "snapshotDate" DATE NOT NULL,
    "planType" "PlanType" NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'BRL',
    "monthlyRevenue" DECIMAL(16,2) NOT NULL,
    "aiCost" DECIMAL(16,8) NOT NULL,
    "whatsappCost" DECIMAL(16,8) NOT NULL,
    "storageCost" DECIMAL(16,8) NOT NULL,
    "estimatedProfit" DECIMAL(16,8) NOT NULL,
    "marginPercent" DECIMAL(7,4) NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_profitability_snapshots_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "user_profitability_costs_check" CHECK (
        "monthlyRevenue" >= 0 AND "aiCost" >= 0
        AND "whatsappCost" >= 0 AND "storageCost" >= 0
    )
);

CREATE TABLE "plan_performance_snapshots" (
    "id" TEXT NOT NULL,
    "snapshotDate" DATE NOT NULL,
    "planType" "PlanType" NOT NULL,
    "payingUsers" INTEGER NOT NULL,
    "retentionRate" DECIMAL(7,4) NOT NULL,
    "churnRate" DECIMAL(7,4) NOT NULL,
    "monthlyRevenue" DECIMAL(16,2) NOT NULL,
    "estimatedProfit" DECIMAL(16,8) NOT NULL,
    "marginPercent" DECIMAL(7,4) NOT NULL,
    "aiTokens" INTEGER NOT NULL,
    "aiCost" DECIMAL(16,8) NOT NULL,
    "whatsappMessages" INTEGER NOT NULL,
    "whatsappCost" DECIMAL(16,8) NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plan_performance_snapshots_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "plan_performance_rates_check" CHECK (
        "retentionRate" BETWEEN 0 AND 100
        AND "churnRate" BETWEEN 0 AND 100
    )
);

CREATE TABLE "growth_snapshots" (
    "id" TEXT NOT NULL,
    "snapshotDate" DATE NOT NULL,
    "newUsers" INTEGER NOT NULL,
    "newUsersMonthly" INTEGER NOT NULL,
    "newUsersQuarterly" INTEGER NOT NULL,
    "activeUsers" INTEGER NOT NULL,
    "payingUsers" INTEGER NOT NULL,
    "monthlyGrowthRate" DECIMAL(9,4) NOT NULL,
    "quarterlyGrowthRate" DECIMAL(9,4) NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "growth_snapshots_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "growth_snapshots_nonnegative_check" CHECK (
        "newUsers" >= 0 AND "newUsersMonthly" >= 0
        AND "newUsersQuarterly" >= 0 AND "activeUsers" >= 0
        AND "payingUsers" >= 0
    )
);

CREATE UNIQUE INDEX "revenue_snapshots_snapshotDate_key" ON "revenue_snapshots"("snapshotDate");
CREATE INDEX "revenue_snapshots_snapshotDate_generatedAt_idx" ON "revenue_snapshots"("snapshotDate", "generatedAt");
CREATE UNIQUE INDEX "churn_snapshots_snapshotDate_key" ON "churn_snapshots"("snapshotDate");
CREATE INDEX "churn_snapshots_snapshotDate_generatedAt_idx" ON "churn_snapshots"("snapshotDate", "generatedAt");
CREATE UNIQUE INDEX "retention_snapshots_snapshotDate_key" ON "retention_snapshots"("snapshotDate");
CREATE INDEX "retention_snapshots_snapshotDate_generatedAt_idx" ON "retention_snapshots"("snapshotDate", "generatedAt");
CREATE UNIQUE INDEX "cost_snapshots_snapshotDate_key" ON "cost_snapshots"("snapshotDate");
CREATE INDEX "cost_snapshots_snapshotDate_generatedAt_idx" ON "cost_snapshots"("snapshotDate", "generatedAt");
CREATE UNIQUE INDEX "whatsapp_cost_snapshots_userId_snapshotDate_category_key" ON "whatsapp_cost_snapshots"("userId", "snapshotDate", "category");
CREATE INDEX "whatsapp_cost_snapshots_snapshotDate_category_idx" ON "whatsapp_cost_snapshots"("snapshotDate", "category");
CREATE INDEX "whatsapp_cost_snapshots_userId_snapshotDate_idx" ON "whatsapp_cost_snapshots"("userId", "snapshotDate");
CREATE UNIQUE INDEX "storage_cost_snapshots_userId_snapshotDate_key" ON "storage_cost_snapshots"("userId", "snapshotDate");
CREATE INDEX "storage_cost_snapshots_snapshotDate_idx" ON "storage_cost_snapshots"("snapshotDate");
CREATE INDEX "storage_cost_snapshots_userId_snapshotDate_idx" ON "storage_cost_snapshots"("userId", "snapshotDate");
CREATE UNIQUE INDEX "user_profitability_snapshots_userId_snapshotDate_key" ON "user_profitability_snapshots"("userId", "snapshotDate");
CREATE INDEX "user_profitability_snapshots_snapshotDate_estimatedProfit_idx" ON "user_profitability_snapshots"("snapshotDate", "estimatedProfit");
CREATE INDEX "user_profitability_snapshots_planType_snapshotDate_idx" ON "user_profitability_snapshots"("planType", "snapshotDate");
CREATE UNIQUE INDEX "plan_performance_snapshots_snapshotDate_planType_key" ON "plan_performance_snapshots"("snapshotDate", "planType");
CREATE INDEX "plan_performance_snapshots_planType_snapshotDate_idx" ON "plan_performance_snapshots"("planType", "snapshotDate");
CREATE UNIQUE INDEX "growth_snapshots_snapshotDate_key" ON "growth_snapshots"("snapshotDate");
CREATE INDEX "growth_snapshots_snapshotDate_generatedAt_idx" ON "growth_snapshots"("snapshotDate", "generatedAt");
CREATE INDEX "ai_usage_userId_usageDate_idx" ON "ai_usage"("userId", "usageDate");
CREATE INDEX "ai_usage_provider_usageDate_idx" ON "ai_usage"("provider", "usageDate");

ALTER TABLE "whatsapp_cost_snapshots"
ADD CONSTRAINT "whatsapp_cost_snapshots_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "storage_cost_snapshots"
ADD CONSTRAINT "storage_cost_snapshots_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_profitability_snapshots"
ADD CONSTRAINT "user_profitability_snapshots_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
