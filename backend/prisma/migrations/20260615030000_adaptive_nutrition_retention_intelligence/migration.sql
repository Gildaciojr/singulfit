-- CreateEnum
CREATE TYPE "FoodQualityClass" AS ENUM ('EXCELLENT', 'GOOD', 'REGULAR', 'POOR');

-- CreateEnum
CREATE TYPE "DietaryPatternType" AS ENUM (
  'HIGH_PROTEIN',
  'LOW_PROTEIN',
  'EXCESS_SUGAR',
  'HIGH_ULTRA_PROCESSED',
  'LOW_HYDRATION',
  'LOW_VARIETY',
  'BALANCED'
);

-- CreateEnum
CREATE TYPE "AdaptiveCommunicationProfile" AS ENUM (
  'EXECUTIVE',
  'TECHNICAL',
  'DISCIPLINED',
  'WARM',
  'INSPIRATIONAL'
);

-- CreateEnum
CREATE TYPE "EarlyChurnLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateTable
CREATE TABLE "nutrition_evidence_snapshots" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "snapshotDate" DATE NOT NULL,
  "score" INTEGER NOT NULL,
  "vegetableScore" INTEGER NOT NULL,
  "proteinScore" INTEGER NOT NULL,
  "ultraProcessedScore" INTEGER NOT NULL,
  "sugarScore" INTEGER NOT NULL,
  "fiberScore" INTEGER NOT NULL,
  "hydrationScore" INTEGER NOT NULL,
  "mealsAnalyzed" INTEGER NOT NULL,
  "evidence" JSONB NOT NULL,
  "calculatedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "nutrition_evidence_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "food_quality_indexes" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "mealAnalysisId" TEXT NOT NULL,
  "qualityClass" "FoodQualityClass" NOT NULL,
  "score" INTEGER NOT NULL,
  "positiveFactors" JSONB NOT NULL,
  "limitingFactors" JSONB NOT NULL,
  "explanation" TEXT NOT NULL,
  "calculatedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "food_quality_indexes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dietary_pattern_snapshots" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "snapshotDate" DATE NOT NULL,
  "pattern" "DietaryPatternType" NOT NULL,
  "confidence" DECIMAL(5,4) NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "evidence" JSONB NOT NULL,
  "calculatedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "dietary_pattern_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_learning_profiles" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "acceptedCount" INTEGER NOT NULL,
  "ignoredCount" INTEGER NOT NULL,
  "rejectedCount" INTEGER NOT NULL,
  "shortChallengeScore" INTEGER NOT NULL,
  "preferredTopics" JSONB NOT NULL,
  "ignoredTopics" JSONB NOT NULL,
  "topicScores" JSONB NOT NULL,
  "confidence" DECIMAL(5,4) NOT NULL,
  "evidence" JSONB NOT NULL,
  "generatedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "user_learning_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "communication_adaptation_snapshots" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "snapshotDate" DATE NOT NULL,
  "profile" "AdaptiveCommunicationProfile" NOT NULL,
  "previousProfile" "AdaptiveCommunicationProfile",
  "executiveScore" INTEGER NOT NULL,
  "technicalScore" INTEGER NOT NULL,
  "disciplinedScore" INTEGER NOT NULL,
  "warmScore" INTEGER NOT NULL,
  "inspirationalScore" INTEGER NOT NULL,
  "idealLength" INTEGER NOT NULL,
  "structurePreference" TEXT NOT NULL,
  "confidence" DECIMAL(5,4) NOT NULL,
  "evidence" JSONB NOT NULL,
  "generatedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "communication_adaptation_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "early_churn_snapshots" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "snapshotDate" DATE NOT NULL,
  "score" INTEGER NOT NULL,
  "level" "EarlyChurnLevel" NOT NULL,
  "engagementScore" INTEGER NOT NULL,
  "consistencyScore" INTEGER NOT NULL,
  "responseScore" INTEGER NOT NULL,
  "usageScore" INTEGER NOT NULL,
  "analysisScore" INTEGER NOT NULL,
  "coachScore" INTEGER NOT NULL,
  "reasons" JSONB NOT NULL,
  "evidence" JSONB NOT NULL,
  "calculatedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "early_churn_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "adaptive_recommendation_ranks" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "snapshotDate" DATE NOT NULL,
  "recommendationId" TEXT NOT NULL,
  "rank" INTEGER NOT NULL,
  "adaptiveScore" INTEGER NOT NULL,
  "baseScore" INTEGER NOT NULL,
  "learningModifier" INTEGER NOT NULL,
  "contextModifier" INTEGER NOT NULL,
  "noveltyModifier" INTEGER NOT NULL,
  "evidence" JSONB NOT NULL,
  "rankedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "adaptive_recommendation_ranks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "longitudinal_nutrition_window_snapshots" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "snapshotDate" DATE NOT NULL,
  "windowDays" INTEGER NOT NULL,
  "score" INTEGER NOT NULL,
  "previousScore" INTEGER,
  "direction" "NutritionTrendDirection" NOT NULL,
  "vegetableScore" INTEGER NOT NULL,
  "proteinScore" INTEGER NOT NULL,
  "ultraProcessedScore" INTEGER NOT NULL,
  "sugarScore" INTEGER NOT NULL,
  "fiberScore" INTEGER NOT NULL,
  "hydrationScore" INTEGER NOT NULL,
  "mealsAnalyzed" INTEGER NOT NULL,
  "evidence" JSONB NOT NULL,
  "calculatedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "longitudinal_nutrition_window_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "nutrition_evidence_snapshots_userId_snapshotDate_key" ON "nutrition_evidence_snapshots"("userId", "snapshotDate");
