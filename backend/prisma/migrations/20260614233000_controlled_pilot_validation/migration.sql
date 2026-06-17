-- CreateEnum
CREATE TYPE "PilotCohortStatus" AS ENUM ('PLANNED', 'ACTIVE', 'COMPLETED', 'CANCELED');

-- CreateEnum
CREATE TYPE "PilotParticipantStatus" AS ENUM ('INVITED', 'ACTIVE', 'ACTIVATED', 'COMPLETED', 'DROPPED');

-- CreateEnum
CREATE TYPE "PilotManualCheckType" AS ENUM (
  'DNS',
  'TLS',
  'FIREWALL',
  'BACKUP',
  'RESTORE',
  'PAGBANK_REAL',
  'EVOLUTION_REAL',
  'OPENAI_REAL',
  'FIRST_PAYMENT',
  'FIRST_WEBHOOK',
  'FIRST_WHATSAPP',
  'FIRST_ANALYSIS'
);

-- CreateEnum
CREATE TYPE "PilotManualCheckStatus" AS ENUM ('PENDING', 'PASSED', 'FAILED', 'WAIVED');

-- CreateEnum
CREATE TYPE "PilotGoStatus" AS ENUM ('GO', 'WARNING', 'NO_GO');

-- CreateTable
CREATE TABLE "pilot_cohorts" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "status" "PilotCohortStatus" NOT NULL DEFAULT 'PLANNED',
  "lastGoStatus" "PilotGoStatus",
  "goEvaluatedAt" TIMESTAMP(3),
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "pilot_cohorts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pilot_participants" (
  "id" TEXT NOT NULL,
  "cohortId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "status" "PilotParticipantStatus" NOT NULL DEFAULT 'INVITED',
  "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "activatedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "droppedAt" TIMESTAMP(3),
  "notes" TEXT,

  CONSTRAINT "pilot_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pilot_manual_checks" (
  "id" TEXT NOT NULL,
  "cohortId" TEXT NOT NULL,
  "checkType" "PilotManualCheckType" NOT NULL,
  "status" "PilotManualCheckStatus" NOT NULL DEFAULT 'PENDING',
  "notes" TEXT,
  "checkedAt" TIMESTAMP(3) NOT NULL,
  "checkedByUserId" TEXT NOT NULL,

  CONSTRAINT "pilot_manual_checks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pilot_cohorts_status_startsAt_idx" ON "pilot_cohorts"("status", "startsAt");
CREATE INDEX "pilot_cohorts_endsAt_idx" ON "pilot_cohorts"("endsAt");
CREATE UNIQUE INDEX "pilot_participants_cohortId_userId_key" ON "pilot_participants"("cohortId", "userId");
CREATE INDEX "pilot_participants_cohortId_status_joinedAt_idx" ON "pilot_participants"("cohortId", "status", "joinedAt");
CREATE INDEX "pilot_participants_userId_joinedAt_idx" ON "pilot_participants"("userId", "joinedAt");
CREATE UNIQUE INDEX "pilot_manual_checks_cohortId_checkType_key" ON "pilot_manual_checks"("cohortId", "checkType");
CREATE INDEX "pilot_manual_checks_cohortId_status_checkedAt_idx" ON "pilot_manual_checks"("cohortId", "status", "checkedAt");
CREATE INDEX "pilot_manual_checks_checkedByUserId_checkedAt_idx" ON "pilot_manual_checks"("checkedByUserId", "checkedAt");

-- AddForeignKey
ALTER TABLE "pilot_participants" ADD CONSTRAINT "pilot_participants_cohortId_fkey" FOREIGN KEY ("cohortId") REFERENCES "pilot_cohorts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pilot_participants" ADD CONSTRAINT "pilot_participants_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pilot_manual_checks" ADD CONSTRAINT "pilot_manual_checks_cohortId_fkey" FOREIGN KEY ("cohortId") REFERENCES "pilot_cohorts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pilot_manual_checks" ADD CONSTRAINT "pilot_manual_checks_checkedByUserId_fkey" FOREIGN KEY ("checkedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
