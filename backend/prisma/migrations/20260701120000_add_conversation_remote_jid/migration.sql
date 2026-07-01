ALTER TABLE "conversations" ADD COLUMN "remoteJid" TEXT;

CREATE INDEX "conversations_remoteJid_status_idx" ON "conversations"("remoteJid", "status");
