CREATE TABLE "nutrition_intake_records" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "sourceMessageId" TEXT NOT NULL,
  "operationKey" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "reportedAt" TIMESTAMP(3) NOT NULL,
  "volumeMl" INTEGER,
  "mealId" TEXT,
  "evidence" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "nutrition_intake_records_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "nutrition_intake_records_kind_check" CHECK (
    ("kind" = 'MEAL' AND "mealId" IS NOT NULL AND "volumeMl" IS NULL) OR
    ("kind" IN ('WATER_ADD', 'WATER_TOTAL') AND "mealId" IS NULL AND "volumeMl" > 0)
  )
);
CREATE UNIQUE INDEX "nutrition_intake_records_sourceMessageId_key" ON "nutrition_intake_records"("sourceMessageId");
CREATE UNIQUE INDEX "nutrition_intake_records_operationKey_key" ON "nutrition_intake_records"("operationKey");
CREATE INDEX "nutrition_intake_records_userId_occurredAt_idx" ON "nutrition_intake_records"("userId", "occurredAt");
ALTER TABLE "nutrition_intake_records" ADD CONSTRAINT "nutrition_intake_records_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "nutrition_intake_records" ADD CONSTRAINT "nutrition_intake_records_mealId_fkey" FOREIGN KEY ("mealId") REFERENCES "meals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "nutrition_intake_records" ADD CONSTRAINT "nutrition_intake_records_sourceMessageId_fkey" FOREIGN KEY ("sourceMessageId") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
