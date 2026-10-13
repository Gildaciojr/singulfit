ALTER TABLE "nutrition_intake_records" ADD COLUMN "voidedAt" TIMESTAMP(3), ADD COLUMN "supersedesId" TEXT;
CREATE UNIQUE INDEX "nutrition_intake_records_supersedesId_key" ON "nutrition_intake_records"("supersedesId");
ALTER TABLE "nutrition_intake_records" ADD CONSTRAINT "nutrition_intake_records_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "nutrition_intake_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "nutrition_intake_records" DROP CONSTRAINT "nutrition_intake_records_kind_check";
ALTER TABLE "nutrition_intake_records" ADD CONSTRAINT "nutrition_intake_records_kind_check" CHECK (
  ("kind" = 'MEAL' AND "mealId" IS NOT NULL AND "volumeMl" IS NULL) OR
  ("kind" IN ('WATER_ADD', 'WATER_TOTAL', 'WATER_GOAL') AND "mealId" IS NULL AND "volumeMl" >= 0) OR
  ("kind" = 'VOID' AND "supersedesId" IS NOT NULL AND "mealId" IS NULL AND "volumeMl" IS NULL)
);
