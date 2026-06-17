CREATE TYPE "MealCategory" AS ENUM (
  'BREAKFAST',
  'LUNCH',
  'DINNER',
  'SNACK',
  'UNKNOWN'
);

CREATE TYPE "NutritionInsightType" AS ENUM (
  'LOW_PROTEIN',
  'EXCESS_SUGAR',
  'INSUFFICIENT_HYDRATION',
  'HIGH_ULTRA_PROCESSED',
  'LOW_VEGETABLES',
  'UNBALANCED_MEALS'
);

CREATE TYPE "NutritionInsightStatus" AS ENUM ('ACTIVE', 'RESOLVED');

CREATE TYPE "NutritionRecommendationType" AS ENUM (
  'FOOD_IMPROVEMENT',
  'PROTEIN_ADJUSTMENT',
  'FIBER_ADJUSTMENT',
  'HYDRATION',
  'CONSISTENCY',
  'HABITS'
);

CREATE TYPE "NutritionTrendDirection" AS ENUM (
  'IMPROVING',
  'STABLE',
  'DECLINING'
);

ALTER TABLE "meal_analyses"
  ADD COLUMN "totalFiber" DECIMAL(10, 2),
  ADD COLUMN "totalSugar" DECIMAL(10, 2),
  ADD COLUMN "ultraProcessedRatio" DECIMAL(5, 4),
  ADD COLUMN "vegetableGrams" DECIMAL(10, 2),
  ADD COLUMN "hydrationMl" DECIMAL(10, 2),
  ADD COLUMN "mealCategory" "MealCategory" NOT NULL DEFAULT 'UNKNOWN';

ALTER TABLE "meal_items"
  ADD COLUMN "fiber" DECIMAL(10, 2) NOT NULL DEFAULT 0,
  ADD COLUMN "sugar" DECIMAL(10, 2) NOT NULL DEFAULT 0,
  ADD COLUMN "isUltraProcessed" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "isVegetable" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "nutrition_quality_scores" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "mealAnalysisId" TEXT NOT NULL,
  "score" INTEGER NOT NULL,
  "proteinScore" INTEGER NOT NULL,
  "fiberScore" INTEGER NOT NULL,
  "ultraProcessedScore" INTEGER NOT NULL,
  "sugarScore" INTEGER NOT NULL,
  "fatScore" INTEGER NOT NULL,
  "balanceScore" INTEGER NOT NULL,
  "goalAdherenceScore" INTEGER NOT NULL,
  "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "nutrition_quality_scores_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "nutrition_quality_scores_range_check" CHECK (
    "score" BETWEEN 0 AND 100
    AND "proteinScore" BETWEEN 0 AND 100
    AND "fiberScore" BETWEEN 0 AND 100
    AND "ultraProcessedScore" BETWEEN 0 AND 100
    AND "sugarScore" BETWEEN 0 AND 100
    AND "fatScore" BETWEEN 0 AND 100
    AND "balanceScore" BETWEEN 0 AND 100
    AND "goalAdherenceScore" BETWEEN 0 AND 100
  )
);

CREATE TABLE "nutrition_insights" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "type" "NutritionInsightType" NOT NULL,
  "status" "NutritionInsightStatus" NOT NULL DEFAULT 'ACTIVE',
  "title" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "evidence" JSONB NOT NULL,
  "occurrences" INTEGER NOT NULL DEFAULT 1,
  "firstDetectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastDetectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "nutrition_insights_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "nutrition_insights_occurrences_check" CHECK ("occurrences" > 0)
);

CREATE TABLE "meal_patterns" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "category" "MealCategory" NOT NULL,
  "windowDays" INTEGER NOT NULL DEFAULT 30,
  "mealCount" INTEGER NOT NULL,
  "frequencyPerWeek" DECIMAL(6, 2) NOT NULL,
  "averageQualityScore" INTEGER NOT NULL,
  "recurringFoods" JSONB NOT NULL,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd" TIMESTAMP(3) NOT NULL,
  "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "meal_patterns_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "meal_patterns_values_check" CHECK (
    "windowDays" > 0
    AND "mealCount" >= 0
    AND "frequencyPerWeek" >= 0
    AND "averageQualityScore" BETWEEN 0 AND 100
  )
);

