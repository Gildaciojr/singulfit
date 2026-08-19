CREATE TYPE "CoachProactiveWorkoutOutcome" AS ENUM (
  'COMPLETED',
  'PARTIAL',
  'SKIPPED',
  'DEFERRED',
  'ISSUE_REPORTED',
  'UNKNOWN'
);

ALTER TABLE "messages"
ADD COLUMN "replyToExternalMessageId" TEXT;

ALTER TABLE "scheduled_messages"
ADD COLUMN "conversationId" TEXT,
ADD COLUMN "coachMessageId" TEXT,
ADD COLUMN "externalMessageId" TEXT,
ADD COLUMN "responseMessageId" TEXT,
ADD COLUMN "responseExpiresAt" TIMESTAMP(3),
ADD COLUMN "responseOutcome" "CoachProactiveWorkoutOutcome",
ADD COLUMN "respondedAt" TIMESTAMP(3),
ADD COLUMN "context" JSONB NOT NULL DEFAULT '{}';

CREATE UNIQUE INDEX "scheduled_messages_coachMessageId_key"
ON "scheduled_messages"("coachMessageId");

CREATE UNIQUE INDEX "scheduled_messages_externalMessageId_key"
ON "scheduled_messages"("externalMessageId");

CREATE UNIQUE INDEX "scheduled_messages_responseMessageId_key"
ON "scheduled_messages"("responseMessageId");

CREATE INDEX "scheduled_messages_conversationId_responseExpiresAt_idx"
ON "scheduled_messages"("conversationId", "responseExpiresAt");

CREATE INDEX "scheduled_messages_userId_responseOutcome_respondedAt_idx"
ON "scheduled_messages"("userId", "responseOutcome", "respondedAt");

ALTER TABLE "scheduled_messages"
ADD CONSTRAINT "scheduled_messages_conversationId_fkey"
FOREIGN KEY ("conversationId") REFERENCES "conversations"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "scheduled_messages"
ADD CONSTRAINT "scheduled_messages_coachMessageId_fkey"
FOREIGN KEY ("coachMessageId") REFERENCES "coach_messages"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "scheduled_messages"
ADD CONSTRAINT "scheduled_messages_responseMessageId_fkey"
FOREIGN KEY ("responseMessageId") REFERENCES "messages"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
