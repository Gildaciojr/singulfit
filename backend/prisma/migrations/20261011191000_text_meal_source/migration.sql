ALTER TYPE "MealSource" ADD VALUE 'TEXT_REPORT';
ALTER TABLE "meals" ADD CONSTRAINT "meals_text_report_links_check" CHECK (
  "source"::text <> 'TEXT_REPORT' OR (
    "conversationId" IS NOT NULL AND "messageId" IS NOT NULL AND "mediaFileId" IS NULL
  )
);
