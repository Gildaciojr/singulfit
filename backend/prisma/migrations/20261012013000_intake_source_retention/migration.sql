-- Keep a source-message cleanup from silently deleting an intake receipt.
-- Deferred NO ACTION still permits the authorized whole-user cascade in one transaction.
ALTER TABLE "nutrition_intake_records" DROP CONSTRAINT "nutrition_intake_records_sourceMessageId_fkey";
ALTER TABLE "nutrition_intake_records" ADD CONSTRAINT "nutrition_intake_records_sourceMessageId_fkey"
FOREIGN KEY ("sourceMessageId") REFERENCES "messages"("id") ON DELETE NO ACTION ON UPDATE CASCADE
DEFERRABLE INITIALLY DEFERRED;
