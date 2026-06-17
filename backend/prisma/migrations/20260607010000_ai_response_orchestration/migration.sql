CREATE TYPE "OutboundMessageStatus" AS ENUM (
  'PENDING',
  'SENT',
  'DELIVERED',
  'FAILED'
);

CREATE TYPE "ResponseType" AS ENUM ('NUTRITION_ANALYSIS');

CREATE TABLE "outbound_messages" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "sourceMessageId" TEXT NOT NULL,
  "mealAnalysisId" TEXT NOT NULL,
  "responseType" "ResponseType" NOT NULL,
  "content" TEXT NOT NULL,
  "externalMessageId" TEXT,
  "status" "OutboundMessageStatus" NOT NULL DEFAULT 'PENDING',
  "sentAt" TIMESTAMP(3),
  "deliveredAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "outbound_messages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "outbound_messages_mealAnalysisId_key"
ON "outbound_messages"("mealAnalysisId");

CREATE UNIQUE INDEX "outbound_messages_externalMessageId_key"
ON "outbound_messages"("externalMessageId");

CREATE UNIQUE INDEX "outbound_messages_sourceMessageId_responseType_key"
ON "outbound_messages"("sourceMessageId", "responseType");

CREATE INDEX "outbound_messages_userId_createdAt_idx"
ON "outbound_messages"("userId", "createdAt");

CREATE INDEX "outbound_messages_conversationId_createdAt_idx"
ON "outbound_messages"("conversationId", "createdAt");

CREATE INDEX "outbound_messages_status_createdAt_idx"
ON "outbound_messages"("status", "createdAt");

ALTER TABLE "outbound_messages"
ADD CONSTRAINT "outbound_messages_userId_fkey"
FOREIGN KEY ("userId")
REFERENCES "users"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

ALTER TABLE "outbound_messages"
ADD CONSTRAINT "outbound_messages_conversationId_fkey"
FOREIGN KEY ("conversationId")
REFERENCES "conversations"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

ALTER TABLE "outbound_messages"
ADD CONSTRAINT "outbound_messages_sourceMessageId_fkey"
FOREIGN KEY ("sourceMessageId")
REFERENCES "messages"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

ALTER TABLE "outbound_messages"
ADD CONSTRAINT "outbound_messages_mealAnalysisId_fkey"
FOREIGN KEY ("mealAnalysisId")
REFERENCES "meal_analyses"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

ALTER TABLE "outbound_messages"
  ADD CONSTRAINT "outbound_messages_content_not_blank_check"
    CHECK (btrim("content") <> ''),
  ADD CONSTRAINT "outbound_messages_error_not_blank_check"
    CHECK ("errorMessage" IS NULL OR btrim("errorMessage") <> ''),
  ADD CONSTRAINT "outbound_messages_lifecycle_check"
    CHECK (
      (
        "status" = 'PENDING'
        AND "externalMessageId" IS NULL
        AND "sentAt" IS NULL
        AND "deliveredAt" IS NULL
        AND "failedAt" IS NULL
        AND "errorMessage" IS NULL
      )
      OR (
        "status" = 'SENT'
        AND "externalMessageId" IS NOT NULL
        AND "sentAt" IS NOT NULL
        AND "deliveredAt" IS NULL
        AND "failedAt" IS NULL
        AND "errorMessage" IS NULL
      )
      OR (
        "status" = 'DELIVERED'
        AND "externalMessageId" IS NOT NULL
        AND "sentAt" IS NOT NULL
        AND "deliveredAt" IS NOT NULL
        AND "failedAt" IS NULL
        AND "errorMessage" IS NULL
      )
      OR (
        "status" = 'FAILED'
        AND "deliveredAt" IS NULL
        AND "failedAt" IS NOT NULL
        AND "errorMessage" IS NOT NULL
      )
    );
