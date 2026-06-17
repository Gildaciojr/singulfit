CREATE TYPE "CoachCommunicationStyle" AS ENUM (
  'FORMAL',
  'BALANCED',
  'FRIENDLY'
);

CREATE TYPE "CoachCoachingStyle" AS ENUM (
  'EDUCATOR',
  'ACCOUNTABILITY',
  'MOTIVATIONAL'
);

CREATE TYPE "CoachTone" AS ENUM (
  'SOFT',
  'MODERATE',
  'DIRECT'
);

CREATE TYPE "CoachMotivationStyle" AS ENUM (
  'DATA_DRIVEN',
  'ACHIEVEMENT',
  'HEALTH',
  'APPEARANCE'
);

CREATE TYPE "UserGoalType" AS ENUM (
  'WEIGHT_LOSS',
  'HYPERTROPHY',
  'MAINTENANCE',
  'HEALTH'
);

CREATE TYPE "ChurnRiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

CREATE TYPE "CoachMessageType" AS ENUM (
  'INCENTIVE',
  'POSITIVE_REINFORCEMENT',
  'FOLLOW_UP',
  'RECOVERY'
);

CREATE TYPE "CoachReviewType" AS ENUM ('WEEKLY', 'MONTHLY');

CREATE TABLE "coach_profiles" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "communicationStyle" "CoachCommunicationStyle" NOT NULL DEFAULT 'BALANCED',
  "coachingStyle" "CoachCoachingStyle" NOT NULL DEFAULT 'EDUCATOR',
  "tone" "CoachTone" NOT NULL DEFAULT 'MODERATE',
  "motivationStyle" "CoachMotivationStyle" NOT NULL DEFAULT 'HEALTH',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "coach_profiles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "user_goal_classifications" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "goal" "UserGoalType" NOT NULL,
  "confidence" DECIMAL(5, 4) NOT NULL,
  "evidence" JSONB NOT NULL,
  "classifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "user_goal_classifications_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "user_goal_classifications_confidence_check"
    CHECK ("confidence" BETWEEN 0 AND 1)
);

CREATE TABLE "habit_snapshots" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "snapshotDate" DATE NOT NULL,
  "windowDays" INTEGER NOT NULL DEFAULT 30,
  "mealsRegistered" INTEGER NOT NULL,
  "messagesSent" INTEGER NOT NULL,
  "activeDays" INTEGER NOT NULL,
  "consecutiveDays" INTEGER NOT NULL,
  "daysSinceInteraction" INTEGER NOT NULL,
  "mealFrequency" DECIMAL(6, 2) NOT NULL,
  "interactionFrequency" DECIMAL(6, 2) NOT NULL,
  "regularityScore" INTEGER NOT NULL,
  "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "habit_snapshots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "habit_snapshots_values_check" CHECK (
    "windowDays" > 0
    AND "mealsRegistered" >= 0
    AND "messagesSent" >= 0
    AND "activeDays" >= 0
    AND "consecutiveDays" >= 0
    AND "daysSinceInteraction" >= 0
    AND "mealFrequency" >= 0
    AND "interactionFrequency" >= 0
    AND "regularityScore" BETWEEN 0 AND 100
  )
);

CREATE TABLE "consistency_scores" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "snapshotDate" DATE NOT NULL,
  "score" INTEGER NOT NULL,
  "frequencyScore" INTEGER NOT NULL,
  "regularityScore" INTEGER NOT NULL,
  "adherenceScore" INTEGER NOT NULL,
  "continuityScore" INTEGER NOT NULL,
  "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "consistency_scores_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "consistency_scores_range_check" CHECK (
    "score" BETWEEN 0 AND 100
    AND "frequencyScore" BETWEEN 0 AND 100
    AND "regularityScore" BETWEEN 0 AND 100
    AND "adherenceScore" BETWEEN 0 AND 100
    AND "continuityScore" BETWEEN 0 AND 100
  )
);

CREATE TABLE "engagement_scores" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "snapshotDate" DATE NOT NULL,
  "score" INTEGER NOT NULL,
  "messagesScore" INTEGER NOT NULL,
  "analysesScore" INTEGER NOT NULL,
  "weeklyUsageScore" INTEGER NOT NULL,
  "monthlyUsageScore" INTEGER NOT NULL,
  "messagesLast7Days" INTEGER NOT NULL,
  "messagesLast30Days" INTEGER NOT NULL,
  "analysesLast7Days" INTEGER NOT NULL,
  "analysesLast30Days" INTEGER NOT NULL,
  "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "engagement_scores_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "engagement_scores_range_check" CHECK (
    "score" BETWEEN 0 AND 100
    AND "messagesScore" BETWEEN 0 AND 100
    AND "analysesScore" BETWEEN 0 AND 100
    AND "weeklyUsageScore" BETWEEN 0 AND 100
    AND "monthlyUsageScore" BETWEEN 0 AND 100
    AND "messagesLast7Days" >= 0
    AND "messagesLast30Days" >= 0
    AND "analysesLast7Days" >= 0
    AND "analysesLast30Days" >= 0
  )
);

CREATE TABLE "churn_risk_assessments" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "snapshotDate" DATE NOT NULL,
  "level" "ChurnRiskLevel" NOT NULL,
  "previousLevel" "ChurnRiskLevel",
  "reasons" JSONB NOT NULL,
  "daysInactive" INTEGER NOT NULL,
  "engagementScore" INTEGER NOT NULL,
  "consistencyScore" INTEGER NOT NULL,
  "activityDrop" INTEGER NOT NULL,
  "assessedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "churn_risk_assessments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "churn_risk_assessments_values_check" CHECK (
    "daysInactive" >= 0
    AND "engagementScore" BETWEEN 0 AND 100
    AND "consistencyScore" BETWEEN 0 AND 100
    AND "activityDrop" BETWEEN 0 AND 100
  )
);

