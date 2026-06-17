-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('ACTIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "MessageType" AS ENUM ('TEXT', 'IMAGE', 'AUDIO', 'DOCUMENT', 'SYSTEM');

-- CreateTable
CREATE TABLE "conversations" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "status" "ConversationStatus" NOT NULL DEFAULT 'ACTIVE',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastMessageAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "conversations_phoneNumber_check"
      CHECK ("phoneNumber" ~ '^\+[1-9][0-9]{7,14}$'),
    CONSTRAINT "conversations_lastMessageAt_check"
      CHECK ("lastMessageAt" IS NULL OR "lastMessageAt" >= "startedAt")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "direction" "MessageDirection" NOT NULL,
    "type" "MessageType" NOT NULL,
    "content" TEXT NOT NULL,
    "externalMessageId" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "messages_content_check"
      CHECK (char_length(btrim("content")) > 0),
    CONSTRAINT "messages_externalMessageId_check"
      CHECK ("externalMessageId" IS NULL OR char_length(btrim("externalMessageId")) > 0),
    CONSTRAINT "messages_readAt_check"
      CHECK ("readAt" IS NULL OR "deliveredAt" IS NULL OR "readAt" >= "deliveredAt")
);

-- Conversation indexes
CREATE INDEX "conversations_userId_status_idx"
ON "conversations"("userId", "status");

CREATE INDEX "conversations_phoneNumber_status_idx"
ON "conversations"("phoneNumber", "status");

CREATE INDEX "conversations_lastMessageAt_idx"
ON "conversations"("lastMessageAt");

CREATE UNIQUE INDEX "conversations_one_active_per_user_key"
ON "conversations"("userId")
WHERE "status" = 'ACTIVE';

-- Message indexes
CREATE UNIQUE INDEX "messages_externalMessageId_key"
ON "messages"("externalMessageId");

CREATE INDEX "messages_conversationId_createdAt_idx"
ON "messages"("conversationId", "createdAt");

CREATE INDEX "messages_direction_createdAt_idx"
ON "messages"("direction", "createdAt");

-- Foreign keys
ALTER TABLE "conversations"
ADD CONSTRAINT "conversations_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "messages"
ADD CONSTRAINT "messages_conversationId_fkey"
FOREIGN KEY ("conversationId") REFERENCES "conversations"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
