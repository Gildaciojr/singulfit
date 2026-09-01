ALTER TABLE "scheduled_messages"
ADD COLUMN "sentAt" TIMESTAMP(3);

CREATE INDEX "scheduled_messages_userId_sentAt_idx"
ON "scheduled_messages"("userId", "sentAt");