CREATE TABLE "coach_messages" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "type" "CoachMessageType" NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "context" JSONB NOT NULL,
  "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "scheduledFor" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "coach_messages_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "coach_messages_content_check"
    CHECK (length(btrim("content")) BETWEEN 1 AND 10000)
);

CREATE TABLE "coach_reviews" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "type" "CoachReviewType" NOT NULL,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd" TIMESTAMP(3) NOT NULL,
  "content" TEXT NOT NULL,
  "averageNutritionScore" INTEGER NOT NULL,
  "consistencyScore" INTEGER NOT NULL,
  "engagementScore" INTEGER NOT NULL,
  "trendSummary" TEXT NOT NULL,
  "achievements" JSONB NOT NULL,
  "opportunities" JSONB NOT NULL,
  "recommendations" JSONB NOT NULL,
  "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "coach_reviews_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "coach_reviews_score_check" CHECK (
    "averageNutritionScore" BETWEEN 0 AND 100
    AND "consistencyScore" BETWEEN 0 AND 100
    AND "engagementScore" BETWEEN 0 AND 100
  ),
  CONSTRAINT "coach_reviews_content_check"
    CHECK (length(btrim("content")) BETWEEN 1 AND 10000)
);

CREATE UNIQUE INDEX "coach_profiles_userId_key"
  ON "coach_profiles"("userId");
CREATE UNIQUE INDEX "user_goal_classifications_userId_key"
  ON "user_goal_classifications"("userId");
CREATE INDEX "user_goal_classifications_goal_classifiedAt_idx"
  ON "user_goal_classifications"("goal", "classifiedAt");

CREATE UNIQUE INDEX "habit_snapshots_userId_snapshotDate_key"
  ON "habit_snapshots"("userId", "snapshotDate");
CREATE INDEX "habit_snapshots_snapshotDate_idx"
  ON "habit_snapshots"("snapshotDate");
CREATE INDEX "habit_snapshots_userId_calculatedAt_idx"
  ON "habit_snapshots"("userId", "calculatedAt");

CREATE UNIQUE INDEX "consistency_scores_userId_snapshotDate_key"
  ON "consistency_scores"("userId", "snapshotDate");
CREATE INDEX "consistency_scores_userId_calculatedAt_idx"
  ON "consistency_scores"("userId", "calculatedAt");
CREATE INDEX "consistency_scores_score_calculatedAt_idx"
  ON "consistency_scores"("score", "calculatedAt");

CREATE UNIQUE INDEX "engagement_scores_userId_snapshotDate_key"
  ON "engagement_scores"("userId", "snapshotDate");
CREATE INDEX "engagement_scores_userId_calculatedAt_idx"
  ON "engagement_scores"("userId", "calculatedAt");
CREATE INDEX "engagement_scores_score_calculatedAt_idx"
  ON "engagement_scores"("score", "calculatedAt");

CREATE UNIQUE INDEX "churn_risk_assessments_userId_snapshotDate_key"
  ON "churn_risk_assessments"("userId", "snapshotDate");
CREATE INDEX "churn_risk_assessments_level_assessedAt_idx"
  ON "churn_risk_assessments"("level", "assessedAt");
CREATE INDEX "churn_risk_assessments_userId_assessedAt_idx"
  ON "churn_risk_assessments"("userId", "assessedAt");

CREATE UNIQUE INDEX "coach_messages_idempotencyKey_key"
  ON "coach_messages"("idempotencyKey");
CREATE INDEX "coach_messages_userId_generatedAt_idx"
  ON "coach_messages"("userId", "generatedAt");
CREATE INDEX "coach_messages_type_generatedAt_idx"
  ON "coach_messages"("type", "generatedAt");

CREATE UNIQUE INDEX "coach_reviews_userId_type_periodStart_periodEnd_key"
  ON "coach_reviews"("userId", "type", "periodStart", "periodEnd");
CREATE INDEX "coach_reviews_userId_generatedAt_idx"
  ON "coach_reviews"("userId", "generatedAt");
CREATE INDEX "coach_reviews_type_generatedAt_idx"
  ON "coach_reviews"("type", "generatedAt");

ALTER TABLE "coach_profiles"
  ADD CONSTRAINT "coach_profiles_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_goal_classifications"
  ADD CONSTRAINT "user_goal_classifications_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "habit_snapshots"
  ADD CONSTRAINT "habit_snapshots_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "consistency_scores"
  ADD CONSTRAINT "consistency_scores_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "engagement_scores"
  ADD CONSTRAINT "engagement_scores_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "churn_risk_assessments"
  ADD CONSTRAINT "churn_risk_assessments_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "coach_messages"
  ADD CONSTRAINT "coach_messages_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "coach_reviews"
  ADD CONSTRAINT "coach_reviews_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "automation_rules" ("id", "code", "name", "enabled", "createdAt")
VALUES
  (gen_random_uuid()::text, 'DAILY_COACH', 'Coach diário', true, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'WEEKLY_REVIEW', 'Revisão semanal', true, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'MONTHLY_REVIEW', 'Revisão mensal', true, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'REENGAGEMENT', 'Reengajamento', true, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;
