CREATE TYPE "MemoryType" AS ENUM (
  'SHORT_TERM',
  'LONG_TERM'
);

CREATE TABLE "nutrition_profiles" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "sex" "Gender" NOT NULL,
  "birthDate" DATE NOT NULL,
  "heightCm" INTEGER NOT NULL,
  "currentWeightKg" DECIMAL(6, 2) NOT NULL,
  "targetWeightKg" DECIMAL(6, 2) NOT NULL,
  "activityLevel" "ActivityLevel" NOT NULL,
  "goal" "FitnessGoal" NOT NULL,
  "restrictions" JSONB NOT NULL DEFAULT '[]',
  "allergies" JSONB NOT NULL DEFAULT '[]',
  "medicalConditions" JSONB NOT NULL DEFAULT '[]',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "nutrition_profiles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "user_preferences" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "preferredWakeUpTime" TEXT,
  "preferredSleepTime" TEXT,
  "preferredTrainingTime" TEXT,
  "preferredMealTimes" JSONB NOT NULL DEFAULT '[]',
  "preferredLanguage" TEXT NOT NULL DEFAULT 'pt-BR',
  "timezone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "conversation_memories" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "memoryType" "MemoryType" NOT NULL,
  "sourceKey" TEXT,
  "content" JSONB NOT NULL,
  "summary" TEXT NOT NULL,
  "relevanceScore" DECIMAL(5, 4) NOT NULL,
  "generatedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "conversation_memories_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "user_context_snapshots" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "refreshKey" TEXT NOT NULL,
  "weightKg" DECIMAL(6, 2),
  "goal" "FitnessGoal",
  "activityLevel" "ActivityLevel",
  "lastInteractionAt" TIMESTAMP(3),
  "messagesLast7Days" INTEGER NOT NULL,
  "messagesLast30Days" INTEGER NOT NULL,
  "nutritionAnalysesCount" INTEGER NOT NULL,
  "adherenceScore" INTEGER,
  "generatedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_context_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "nutrition_profiles_userId_key"
  ON "nutrition_profiles"("userId");

CREATE INDEX "nutrition_profiles_goal_activityLevel_idx"
  ON "nutrition_profiles"("goal", "activityLevel");

CREATE UNIQUE INDEX "user_preferences_userId_key"
  ON "user_preferences"("userId");

CREATE INDEX "user_preferences_timezone_idx"
  ON "user_preferences"("timezone");

CREATE UNIQUE INDEX "conversation_memories_userId_memoryType_sourceKey_key"
  ON "conversation_memories"("userId", "memoryType", "sourceKey");

CREATE INDEX "conversation_memories_userId_relevanceScore_generatedAt_idx"
  ON "conversation_memories"("userId", "relevanceScore", "generatedAt");

CREATE INDEX "conversation_memories_userId_memoryType_generatedAt_idx"
  ON "conversation_memories"("userId", "memoryType", "generatedAt");

CREATE UNIQUE INDEX "user_context_snapshots_refreshKey_key"
  ON "user_context_snapshots"("refreshKey");

CREATE INDEX "user_context_snapshots_userId_generatedAt_idx"
  ON "user_context_snapshots"("userId", "generatedAt");

CREATE INDEX "user_context_snapshots_generatedAt_idx"
  ON "user_context_snapshots"("generatedAt");

ALTER TABLE "nutrition_profiles"
  ADD CONSTRAINT "nutrition_profiles_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "nutrition_profiles_height_check"
    CHECK ("heightCm" BETWEEN 50 AND 300),
  ADD CONSTRAINT "nutrition_profiles_weight_check"
    CHECK ("currentWeightKg" > 0 AND "targetWeightKg" > 0);

ALTER TABLE "user_preferences"
  ADD CONSTRAINT "user_preferences_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "user_preferences_wake_time_check"
    CHECK (
      "preferredWakeUpTime" IS NULL
      OR "preferredWakeUpTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    ),
  ADD CONSTRAINT "user_preferences_sleep_time_check"
    CHECK (
      "preferredSleepTime" IS NULL
      OR "preferredSleepTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    ),
  ADD CONSTRAINT "user_preferences_training_time_check"
    CHECK (
      "preferredTrainingTime" IS NULL
      OR "preferredTrainingTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    ),
  ADD CONSTRAINT "user_preferences_language_check"
    CHECK (length(btrim("preferredLanguage")) BETWEEN 2 AND 20),
  ADD CONSTRAINT "user_preferences_timezone_check"
    CHECK (length(btrim("timezone")) BETWEEN 1 AND 100);

ALTER TABLE "conversation_memories"
  ADD CONSTRAINT "conversation_memories_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "conversation_memories_source_key_check"
    CHECK ("sourceKey" IS NULL OR length(btrim("sourceKey")) BETWEEN 1 AND 255),
  ADD CONSTRAINT "conversation_memories_summary_check"
    CHECK (length(btrim("summary")) BETWEEN 1 AND 2000),
  ADD CONSTRAINT "conversation_memories_relevance_check"
    CHECK ("relevanceScore" BETWEEN 0 AND 1);

ALTER TABLE "user_context_snapshots"
  ADD CONSTRAINT "user_context_snapshots_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "user_context_snapshots_refresh_key_check"
    CHECK (length(btrim("refreshKey")) BETWEEN 1 AND 255),
  ADD CONSTRAINT "user_context_snapshots_counts_check"
    CHECK (
      "messagesLast7Days" >= 0
      AND "messagesLast30Days" >= 0
      AND "nutritionAnalysesCount" >= 0
    ),
  ADD CONSTRAINT "user_context_snapshots_adherence_check"
    CHECK ("adherenceScore" IS NULL OR "adherenceScore" BETWEEN 0 AND 100);

INSERT INTO "nutrition_profiles" (
  "id",
  "userId",
  "sex",
  "birthDate",
  "heightCm",
  "currentWeightKg",
  "targetWeightKg",
  "activityLevel",
  "goal",
  "restrictions",
  "allergies",
  "medicalConditions",
  "createdAt",
  "updatedAt"
)
SELECT
  gen_random_uuid()::text,
  profile."userId",
  profile."gender",
  profile."birthDate",
  profile."heightCm",
  profile."currentWeightKg",
  profile."targetWeightKg",
  profile."activityLevel",
  profile."goal",
  COALESCE(
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'type', restriction."type",
          'description', restriction."description"
        )
        ORDER BY restriction."id"
      )
      FROM "food_restrictions" restriction
      WHERE restriction."profileId" = profile."id"
    ),
    '[]'::jsonb
  ),
  '[]'::jsonb,
  '[]'::jsonb,
  profile."createdAt",
  CURRENT_TIMESTAMP
FROM "fitness_profiles" profile;

INSERT INTO "user_preferences" (
  "id",
  "userId",
  "createdAt",
  "updatedAt"
)
SELECT
  gen_random_uuid()::text,
  "id",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "users";