CREATE TABLE "nutrition_trends" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "windowDays" INTEGER NOT NULL,
  "windowStart" TIMESTAMP(3) NOT NULL,
  "windowEnd" TIMESTAMP(3) NOT NULL,
  "mealsAnalyzed" INTEGER NOT NULL,
  "averageQualityScore" INTEGER NOT NULL,
  "previousAverageScore" INTEGER,
  "scoreChange" INTEGER,
  "direction" "NutritionTrendDirection" NOT NULL,
  "consistencyScore" INTEGER NOT NULL,
  "goalAdherenceScore" INTEGER NOT NULL,
  "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "nutrition_trends_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "nutrition_trends_values_check" CHECK (
    "windowDays" IN (7, 30, 90)
    AND "mealsAnalyzed" >= 0
    AND "averageQualityScore" BETWEEN 0 AND 100
    AND ("previousAverageScore" IS NULL OR "previousAverageScore" BETWEEN 0 AND 100)
    AND "consistencyScore" BETWEEN 0 AND 100
    AND "goalAdherenceScore" BETWEEN 0 AND 100
  )
);

CREATE TABLE "nutrition_recommendations" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "insightId" TEXT,
  "type" "NutritionRecommendationType" NOT NULL,
  "sourceKey" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "rationale" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "priority" INTEGER NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "nutrition_recommendations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "nutrition_recommendations_priority_check" CHECK ("priority" BETWEEN 1 AND 5)
);

CREATE UNIQUE INDEX "nutrition_quality_scores_mealAnalysisId_key"
  ON "nutrition_quality_scores"("mealAnalysisId");
CREATE INDEX "nutrition_quality_scores_userId_calculatedAt_idx"
  ON "nutrition_quality_scores"("userId", "calculatedAt");
CREATE INDEX "nutrition_quality_scores_score_calculatedAt_idx"
  ON "nutrition_quality_scores"("score", "calculatedAt");

CREATE UNIQUE INDEX "nutrition_insights_userId_type_key"
  ON "nutrition_insights"("userId", "type");
CREATE INDEX "nutrition_insights_status_lastDetectedAt_idx"
  ON "nutrition_insights"("status", "lastDetectedAt");
CREATE INDEX "nutrition_insights_userId_status_lastDetectedAt_idx"
  ON "nutrition_insights"("userId", "status", "lastDetectedAt");

CREATE UNIQUE INDEX "meal_patterns_userId_category_windowDays_key"
  ON "meal_patterns"("userId", "category", "windowDays");
CREATE INDEX "meal_patterns_userId_calculatedAt_idx"
  ON "meal_patterns"("userId", "calculatedAt");

CREATE UNIQUE INDEX "nutrition_trends_userId_windowDays_windowEnd_key"
  ON "nutrition_trends"("userId", "windowDays", "windowEnd");
CREATE INDEX "nutrition_trends_userId_windowDays_calculatedAt_idx"
  ON "nutrition_trends"("userId", "windowDays", "calculatedAt");
CREATE INDEX "nutrition_trends_calculatedAt_idx"
  ON "nutrition_trends"("calculatedAt");

CREATE UNIQUE INDEX "nutrition_recommendations_userId_type_sourceKey_key"
  ON "nutrition_recommendations"("userId", "type", "sourceKey");
CREATE INDEX "nutrition_recommendations_userId_active_priority_generatedAt_idx"
  ON "nutrition_recommendations"("userId", "active", "priority", "generatedAt");

ALTER TABLE "nutrition_quality_scores"
  ADD CONSTRAINT "nutrition_quality_scores_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "nutrition_quality_scores_mealAnalysisId_fkey"
    FOREIGN KEY ("mealAnalysisId") REFERENCES "meal_analyses"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "nutrition_insights"
  ADD CONSTRAINT "nutrition_insights_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "meal_patterns"
  ADD CONSTRAINT "meal_patterns_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "nutrition_trends"
  ADD CONSTRAINT "nutrition_trends_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "nutrition_recommendations"
  ADD CONSTRAINT "nutrition_recommendations_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "nutrition_recommendations_insightId_fkey"
    FOREIGN KEY ("insightId") REFERENCES "nutrition_insights"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "meal_analyses"
  ADD CONSTRAINT "meal_analyses_ultra_processed_ratio_check"
    CHECK ("ultraProcessedRatio" IS NULL OR "ultraProcessedRatio" BETWEEN 0 AND 1);
