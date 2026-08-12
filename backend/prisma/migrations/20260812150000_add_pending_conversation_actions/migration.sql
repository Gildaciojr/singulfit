-- CreateEnum
CREATE TYPE "PendingConversationActionType" AS ENUM ('GOAL_CONFIRMATION');

-- CreateEnum
CREATE TYPE "PendingConversationActionStatus" AS ENUM ('AWAITING_PROMPT', 'PENDING', 'CONSUMED_PENDING_EXECUTION', 'EXECUTING', 'COMPLETED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PendingConversationOriginalIntent" AS ENUM ('DIET', 'WORKOUT', 'BOTH', 'UNKNOWN');

-- CreateTable
CREATE TABLE "pending_conversation_actions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "type" "PendingConversationActionType" NOT NULL,
    "status" "PendingConversationActionStatus" NOT NULL DEFAULT 'AWAITING_PROMPT',
    "sourceMessageId" TEXT NOT NULL,
    "consumerMessageId" TEXT,
    "originalIntent" "PendingConversationOriginalIntent" NOT NULL,
    "payload" JSONB NOT NULL,
    "operationKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "promptActivatedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "resultContent" TEXT,
    "executionLeaseExpiresAt" TIMESTAMP(3),
    "executionClaimToken" TEXT,

    CONSTRAINT "pending_conversation_actions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pending_conversation_actions_consumerMessageId_key" ON "pending_conversation_actions"("consumerMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "pending_conversation_actions_operationKey_key" ON "pending_conversation_actions"("operationKey");

-- CreateIndex
CREATE UNIQUE INDEX "pending_conversation_actions_sourceMessageId_type_key" ON "pending_conversation_actions"("sourceMessageId", "type");

-- CreateIndex
CREATE INDEX "pending_conversation_actions_userId_conversationId_type_status_idx" ON "pending_conversation_actions"("userId", "conversationId", "type", "status");

-- CreateIndex
CREATE INDEX "pending_conversation_actions_status_expiresAt_idx" ON "pending_conversation_actions"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "pending_conversation_actions_conversationId_createdAt_idx" ON "pending_conversation_actions"("conversationId", "createdAt");

-- At most one live action of a type may own a conversation at a time.
CREATE UNIQUE INDEX "pending_conversation_actions_one_active_type_per_conversation_key"
ON "pending_conversation_actions"("userId", "conversationId", "type")
WHERE "status" IN ('AWAITING_PROMPT', 'PENDING', 'CONSUMED_PENDING_EXECUTION', 'EXECUTING');

-- AddForeignKey
ALTER TABLE "pending_conversation_actions" ADD CONSTRAINT "pending_conversation_actions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_conversation_actions" ADD CONSTRAINT "pending_conversation_actions_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_conversation_actions" ADD CONSTRAINT "pending_conversation_actions_sourceMessageId_fkey" FOREIGN KEY ("sourceMessageId") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_conversation_actions" ADD CONSTRAINT "pending_conversation_actions_consumerMessageId_fkey" FOREIGN KEY ("consumerMessageId") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
