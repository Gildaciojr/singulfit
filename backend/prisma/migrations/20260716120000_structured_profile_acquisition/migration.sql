-- Rollback (manual, only before dependent migrations): drop both tables first,
-- then drop the six enums created below. No existing data is modified or backfilled.
-- CreateEnum
CREATE TYPE "CoachProfileAcquisitionField" AS ENUM (
  'TRAINING_MODALITY',
  'TRAINING_EXPERIENCE',
  'WEEKLY_FREQUENCY',
  'SESSION_DURATION_MINUTES',
  'TRAINING_ENVIRONMENT',
  'AVAILABLE_EQUIPMENT',
  'PERCEIVED_CONDITIONING',
  'PREFERRED_INTENSITY',
  'CARDIO_AVAILABILITY',
  'TRAINING_FORMAT_PREFERENCE',
  'RETURNING_AFTER_BREAK',
  'DESIRED_MEAL_COUNT',
  'EATING_PATTERN',
  'FOOD_INTOLERANCES',
  'DECLARED_FOOD_PREFERENCES',
  'DECLARED_FOOD_REJECTIONS',
  'FOOD_BUDGET_LEVEL',
  'COOKING_AVAILABILITY',
  'EATING_OUT_FREQUENCY',
  'REPORTED_HYDRATION',
  'REPORTED_SUPPLEMENTATION',
  'MEAL_TIMES',
  'TRAINING_TIME',
  'AVAILABLE_TRAINING_DAYS',
  'DAILY_TRAINING_WINDOWS'
);

-- CreateEnum
CREATE TYPE "CoachProfileValueType" AS ENUM ('TEXT', 'INTEGER', 'BOOLEAN', 'TEXT_LIST');

-- CreateEnum
CREATE TYPE "CoachProfileValueStatus" AS ENUM (
  'UNKNOWN',
  'ASKED',
  'ANSWERED_UNCONFIRMED',
  'CONFIRMED',
  'DECLINED',
  'DEFERRED',
  'INFERRED',
  'CONFLICTED',
  'INVALIDATED',
  'NOT_APPLICABLE'
);

-- CreateEnum
CREATE TYPE "CoachProfileValueSource" AS ENUM (
  'USER_CONFIRMED',
  'USER_REPORTED',
  'ONBOARDING',
  'PROFILE_UPDATE',
  'INFERRED_FROM_ROUTINE',
  'INFERRED_FROM_HISTORY',
  'PROFESSIONAL_DEFINED',
  'SYSTEM_DEFAULT'
);

-- CreateEnum
CREATE TYPE "CoachProfileConfirmationState" AS ENUM ('NOT_REQUIRED', 'PENDING', 'CONFIRMED');

-- CreateEnum
CREATE TYPE "CoachProfileAcquisitionCycleStatus" AS ENUM (
  'PENDING',
  'ASKED',
  'ANSWERED',
  'DECLINED',
  'DEFERRED',
  'EXPIRED',
  'CANCELLED',
  'CONFIRMATION_PENDING',
  'COMPLETED'
);

-- CreateTable
CREATE TABLE "coach_profile_field_values" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "field" "CoachProfileAcquisitionField" NOT NULL,
  "valueType" "CoachProfileValueType" NOT NULL,
  "textValue" TEXT,
  "integerValue" INTEGER,
  "booleanValue" BOOLEAN,
  "textListValue" JSONB,
  "valueFingerprint" TEXT,
  "status" "CoachProfileValueStatus" NOT NULL,
  "source" "CoachProfileValueSource" NOT NULL,
  "confirmationState" "CoachProfileConfirmationState" NOT NULL,
  "definitionVersion" INTEGER NOT NULL,
  "referenceDate" TIMESTAMP(3) NOT NULL,
  "operationKey" TEXT NOT NULL,
  "previousValueId" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "confirmedAt" TIMESTAMP(3),
  "invalidatedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "coach_profile_field_values_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "coach_profile_field_values_definition_version_check"
    CHECK ("definitionVersion" > 0),
  CONSTRAINT "coach_profile_field_values_typed_value_check"
    CHECK (
      (
        "status" IN ('UNKNOWN', 'ASKED', 'DECLINED', 'DEFERRED', 'INVALIDATED', 'NOT_APPLICABLE')
        AND "textValue" IS NULL
        AND "integerValue" IS NULL
        AND "booleanValue" IS NULL
        AND "textListValue" IS NULL
      )
      OR
      (
        "status" IN ('ANSWERED_UNCONFIRMED', 'CONFIRMED', 'INFERRED', 'CONFLICTED')
        AND (
          ("valueType" = 'TEXT' AND "textValue" IS NOT NULL AND "integerValue" IS NULL AND "booleanValue" IS NULL AND "textListValue" IS NULL)
          OR
          ("valueType" = 'INTEGER' AND "textValue" IS NULL AND "integerValue" IS NOT NULL AND "booleanValue" IS NULL AND "textListValue" IS NULL)
          OR
          ("valueType" = 'BOOLEAN' AND "textValue" IS NULL AND "integerValue" IS NULL AND "booleanValue" IS NOT NULL AND "textListValue" IS NULL)
          OR
          ("valueType" = 'TEXT_LIST' AND "textValue" IS NULL AND "integerValue" IS NULL AND "booleanValue" IS NULL AND jsonb_typeof("textListValue") = 'array')
        )
      )
    )
);