CREATE INDEX "nutrition_evidence_snapshots_score_calculatedAt_idx" ON "nutrition_evidence_snapshots"("score", "calculatedAt");
CREATE INDEX "nutrition_evidence_snapshots_userId_calculatedAt_idx" ON "nutrition_evidence_snapshots"("userId", "calculatedAt");
CREATE UNIQUE INDEX "food_quality_indexes_mealAnalysisId_key" ON "food_quality_indexes"("mealAnalysisId");
CREATE INDEX "food_quality_indexes_userId_calculatedAt_idx" ON "food_quality_indexes"("userId", "calculatedAt");
CREATE INDEX "food_quality_indexes_qualityClass_calculatedAt_idx" ON "food_quality_indexes"("qualityClass", "calculatedAt");
CREATE UNIQUE INDEX "dietary_pattern_snapshots_userId_snapshotDate_pattern_key" ON "dietary_pattern_snapshots"("userId", "snapshotDate", "pattern");
CREATE INDEX "dietary_pattern_snapshots_pattern_confidence_calculatedAt_idx" ON "dietary_pattern_snapshots"("pattern", "confidence", "calculatedAt");
CREATE INDEX "dietary_pattern_snapshots_userId_calculatedAt_idx" ON "dietary_pattern_snapshots"("userId", "calculatedAt");
CREATE UNIQUE INDEX "user_learning_profiles_userId_key" ON "user_learning_profiles"("userId");
CREATE INDEX "user_learning_profiles_confidence_generatedAt_idx" ON "user_learning_profiles"("confidence", "generatedAt");
CREATE UNIQUE INDEX "communication_adaptation_snapshots_userId_snapshotDate_key" ON "communication_adaptation_snapshots"("userId", "snapshotDate");
CREATE INDEX "communication_adaptation_snapshots_profile_generatedAt_idx" ON "communication_adaptation_snapshots"("profile", "generatedAt");
CREATE INDEX "communication_adaptation_snapshots_userId_generatedAt_idx" ON "communication_adaptation_snapshots"("userId", "generatedAt");
CREATE UNIQUE INDEX "early_churn_snapshots_userId_snapshotDate_key" ON "early_churn_snapshots"("userId", "snapshotDate");
CREATE INDEX "early_churn_snapshots_level_score_calculatedAt_idx" ON "early_churn_snapshots"("level", "score", "calculatedAt");
CREATE INDEX "early_churn_snapshots_userId_calculatedAt_idx" ON "early_churn_snapshots"("userId", "calculatedAt");
CREATE UNIQUE INDEX "adaptive_recommendation_ranks_userId_snapshotDate_recommendationId_key" ON "adaptive_recommendation_ranks"("userId", "snapshotDate", "recommendationId");
CREATE INDEX "adaptive_recommendation_ranks_userId_snapshotDate_rank_idx" ON "adaptive_recommendation_ranks"("userId", "snapshotDate", "rank");
CREATE INDEX "adaptive_recommendation_ranks_adaptiveScore_rankedAt_idx" ON "adaptive_recommendation_ranks"("adaptiveScore", "rankedAt");
CREATE UNIQUE INDEX "longitudinal_nutrition_window_snapshots_userId_snapshotDate_windowDays_key" ON "longitudinal_nutrition_window_snapshots"("userId", "snapshotDate", "windowDays");
CREATE INDEX "longitudinal_nutrition_window_snapshots_userId_windowDays_calculatedAt_idx" ON "longitudinal_nutrition_window_snapshots"("userId", "windowDays", "calculatedAt");
CREATE INDEX "longitudinal_nutrition_window_snapshots_direction_calculatedAt_idx" ON "longitudinal_nutrition_window_snapshots"("direction", "calculatedAt");

-- AddForeignKey
ALTER TABLE "nutrition_evidence_snapshots" ADD CONSTRAINT "nutrition_evidence_snapshots_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "food_quality_indexes" ADD CONSTRAINT "food_quality_indexes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "dietary_pattern_snapshots" ADD CONSTRAINT "dietary_pattern_snapshots_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_learning_profiles" ADD CONSTRAINT "user_learning_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "communication_adaptation_snapshots" ADD CONSTRAINT "communication_adaptation_snapshots_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "early_churn_snapshots" ADD CONSTRAINT "early_churn_snapshots_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "adaptive_recommendation_ranks" ADD CONSTRAINT "adaptive_recommendation_ranks_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "longitudinal_nutrition_window_snapshots" ADD CONSTRAINT "longitudinal_nutrition_window_snapshots_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
