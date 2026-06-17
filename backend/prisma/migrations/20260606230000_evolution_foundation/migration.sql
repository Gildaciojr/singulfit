-- Normalize phone numbers for deterministic WhatsApp identity lookups.
ALTER TABLE "users" ADD COLUMN "phoneE164" TEXT;

UPDATE "users"
SET "phoneE164" = CASE
  WHEN length(regexp_replace("phone", '[^0-9]', '', 'g')) IN (10, 11)
    THEN '+55' || regexp_replace("phone", '[^0-9]', '', 'g')
  WHEN length(regexp_replace("phone", '[^0-9]', '', 'g')) IN (12, 13)
    AND regexp_replace("phone", '[^0-9]', '', 'g') LIKE '55%'
    THEN '+' || regexp_replace("phone", '[^0-9]', '', 'g')
  ELSE NULL
END;

CREATE UNIQUE INDEX "users_phoneE164_key" ON "users"("phoneE164");

-- Keep the subscription observed when an inbound conversation is opened.
ALTER TABLE "conversations" ADD COLUMN "subscriptionId" TEXT;

CREATE INDEX "conversations_subscriptionId_idx"
ON "conversations"("subscriptionId");

ALTER TABLE "conversations"
ADD CONSTRAINT "conversations_subscriptionId_fkey"
FOREIGN KEY ("subscriptionId")
REFERENCES "subscriptions"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;

-- Store provider identity and media metadata without persisting media binaries.
DROP INDEX IF EXISTS "messages_externalMessageId_key";

ALTER TABLE "messages"
  ADD COLUMN "instanceName" TEXT NOT NULL DEFAULT 'INTERNAL',
  ADD COLUMN "remoteJid" TEXT,
  ADD COLUMN "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "mediaUrl" TEXT,
  ADD COLUMN "mimeType" TEXT,
  ADD COLUMN "fileSize" INTEGER;

UPDATE "messages" SET "timestamp" = "createdAt";

CREATE UNIQUE INDEX "messages_instanceName_externalMessageId_key"
ON "messages"("instanceName", "externalMessageId");

CREATE INDEX "messages_remoteJid_timestamp_idx"
ON "messages"("remoteJid", "timestamp");

CREATE INDEX "messages_instanceName_timestamp_idx"
ON "messages"("instanceName", "timestamp");

ALTER TABLE "messages"
  ADD CONSTRAINT "messages_file_size_non_negative_check"
    CHECK ("fileSize" IS NULL OR "fileSize" >= 0),
  ADD CONSTRAINT "messages_remote_jid_not_blank_check"
    CHECK ("remoteJid" IS NULL OR btrim("remoteJid") <> ''),
  ADD CONSTRAINT "messages_media_url_not_blank_check"
    CHECK ("mediaUrl" IS NULL OR btrim("mediaUrl") <> ''),
  ADD CONSTRAINT "messages_mime_type_not_blank_check"
    CHECK ("mimeType" IS NULL OR btrim("mimeType") <> '');
