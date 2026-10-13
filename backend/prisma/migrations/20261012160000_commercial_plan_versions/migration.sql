BEGIN;

ALTER TABLE "plans"
  ADD COLUMN "contractVersion" TEXT NOT NULL DEFAULT 'legacy-v1',
  ADD COLUMN "isCurrentOffer" BOOLEAN NOT NULL DEFAULT false;

-- Preserve all original IDs, prices, grants, subscriptions and timestamps.
-- Only original active offers remain publicly selectable after structural migration.
UPDATE "plans" SET "isCurrentOffer" = "isActive";
DROP INDEX "plans_type_key";
CREATE UNIQUE INDEX "plans_type_contractVersion_key" ON "plans"("type", "contractVersion");
CREATE INDEX "plans_type_isCurrentOffer_idx" ON "plans"("type", "isCurrentOffer");
-- Prisma 5 cannot express a partial unique index; this is authoritative PostgreSQL DDL.
CREATE UNIQUE INDEX "plans_current_offer_type_key" ON "plans"("type") WHERE "isCurrentOffer";
ALTER TABLE "plans"
  ADD CONSTRAINT "plans_contract_version_check" CHECK ("contractVersion" ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  ADD CONSTRAINT "plans_current_offer_active_check" CHECK (NOT "isCurrentOffer" OR "isActive");

CREATE FUNCTION "protect_plan_contract_identity"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."type" IS DISTINCT FROM OLD."type"
    OR NEW."contractVersion" IS DISTINCT FROM OLD."contractVersion" THEN
    RAISE EXCEPTION 'Plan contract identity is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "plans_contract_identity_guard" BEFORE UPDATE ON "plans"
  FOR EACH ROW EXECUTE FUNCTION "protect_plan_contract_identity"();

CREATE FUNCTION "validate_current_basic_v2_contract"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target_id TEXT;
  target_ids TEXT[];
  configured BOOLEAN;
BEGIN
  IF TG_TABLE_NAME = 'plans' THEN target_ids := ARRAY[NEW."id", OLD."id"];
  ELSIF TG_TABLE_NAME = 'plan_entitlements' THEN target_ids := ARRAY[NEW."planId", OLD."planId"];
  ELSE SELECT array_agg("id") INTO target_ids FROM "plans" WHERE "type" = 'BASIC' AND "contractVersion" = 'basic-v2' AND "isCurrentOffer";
  END IF;
  FOREACH target_id IN ARRAY COALESCE(target_ids, ARRAY[]::TEXT[]) LOOP
  IF NOT EXISTS (SELECT 1 FROM "plans" WHERE "id" = target_id
      AND "type" = 'BASIC' AND "contractVersion" = 'basic-v2' AND "isCurrentOffer") THEN
    CONTINUE;
  END IF;
  SELECT p."isActive" AND p."price" = 29.90 AND p."currency" = 'BRL'
    AND p."billingInterval" = 'MONTH' AND p."billingIntervalCount" = 1
    AND p."imageLimit" = 30 AND NOT p."imageUnlimited"
    AND (SELECT count(*) = 4 FROM "plan_entitlements" pe JOIN "entitlement_definitions" e ON e."id" = pe."entitlementId"
      WHERE pe."planId" = p."id" AND NOT pe."unlimited"
        AND ((e."code" IN ('AUDIO_TRANSCRIPTION','IMAGE_ANALYSIS') AND pe."value" = 30)
          OR (e."code" IN ('NUTRITION_PLAN_GENERATION','WORKOUT_PLAN_GENERATION') AND pe."value" = 2)))
    AND NOT EXISTS (SELECT 1 FROM "plan_entitlements" pe JOIN "entitlement_definitions" e ON e."id" = pe."entitlementId"
      WHERE pe."planId" = p."id" AND e."code" IN ('IMAGE_ANALYSIS_DAILY','IMAGE_ANALYSIS_MONTHLY'))
  INTO configured FROM "plans" p WHERE p."id" = target_id;
  IF configured IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Current BASIC V2 contract is incomplete or contradictory' USING ERRCODE = '23514';
  END IF;
  END LOOP;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER "plans_current_basic_v2_guard" AFTER INSERT OR UPDATE ON "plans"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "validate_current_basic_v2_contract"();
CREATE CONSTRAINT TRIGGER "plan_entitlements_current_basic_v2_guard" AFTER INSERT OR UPDATE OR DELETE ON "plan_entitlements"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "validate_current_basic_v2_contract"();

CREATE CONSTRAINT TRIGGER "entitlement_definitions_current_basic_v2_guard" AFTER UPDATE OR DELETE ON "entitlement_definitions"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "validate_current_basic_v2_contract"();

COMMIT;
