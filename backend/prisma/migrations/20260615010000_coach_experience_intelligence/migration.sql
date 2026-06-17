-- CreateEnum
CREATE TYPE "CoachCommunicationProfileType" AS ENUM (
  'DIRECT',
  'TECHNICAL',
  'MOTIVATIONAL',
  'DISCIPLINARIAN',
  'WARM',
  'BALANCED'
);

-- CreateEnum
CREATE TYPE "CoachMotivationalTrigger" AS ENUM (
  'VISUAL_RESULT',
  'HEALTH',
  'SELF_ESTEEM',
  'PERFORMANCE',
  'DISCIPLINE',
  'LONGEVITY',
  'ROUTINE'
);

-- CreateEnum
CREATE TYPE "CoachReengagementReason" AS ENUM (
  'FORGOTTEN',
  'MOTIVATION_LOSS',
  'LACK_OF_RESULTS',
  'TEMPORARY_ABANDONMENT'
);

-- CreateTable
CREATE TABLE "coach_communication_profile_snapshots" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "snapshotDate" DATE NOT NULL,
  "dominantStyle" "CoachCommunicationProfileType" NOT NULL,
  "previousStyle" "CoachCommunicationProfileType",
  "directScore" INTEGER NOT NULL,
  "technicalScore" INTEGER NOT NULL,
  "motivationalScore" INTEGER NOT NULL,
  "disciplinarianScore" INTEGER NOT NULL,
  "warmScore" INTEGER NOT NULL,
  "balancedScore" INTEGER NOT NULL,
  "confidence" DECIMAL(5,4) NOT NULL,
  "evidence" JSONB NOT NULL,
  "generatedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "coach_communication_profile_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coach_motivation_profile_snapshots" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "snapshotDate" DATE NOT NULL,
  "dominantTrigger" "CoachMotivationalTrigger" NOT NULL,
  "visualResultScore" INTEGER NOT NULL,
  "healthScore" INTEGER NOT NULL,
  "selfEsteemScore" INTEGER NOT NULL,
  "performanceScore" INTEGER NOT NULL,
  "disciplineScore" INTEGER NOT NULL,
  "longevityScore" INTEGER NOT NULL,
  "routineScore" INTEGER NOT NULL,
  "confidence" DECIMAL(5,4) NOT NULL,
  "evidence" JSONB NOT NULL,
  "generatedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "coach_motivation_profile_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_fatigue_snapshots" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "snapshotDate" DATE NOT NULL,
  "fatigueScore" INTEGER NOT NULL,
  "outboundMessages14Days" INTEGER NOT NULL,
  "inboundMessages14Days" INTEGER NOT NULL,
  "repeatedThemeScore" INTEGER NOT NULL,
  "repeatedPhraseScore" INTEGER NOT NULL,
  "interactionResponseScore" INTEGER NOT NULL,
  "recommendedFrequencyHours" INTEGER NOT NULL,
  "evidence" JSONB NOT NULL,
  "calculatedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "message_fatigue_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coach_reengagement_classifications" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "sourceKey" TEXT NOT NULL,
  "reason" "CoachReengagementReason" NOT NULL,
  "confidence" DECIMAL(5,4) NOT NULL,
  "messageVariant" INTEGER NOT NULL,
  "evidence" JSONB NOT NULL,
  "generatedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "coach_reengagement_classifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goal_momentum_snapshots" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "snapshotDate" DATE NOT NULL,
  "score" INTEGER NOT NULL,
  "consistencyScore" INTEGER NOT NULL,
  "evolutionScore" INTEGER NOT NULL,
  "relapseScore" INTEGER NOT NULL,
  "engagementScore" INTEGER NOT NULL,
  "adherenceScore" INTEGER NOT NULL,
  "evidence" JSONB NOT NULL,
  "calculatedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "goal_momentum_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_experience_snapshots" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "snapshotDate" DATE NOT NULL,
  "idealMessageLength" INTEGER NOT NULL,
  "idealEmojiCount" INTEGER NOT NULL,
  "idealFrequencyHours" INTEGER NOT NULL,
  "preferredHourUtc" INTEGER,
  "averageInboundLength" INTEGER NOT NULL,
  "averageOutboundLength" INTEGER NOT NULL,
  "interactionRate" INTEGER NOT NULL,
  "evidence" JSONB NOT NULL,
  "calculatedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "whatsapp_experience_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "retention_strength_snapshots" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "snapshotDate" DATE NOT NULL,
  "score" INTEGER NOT NULL,
  "usageScore" INTEGER NOT NULL,
  "engagementScore" INTEGER NOT NULL,
  "contextScore" INTEGER NOT NULL,
  "evolutionScore" INTEGER NOT NULL,
  "coachScore" INTEGER NOT NULL,
  "recommendationAcceptanceScore" INTEGER NOT NULL,
  "evidence" JSONB NOT NULL,
  "calculatedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "retention_strength_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "coach_communication_profile_snapshots_userId_snapshotDate_key" ON "coach_communication_profile_snapshots"("userId", "snapshotDate");