-- CreateTable
CREATE TABLE "coach_profile_acquisition_cycles" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "field" "CoachProfileAcquisitionField" NOT NULL,
  "status" "CoachProfileAcquisitionCycleStatus" NOT NULL,
  "questionKind" TEXT NOT NULL,
  "questionVersion" INTEGER NOT NULL,
  "logicalTurn" INTEGER NOT NULL,
  "origin" TEXT NOT NULL,
  "operationKey" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "resultCode" TEXT,
  "confirmationState" "CoachProfileConfirmationState" NOT NULL,
  "referenceDate" TIMESTAMP(3) NOT NULL,
  "askedAt" TIMESTAMP(3),
  "answeredAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "cooldownUntil" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "sourceMessageId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "coach_profile_acquisition_cycles_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "coach_profile_acquisition_cycles_logical_turn_check" CHECK ("logicalTurn" >= 0),
  CONSTRAINT "coach_profile_acquisition_cycles_question_version_check" CHECK ("questionVersion" > 0),
  CONSTRAINT "coach_profile_acquisition_cycles_expiration_check" CHECK ("expiresAt" >= "referenceDate")
);

-- CreateIndex
CREATE UNIQUE INDEX "coach_profile_field_values_operationKey_key"
  ON "coach_profile_field_values"("operationKey");
CREATE INDEX "coach_profile_field_values_userId_field_isActive_idx"
  ON "coach_profile_field_values"("userId", "field", "isActive");
CREATE INDEX "coach_profile_field_values_userId_status_referenceDate_idx"
  ON "coach_profile_field_values"("userId", "status", "referenceDate");
CREATE INDEX "coach_profile_field_values_previousValueId_idx"
  ON "coach_profile_field_values"("previousValueId");
CREATE UNIQUE INDEX "coach_profile_field_values_one_active_per_field"
  ON "coach_profile_field_values"("userId", "field")
  WHERE "isActive" = true;

CREATE UNIQUE INDEX "coach_profile_acquisition_cycles_operationKey_key"
  ON "coach_profile_acquisition_cycles"("operationKey");
CREATE INDEX "coach_profile_acquisition_cycles_userId_active_expiresAt_idx"
  ON "coach_profile_acquisition_cycles"("userId", "active", "expiresAt");
CREATE INDEX "coach_profile_acquisition_cycles_userId_field_referenceDate_idx"
  ON "coach_profile_acquisition_cycles"("userId", "field", "referenceDate");
CREATE INDEX "coach_profile_acquisition_cycles_status_expiresAt_idx"
  ON "coach_profile_acquisition_cycles"("status", "expiresAt");
CREATE UNIQUE INDEX "coach_profile_acquisition_cycles_one_active_per_user"
  ON "coach_profile_acquisition_cycles"("userId")
  WHERE "active" = true;

-- AddForeignKey
ALTER TABLE "coach_profile_field_values"
  ADD CONSTRAINT "coach_profile_field_values_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "coach_profile_field_values"
  ADD CONSTRAINT "coach_profile_field_values_previousValueId_fkey"
  FOREIGN KEY ("previousValueId") REFERENCES "coach_profile_field_values"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "coach_profile_acquisition_cycles"
  ADD CONSTRAINT "coach_profile_acquisition_cycles_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
