-- Expand only. No historical order is inferred or backfilled.
ALTER TABLE "users" ADD COLUMN "onboardingIngressCounter" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "evolution_inbound_events"
  ADD COLUMN "orderingUserId" TEXT,
  ADD COLUMN "admissionSequence" INTEGER,
  ADD COLUMN "turnProcessedAt" TIMESTAMP(3);
ALTER TABLE "users" ADD CONSTRAINT "users_onboardingIngressCounter_nonnegative"
  CHECK ("onboardingIngressCounter" >= 0);
ALTER TABLE "evolution_inbound_events" ADD CONSTRAINT "inbound_order_pair"
  CHECK (("orderingUserId" IS NULL AND "admissionSequence" IS NULL)
    OR ("orderingUserId" IS NOT NULL AND "admissionSequence" IS NOT NULL AND "admissionSequence" > 0));
ALTER TABLE "evolution_inbound_events" ADD CONSTRAINT "evolution_inbound_events_orderingUserId_fkey"
  FOREIGN KEY ("orderingUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE UNIQUE INDEX "evolution_inbound_events_orderingUserId_admissionSequence_key"
  ON "evolution_inbound_events"("orderingUserId", "admissionSequence");
CREATE INDEX "evolution_inbound_events_orderingUserId_turnProcessedAt_admissionSequence_idx"
  ON "evolution_inbound_events"("orderingUserId", "turnProcessedAt", "admissionSequence");
