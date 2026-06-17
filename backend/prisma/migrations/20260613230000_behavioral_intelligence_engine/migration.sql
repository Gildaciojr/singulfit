CREATE TYPE "BehavioralCommunicationStyle" AS ENUM (
    'DIRECT',
    'FRIENDLY',
    'ANALYTICAL',
    'COACH',
    'MOTIVATIONAL'
);

CREATE TYPE "BehavioralMotivationStyle" AS ENUM (
    'HEALTH',
    'AESTHETICS',
    'PERFORMANCE',
    'LONGEVITY',
    'SELF_ESTEEM'
);

CREATE TYPE "BehavioralAdherenceStyle" AS ENUM (
    'STRUCTURED',
    'FLEXIBLE',
    'ACCOUNTABILITY',
    'SELF_DIRECTED'
);

CREATE TYPE "BehavioralPersonalityPattern" AS ENUM (
    'DATA_ORIENTED',
    'ROUTINE_ORIENTED',
    'CHALLENGE_ORIENTED',
    'SUPPORT_ORIENTED',
    'BALANCED'
);

CREATE TYPE "StageOfChange" AS ENUM (
    'PRE_CONTEMPLATION',
    'CONTEMPLATION',
    'PREPARATION',
    'ACTION',
    'MAINTENANCE'
);

CREATE TYPE "MotivationTriggerType" AS ENUM (
    'PROGRESS',
    'CHALLENGE',
    'REWARD',
    'HEALTH',
    'FAMILY',
    'SELF_ESTEEM',
    'PERFORMANCE'
);

CREATE TYPE "BehavioralInsightType" AS ENUM (
    'SHORT_MESSAGES',
    'MORNING_ENGAGEMENT',
    'AFTERNOON_ENGAGEMENT',
    'EVENING_ENGAGEMENT',
    'WEEKEND_DROP',
    'DATA_RESPONSIVE',
    'CONSISTENCY_RESPONSIVE'
);

CREATE TYPE "BehavioralInsightStatus" AS ENUM ('ACTIVE', 'RESOLVED');

CREATE TABLE "behavioral_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "communicationStyle" "BehavioralCommunicationStyle" NOT NULL,
    "motivationStyle" "BehavioralMotivationStyle" NOT NULL,
    "adherenceStyle" "BehavioralAdherenceStyle" NOT NULL,
    "personalityPattern" "BehavioralPersonalityPattern" NOT NULL,
    "confidenceScore" DECIMAL(5,4) NOT NULL,
    "preferredEngagementHour" INTEGER,
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "behavioral_profiles_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "behavioral_profiles_confidence_check" CHECK (
        "confidenceScore" BETWEEN 0 AND 1
    ),
    CONSTRAINT "behavioral_profiles_hour_check" CHECK (
        "preferredEngagementHour" IS NULL
        OR "preferredEngagementHour" BETWEEN 0 AND 23
    )
);

CREATE TABLE "behavioral_motivations" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "BehavioralMotivationStyle" NOT NULL,
    "weight" DECIMAL(5,2) NOT NULL,
    "evidence" JSONB NOT NULL DEFAULT '[]',
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "behavioral_motivations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "behavioral_motivations_weight_check" CHECK (
        "weight" BETWEEN 0 AND 100
    )
);

CREATE TABLE "stage_of_change_history" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "snapshotDate" DATE NOT NULL,
    "stage" "StageOfChange" NOT NULL,
    "previousStage" "StageOfChange",
    "confidence" DECIMAL(5,4) NOT NULL,
    "evidence" JSONB NOT NULL,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stage_of_change_history_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "stage_of_change_history_confidence_check" CHECK (
        "confidence" BETWEEN 0 AND 1
    )
);

CREATE TABLE "adherence_predictions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "snapshotDate" DATE NOT NULL,
    "score" INTEGER NOT NULL,
    "frequencyScore" INTEGER NOT NULL,
    "consistencyScore" INTEGER NOT NULL,
    "habitScore" INTEGER NOT NULL,
    "contextScore" INTEGER NOT NULL,
    "responseScore" INTEGER NOT NULL,
    "evidence" JSONB NOT NULL,
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "adherence_predictions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "adherence_predictions_scores_check" CHECK (
        "score" BETWEEN 0 AND 100
        AND "frequencyScore" BETWEEN 0 AND 100
        AND "consistencyScore" BETWEEN 0 AND 100
        AND "habitScore" BETWEEN 0 AND 100
        AND "contextScore" BETWEEN 0 AND 100
        AND "responseScore" BETWEEN 0 AND 100
    )
);

CREATE TABLE "motivation_triggers" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "MotivationTriggerType" NOT NULL,
    "weight" DECIMAL(5,2) NOT NULL,
    "evidence" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "motivation_triggers_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "motivation_triggers_weight_check" CHECK (
        "weight" BETWEEN 0 AND 100
    )
);

