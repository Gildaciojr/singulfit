CREATE TYPE "MediaType" AS ENUM ('IMAGE', 'AUDIO', 'DOCUMENT');

CREATE TYPE "StorageProvider" AS ENUM ('LOCAL', 'S3');

CREATE TABLE "media_files" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  "mediaType" "MediaType" NOT NULL,
  "storageProvider" "StorageProvider" NOT NULL DEFAULT 'LOCAL',
  "originalFileName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "fileSize" INTEGER NOT NULL,
  "checksum" CHAR(64) NOT NULL,
  "storagePath" TEXT NOT NULL,
  "publicUrl" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "media_files_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "media_files_messageId_key"
ON "media_files"("messageId");

CREATE INDEX "media_files_userId_createdAt_idx"
ON "media_files"("userId", "createdAt");

CREATE INDEX "media_files_conversationId_createdAt_idx"
ON "media_files"("conversationId", "createdAt");

CREATE INDEX "media_files_storageProvider_checksum_idx"
ON "media_files"("storageProvider", "checksum");

ALTER TABLE "media_files"
ADD CONSTRAINT "media_files_userId_fkey"
FOREIGN KEY ("userId")
REFERENCES "users"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

ALTER TABLE "media_files"
ADD CONSTRAINT "media_files_conversationId_fkey"
FOREIGN KEY ("conversationId")
REFERENCES "conversations"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

ALTER TABLE "media_files"
ADD CONSTRAINT "media_files_messageId_fkey"
FOREIGN KEY ("messageId")
REFERENCES "messages"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

ALTER TABLE "media_files"
  ADD CONSTRAINT "media_files_original_name_not_blank_check"
    CHECK (btrim("originalFileName") <> ''),
  ADD CONSTRAINT "media_files_mime_type_not_blank_check"
    CHECK (btrim("mimeType") <> ''),
  ADD CONSTRAINT "media_files_file_size_positive_check"
    CHECK ("fileSize" > 0),
  ADD CONSTRAINT "media_files_checksum_sha256_check"
    CHECK ("checksum" ~ '^[a-f0-9]{64}$'),
  ADD CONSTRAINT "media_files_storage_path_not_blank_check"
    CHECK (btrim("storagePath") <> ''),
  ADD CONSTRAINT "media_files_public_url_not_blank_check"
    CHECK ("publicUrl" IS NULL OR btrim("publicUrl") <> '');