CREATE INDEX "coach_communication_profile_snapshots_dominantStyle_generatedAt_idx" ON "coach_communication_profile_snapshots"("dominantStyle", "generatedAt");
CREATE INDEX "coach_communication_profile_snapshots_userId_generatedAt_idx" ON "coach_communication_profile_snapshots"("userId", "generatedAt");
CREATE UNIQUE INDEX "coach_motivation_profile_snapshots_userId_snapshotDate_key" ON "coach_motivation_profile_snapshots"("userId", "snapshotDate");
CREATE INDEX "coach_motivation_profile_snapshots_dominantTrigger_generatedAt_idx" ON "coach_motivation_profile_snapshots"("dominantTrigger", "generatedAt");
CREATE INDEX "coach_motivation_profile_snapshots_userId_generatedAt_idx" ON "coach_motivation_profile_snapshots"("userId", "generatedAt");
CREATE UNIQUE INDEX "message_fatigue_snapshots_userId_snapshotDate_key" ON "message_fatigue_snapshots"("userId", "snapshotDate");
CREATE INDEX "message_fatigue_snapshots_fatigueScore_calculatedAt_idx" ON "message_fatigue_snapshots"("fatigueScore", "calculatedAt");
CREATE INDEX "message_fatigue_snapshots_userId_calculatedAt_idx" ON "message_fatigue_snapshots"("userId", "calculatedAt");
CREATE UNIQUE INDEX "coach_reengagement_classifications_sourceKey_key" ON "coach_reengagement_classifications"("sourceKey");
CREATE INDEX "coach_reengagement_classifications_reason_generatedAt_idx" ON "coach_reengagement_classifications"("reason", "generatedAt");
CREATE INDEX "coach_reengagement_classifications_userId_generatedAt_idx" ON "coach_reengagement_classifications"("userId", "generatedAt");
CREATE UNIQUE INDEX "goal_momentum_snapshots_userId_snapshotDate_key" ON "goal_momentum_snapshots"("userId", "snapshotDate");
CREATE INDEX "goal_momentum_snapshots_score_calculatedAt_idx" ON "goal_momentum_snapshots"("score", "calculatedAt");
CREATE INDEX "goal_momentum_snapshots_userId_calculatedAt_idx" ON "goal_momentum_snapshots"("userId", "calculatedAt");
CREATE UNIQUE INDEX "whatsapp_experience_snapshots_userId_snapshotDate_key" ON "whatsapp_experience_snapshots"("userId", "snapshotDate");
CREATE INDEX "whatsapp_experience_snapshots_userId_calculatedAt_idx" ON "whatsapp_experience_snapshots"("userId", "calculatedAt");
CREATE INDEX "whatsapp_experience_snapshots_idealFrequencyHours_calculatedAt_idx" ON "whatsapp_experience_snapshots"("idealFrequencyHours", "calculatedAt");
CREATE UNIQUE INDEX "retention_strength_snapshots_userId_snapshotDate_key" ON "retention_strength_snapshots"("userId", "snapshotDate");
CREATE INDEX "retention_strength_snapshots_score_calculatedAt_idx" ON "retention_strength_snapshots"("score", "calculatedAt");
CREATE INDEX "retention_strength_snapshots_userId_calculatedAt_idx" ON "retention_strength_snapshots"("userId", "calculatedAt");

-- AddForeignKey
ALTER TABLE "coach_communication_profile_snapshots" ADD CONSTRAINT "coach_communication_profile_snapshots_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "coach_motivation_profile_snapshots" ADD CONSTRAINT "coach_motivation_profile_snapshots_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "message_fatigue_snapshots" ADD CONSTRAINT "message_fatigue_snapshots_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "coach_reengagement_classifications" ADD CONSTRAINT "coach_reengagement_classifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "goal_momentum_snapshots" ADD CONSTRAINT "goal_momentum_snapshots_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "whatsapp_experience_snapshots" ADD CONSTRAINT "whatsapp_experience_snapshots_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "retention_strength_snapshots" ADD CONSTRAINT "retention_strength_snapshots_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
