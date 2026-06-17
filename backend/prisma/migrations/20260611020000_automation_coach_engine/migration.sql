CREATE TYPE "ScheduledMessageStatus" AS ENUM (
  'PENDING',
  'SENT',
  'FAILED',
  'CANCELED'
);

CREATE TABLE "automation_rules" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "automation_rules_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "user_automation_preferences" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "remindersEnabled" BOOLEAN NOT NULL DEFAULT true,
  "workoutReminderEnabled" BOOLEAN NOT NULL DEFAULT true,
  "mealReminderEnabled" BOOLEAN NOT NULL DEFAULT true,
  "hydrationReminderEnabled" BOOLEAN NOT NULL DEFAULT true,
  "progressReminderEnabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "user_automation_preferences_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "scheduled_messages" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "automationRuleId" TEXT NOT NULL,
  "scheduledFor" TIMESTAMP(3) NOT NULL,
  "status" "ScheduledMessageStatus" NOT NULL DEFAULT 'PENDING',
  "content" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "scheduled_messages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "automation_rules_code_key"
ON "automation_rules"("code");

CREATE INDEX "automation_rules_enabled_idx"
ON "automation_rules"("enabled");

CREATE UNIQUE INDEX "user_automation_preferences_userId_key"
ON "user_automation_preferences"("userId");

CREATE UNIQUE INDEX "scheduled_messages_userId_automationRuleId_scheduledFor_key"
ON "scheduled_messages"("userId", "automationRuleId", "scheduledFor");

CREATE INDEX "scheduled_messages_status_scheduledFor_idx"
ON "scheduled_messages"("status", "scheduledFor");

CREATE INDEX "scheduled_messages_userId_scheduledFor_idx"
ON "scheduled_messages"("userId", "scheduledFor");

ALTER TABLE "user_automation_preferences"
ADD CONSTRAINT "user_automation_preferences_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "scheduled_messages"
ADD CONSTRAINT "scheduled_messages_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "scheduled_messages"
ADD CONSTRAINT "scheduled_messages_automationRuleId_fkey"
FOREIGN KEY ("automationRuleId") REFERENCES "automation_rules"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "automation_rules"
  ADD CONSTRAINT "automation_rules_code_check"
    CHECK (
      "code" ~ '^[A-Z][A-Z0-9_]{2,99}$'
    ),
  ADD CONSTRAINT "automation_rules_name_check"
    CHECK (length(btrim("name")) BETWEEN 1 AND 100);

ALTER TABLE "scheduled_messages"
  ADD CONSTRAINT "scheduled_messages_content_check"
    CHECK (length(btrim("content")) BETWEEN 1 AND 10000);

INSERT INTO "automation_rules" (
  "id",
  "code",
  "name",
  "enabled",
  "createdAt"
)
VALUES
  (
    'a2515dc7-50eb-4f03-a1a6-c064e6d92301',
    'GOOD_MORNING',
    'Bom dia',
    true,
    CURRENT_TIMESTAMP
  ),
  (
    'a2515dc7-50eb-4f03-a1a6-c064e6d92302',
    'DAILY_WORKOUT',
    'Treino do dia',
    true,
    CURRENT_TIMESTAMP
  ),
  (
    'a2515dc7-50eb-4f03-a1a6-c064e6d92303',
    'MEAL_REMINDER',
    'Lembrete de refeição',
    true,
    CURRENT_TIMESTAMP
  ),
  (
    'a2515dc7-50eb-4f03-a1a6-c064e6d92304',
    'HYDRATION_REMINDER',
    'Lembrete de água',
    true,
    CURRENT_TIMESTAMP
  ),
  (
    'a2515dc7-50eb-4f03-a1a6-c064e6d92305',
    'DAILY_CHECK_IN',
    'Check-in diário',
    true,
    CURRENT_TIMESTAMP
  ),
  (
    'a2515dc7-50eb-4f03-a1a6-c064e6d92306',
    'WEEKLY_SUMMARY',
    'Resumo semanal',
    true,
    CURRENT_TIMESTAMP
  )
ON CONFLICT ("code")
DO UPDATE SET
  "name" = EXCLUDED."name",
  "enabled" = true;
