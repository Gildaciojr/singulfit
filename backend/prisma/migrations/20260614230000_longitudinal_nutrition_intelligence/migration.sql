-- CreateEnum
CREATE TYPE "LongitudinalDirection" AS ENUM ('IMPROVING', 'STABLE', 'DECLINING');

-- CreateEnum
CREATE TYPE "FoodPreferenceKind" AS ENUM ('FREQUENT', 'ACCEPTED', 'AVOIDED', 'REJECTED');

-- CreateEnum
CREATE TYPE "NutritionRelapseSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "GoalProgressionState" AS ENUM ('IMPROVING', 'STABLE', 'DECLINING');

-- CreateEnum
CREATE TYPE "LongitudinalMemoryKind" AS ENUM ('VICTORY', 'DIFFICULTY', 'RELAPSE', 'ACHIEVEMENT', 'POSITIVE_HABIT');

-- CreateEnum
CREATE TYPE "CoachAdaptationMode" AS ENUM ('TECHNICAL', 'ENCOURAGING', 'RECOVERY', 'PERFORMANCE');

-- CreateTable
CREATE TABLE "longitudinal_nutrition_profiles" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "sourceKey" TEXT NOT NULL,
  "mealAnalysisId" TEXT NOT NULL,
  "historySize" INTEGER NOT NULL,
  "adherenceScore" INTEGER NOT NULL,
  "consistencyScore" INTEGER NOT NULL,
  "preferenceSummary" JSONB NOT NULL,
  "evolutionSummary" JSONB NOT NULL,
  "regressionSummary" JSONB NOT NULL,
  "generatedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "longitudinal_nutrition_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "food_preference_snapshots" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "sourceKey" TEXT NOT NULL,
  "foodName" TEXT NOT NULL,
  "normalizedFood" TEXT NOT NULL,
  "kind" "FoodPreferenceKind" NOT NULL,
  "confidence" DECIMAL(5,4) NOT NULL,
  "occurrences" INTEGER NOT NULL,
  "evidence" JSONB NOT NULL,
  "observedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "food_preference_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nutrition_evolution_snapshots" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "sourceKey" TEXT NOT NULL,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd" TIMESTAMP(3) NOT NULL,
  "mealsAnalyzed" INTEGER NOT NULL,
  "qualityScore" INTEGER NOT NULL,
  "hydrationScore" INTEGER NOT NULL,
  "vegetableScore" INTEGER NOT NULL,
  "ultraProcessedScore" INTEGER NOT NULL,
  "sugarScore" INTEGER NOT NULL,
  "proteinScore" INTEGER NOT NULL,
  "qualityDirection" "LongitudinalDirection" NOT NULL,
  "hydrationDirection" "LongitudinalDirection" NOT NULL,
  "vegetableDirection" "LongitudinalDirection" NOT NULL,
  "ultraProcessedDirection" "LongitudinalDirection" NOT NULL,
  "sugarDirection" "LongitudinalDirection" NOT NULL,
  "proteinDirection" "LongitudinalDirection" NOT NULL,
  "overallDirection" "LongitudinalDirection" NOT NULL,
  "evidence" JSONB NOT NULL,
  "generatedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "nutrition_evolution_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nutrition_relapses" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "sourceKey" TEXT NOT NULL,
  "severity" "NutritionRelapseSeverity" NOT NULL,
  "reasons" JSONB NOT NULL,
  "evidence" JSONB NOT NULL,
  "detectedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "nutrition_relapses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goal_progression_snapshots" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "sourceKey" TEXT NOT NULL,
  "goal" "UserGoalType" NOT NULL,
  "state" "GoalProgressionState" NOT NULL,
  "score" INTEGER NOT NULL,
  "behaviorScore" INTEGER NOT NULL,
  "consistencyScore" INTEGER NOT NULL,
  "nutritionScore" INTEGER NOT NULL,
  "adherenceScore" INTEGER NOT NULL,
  "evidence" JSONB NOT NULL,
  "generatedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "goal_progression_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "longitudinal_memories" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "sourceKey" TEXT NOT NULL,
  "kind" "LongitudinalMemoryKind" NOT NULL,
  "title" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "evidence" JSONB NOT NULL,
  "confidence" DECIMAL(5,4) NOT NULL,
  "generatedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "longitudinal_memories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coach_adaptation_snapshots" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "sourceKey" TEXT NOT NULL,
  "mode" "CoachAdaptationMode" NOT NULL,
  "technicalLevel" INTEGER NOT NULL,
  "encouragementLevel" INTEGER NOT NULL,
  "recoveryLevel" INTEGER NOT NULL,
  "performanceLevel" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "evidence" JSONB NOT NULL,
  "generatedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "coach_adaptation_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recommendation_feedback_snapshots" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "sourceKey" TEXT NOT NULL,
  "acceptedCount" INTEGER NOT NULL,
  "ignoredCount" INTEGER NOT NULL,
  "rejectedCount" INTEGER NOT NULL,
  "acceptanceRate" INTEGER NOT NULL,
  "categoryScores" JSONB NOT NULL,
  "signalScores" JSONB NOT NULL,
  "generatedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "recommendation_feedback_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monthly_evolution_reviews" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "monthStart" DATE NOT NULL,
  "periodEnd" DATE NOT NULL,
  "direction" "LongitudinalDirection" NOT NULL,
  "evolution" JSONB NOT NULL,
  "regressions" JSONB NOT NULL,
  "habits" JSONB NOT NULL,
  "victories" JSONB NOT NULL,
  "recommendations" JSONB NOT NULL,
  "content" TEXT NOT NULL,
  "generatedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "monthly_evolution_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "longitudinal_nutrition_profiles_sourceKey_key" ON "longitudinal_nutrition_profiles"("sourceKey");
