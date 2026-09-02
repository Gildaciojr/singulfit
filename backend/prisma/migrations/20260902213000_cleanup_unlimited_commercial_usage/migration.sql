-- Commercial usage is intentionally counter-free for plans whose entitlement
-- is explicitly unlimited. Migration 20260902013000 backfilled both buckets
-- and events without applying that invariant.
--
-- Match the exact persisted subscription cycle and that cycle's plan before
-- deleting anything. This deliberately leaves unmatched historical cycles
-- untouched, including legitimate BASIC usage from a prior period.
CREATE TEMP TABLE "_unlimited_commercial_cycles_cleanup"
ON COMMIT DROP
AS
SELECT DISTINCT
  bucket."userId",
  bucket."entitlementCode",
  bucket."periodStart",
  bucket."periodEnd"
FROM "usage_buckets" bucket
JOIN "subscriptions" subscription
  ON subscription."userId" = bucket."userId"
  AND subscription."currentPeriodStart" = bucket."periodStart"
  AND subscription."currentPeriodEnd" = bucket."periodEnd"
JOIN "plan_entitlements" plan_entitlement
  ON plan_entitlement."planId" = subscription."planId"
  AND plan_entitlement."unlimited" = true
JOIN "entitlement_definitions" entitlement
  ON entitlement."id" = plan_entitlement."entitlementId"
  AND entitlement."code" = bucket."entitlementCode"
WHERE bucket."entitlementCode" IN (
  'NUTRITION_PLAN_GENERATION',
  'WORKOUT_PLAN_GENERATION',
  'IMAGE_ANALYSIS'
);

CREATE UNIQUE INDEX "_unlimited_commercial_cycles_cleanup_key"
ON "_unlimited_commercial_cycles_cleanup" (
  "userId",
  "entitlementCode",
  "periodStart",
  "periodEnd"
);

-- Backfilled commercial events use the completed operation timestamp as
-- createdAt. Restrict deletion to CONFIRMED events inside the exact unlimited
-- cycle captured above. userId or the user's current plan alone is not enough.
DELETE FROM "usage_events" event
USING "_unlimited_commercial_cycles_cleanup" cycle
WHERE event."userId" = cycle."userId"
  AND event."entitlementCode" = cycle."entitlementCode"
  AND event."status" = 'CONFIRMED'
  AND event."createdAt" >= cycle."periodStart"
  AND event."createdAt" < cycle."periodEnd";

DELETE FROM "usage_buckets" bucket
USING "_unlimited_commercial_cycles_cleanup" cycle
WHERE bucket."userId" = cycle."userId"
  AND bucket."entitlementCode" = cycle."entitlementCode"
  AND bucket."periodStart" = cycle."periodStart"
  AND bucket."periodEnd" = cycle."periodEnd";