CREATE TABLE "behavioral_insights" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "BehavioralInsightType" NOT NULL,
    "status" "BehavioralInsightStatus" NOT NULL DEFAULT 'ACTIVE',
    "summary" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "occurrences" INTEGER NOT NULL DEFAULT 1,
    "firstDetectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastDetectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "behavioral_insights_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "behavioral_insights_occurrences_check" CHECK (
        "occurrences" >= 1
    )
);

CREATE TABLE "behavioral_snapshots" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "snapshotDate" DATE NOT NULL,
    "adherenceScore" INTEGER NOT NULL,
    "stage" "StageOfChange" NOT NULL,
    "dominantMotivation" "BehavioralMotivationStyle" NOT NULL,
    "engagementScore" INTEGER NOT NULL,
    "communicationStyle" "BehavioralCommunicationStyle" NOT NULL,
    "preferredEngagementHour" INTEGER,
    "confidenceScore" DECIMAL(5,4) NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "behavioral_snapshots_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "behavioral_snapshots_scores_check" CHECK (
        "adherenceScore" BETWEEN 0 AND 100
        AND "engagementScore" BETWEEN 0 AND 100
        AND "confidenceScore" BETWEEN 0 AND 1
    ),
    CONSTRAINT "behavioral_snapshots_hour_check" CHECK (
        "preferredEngagementHour" IS NULL
        OR "preferredEngagementHour" BETWEEN 0 AND 23
    )
);

CREATE UNIQUE INDEX "behavioral_profiles_userId_key"
ON "behavioral_profiles"("userId");
CREATE INDEX "behavioral_profiles_communicationStyle_updatedAt_idx"
ON "behavioral_profiles"("communicationStyle", "updatedAt");
CREATE INDEX "behavioral_profiles_motivationStyle_updatedAt_idx"
ON "behavioral_profiles"("motivationStyle", "updatedAt");

CREATE UNIQUE INDEX "behavioral_motivations_userId_type_key"
ON "behavioral_motivations"("userId", "type");
CREATE INDEX "behavioral_motivations_userId_weight_idx"
ON "behavioral_motivations"("userId", "weight");

CREATE UNIQUE INDEX "stage_of_change_history_userId_snapshotDate_key"
ON "stage_of_change_history"("userId", "snapshotDate");
CREATE INDEX "stage_of_change_history_stage_detectedAt_idx"
ON "stage_of_change_history"("stage", "detectedAt");
CREATE INDEX "stage_of_change_history_userId_detectedAt_idx"
ON "stage_of_change_history"("userId", "detectedAt");

CREATE UNIQUE INDEX "adherence_predictions_userId_snapshotDate_key"
ON "adherence_predictions"("userId", "snapshotDate");
CREATE INDEX "adherence_predictions_score_calculatedAt_idx"
ON "adherence_predictions"("score", "calculatedAt");
CREATE INDEX "adherence_predictions_userId_calculatedAt_idx"
ON "adherence_predictions"("userId", "calculatedAt");

CREATE UNIQUE INDEX "motivation_triggers_userId_type_key"
ON "motivation_triggers"("userId", "type");
CREATE INDEX "motivation_triggers_userId_active_weight_idx"
ON "motivation_triggers"("userId", "active", "weight");

CREATE UNIQUE INDEX "behavioral_insights_userId_type_key"
ON "behavioral_insights"("userId", "type");
CREATE INDEX "behavioral_insights_userId_status_lastDetectedAt_idx"
ON "behavioral_insights"("userId", "status", "lastDetectedAt");
CREATE INDEX "behavioral_insights_status_lastDetectedAt_idx"
ON "behavioral_insights"("status", "lastDetectedAt");

CREATE UNIQUE INDEX "behavioral_snapshots_userId_snapshotDate_key"
ON "behavioral_snapshots"("userId", "snapshotDate");
CREATE INDEX "behavioral_snapshots_snapshotDate_stage_idx"
ON "behavioral_snapshots"("snapshotDate", "stage");
CREATE INDEX "behavioral_snapshots_userId_generatedAt_idx"
ON "behavioral_snapshots"("userId", "generatedAt");

ALTER TABLE "behavioral_profiles"
ADD CONSTRAINT "behavioral_profiles_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "behavioral_motivations"
ADD CONSTRAINT "behavioral_motivations_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "stage_of_change_history"
ADD CONSTRAINT "stage_of_change_history_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "adherence_predictions"
ADD CONSTRAINT "adherence_predictions_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "motivation_triggers"
ADD CONSTRAINT "motivation_triggers_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "behavioral_insights"
ADD CONSTRAINT "behavioral_insights_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "behavioral_snapshots"
ADD CONSTRAINT "behavioral_snapshots_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