CREATE INDEX "longitudinal_nutrition_profiles_userId_generatedAt_idx" ON "longitudinal_nutrition_profiles"("userId", "generatedAt");
CREATE INDEX "longitudinal_nutrition_profiles_mealAnalysisId_idx" ON "longitudinal_nutrition_profiles"("mealAnalysisId");
CREATE UNIQUE INDEX "food_preference_snapshots_sourceKey_key" ON "food_preference_snapshots"("sourceKey");
CREATE INDEX "food_preference_snapshots_userId_normalizedFood_observedAt_idx" ON "food_preference_snapshots"("userId", "normalizedFood", "observedAt");
CREATE INDEX "food_preference_snapshots_kind_confidence_observedAt_idx" ON "food_preference_snapshots"("kind", "confidence", "observedAt");
CREATE UNIQUE INDEX "nutrition_evolution_snapshots_sourceKey_key" ON "nutrition_evolution_snapshots"("sourceKey");
CREATE INDEX "nutrition_evolution_snapshots_userId_generatedAt_idx" ON "nutrition_evolution_snapshots"("userId", "generatedAt");
CREATE INDEX "nutrition_evolution_snapshots_overallDirection_generatedAt_idx" ON "nutrition_evolution_snapshots"("overallDirection", "generatedAt");
CREATE UNIQUE INDEX "nutrition_relapses_sourceKey_key" ON "nutrition_relapses"("sourceKey");
CREATE INDEX "nutrition_relapses_userId_detectedAt_idx" ON "nutrition_relapses"("userId", "detectedAt");
CREATE INDEX "nutrition_relapses_severity_detectedAt_idx" ON "nutrition_relapses"("severity", "detectedAt");
CREATE UNIQUE INDEX "goal_progression_snapshots_sourceKey_key" ON "goal_progression_snapshots"("sourceKey");
CREATE INDEX "goal_progression_snapshots_userId_generatedAt_idx" ON "goal_progression_snapshots"("userId", "generatedAt");
CREATE INDEX "goal_progression_snapshots_goal_state_generatedAt_idx" ON "goal_progression_snapshots"("goal", "state", "generatedAt");
CREATE UNIQUE INDEX "longitudinal_memories_sourceKey_key" ON "longitudinal_memories"("sourceKey");
CREATE INDEX "longitudinal_memories_userId_generatedAt_idx" ON "longitudinal_memories"("userId", "generatedAt");
CREATE INDEX "longitudinal_memories_userId_kind_generatedAt_idx" ON "longitudinal_memories"("userId", "kind", "generatedAt");
CREATE UNIQUE INDEX "coach_adaptation_snapshots_sourceKey_key" ON "coach_adaptation_snapshots"("sourceKey");
CREATE INDEX "coach_adaptation_snapshots_userId_generatedAt_idx" ON "coach_adaptation_snapshots"("userId", "generatedAt");
CREATE INDEX "coach_adaptation_snapshots_mode_generatedAt_idx" ON "coach_adaptation_snapshots"("mode", "generatedAt");
CREATE UNIQUE INDEX "recommendation_feedback_snapshots_sourceKey_key" ON "recommendation_feedback_snapshots"("sourceKey");
CREATE INDEX "recommendation_feedback_snapshots_userId_generatedAt_idx" ON "recommendation_feedback_snapshots"("userId", "generatedAt");
CREATE UNIQUE INDEX "monthly_evolution_reviews_userId_monthStart_key" ON "monthly_evolution_reviews"("userId", "monthStart");
CREATE INDEX "monthly_evolution_reviews_monthStart_direction_idx" ON "monthly_evolution_reviews"("monthStart", "direction");
CREATE INDEX "monthly_evolution_reviews_userId_generatedAt_idx" ON "monthly_evolution_reviews"("userId", "generatedAt");

-- AddForeignKey
ALTER TABLE "longitudinal_nutrition_profiles" ADD CONSTRAINT "longitudinal_nutrition_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "food_preference_snapshots" ADD CONSTRAINT "food_preference_snapshots_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "nutrition_evolution_snapshots" ADD CONSTRAINT "nutrition_evolution_snapshots_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "nutrition_relapses" ADD CONSTRAINT "nutrition_relapses_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "goal_progression_snapshots" ADD CONSTRAINT "goal_progression_snapshots_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "longitudinal_memories" ADD CONSTRAINT "longitudinal_memories_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "coach_adaptation_snapshots" ADD CONSTRAINT "coach_adaptation_snapshots_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "recommendation_feedback_snapshots" ADD CONSTRAINT "recommendation_feedback_snapshots_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "monthly_evolution_reviews" ADD CONSTRAINT "monthly_evolution_reviews_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
