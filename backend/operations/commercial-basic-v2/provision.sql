\set ON_ERROR_STOP on
\if :{?mode}
\else
  \set mode PREVIEW
\endif

-- Run only against the explicitly selected database. No seed or customer migration.
-- PREVIEW needs no mutation parameters. SIMULATE and APPLY require all four parameters.
SELECT :'mode' = 'PREVIEW' AS preview, :'mode' = 'SIMULATE' AS simulate,
       :'mode' = 'APPLY' AS apply \gset
\if :preview
  SELECT p."id", p."type", p."contractVersion", p."isCurrentOffer", p."price",
    encode(sha256(convert_to(jsonb_build_object('plan', to_jsonb(p), 'grants',
      COALESCE((SELECT jsonb_agg(jsonb_build_object('grant',to_jsonb(pe),'definition',to_jsonb(ed)) ORDER BY pe."id") FROM "plan_entitlements" pe JOIN "entitlement_definitions" ed ON ed."id"=pe."entitlementId" WHERE pe."planId" = p."id"), '[]'::jsonb))::text, 'UTF8')), 'hex') AS fingerprint
  FROM "plans" p WHERE p."type" = 'BASIC' ORDER BY p."contractVersion";
\else
  \if :simulate
  \else
    \if :apply
    \else
      \echo Invalid mode; no changes applied.
      \quit 3
    \endif
  \endif
  BEGIN;
  LOCK TABLE "plans", "plan_entitlements", "entitlement_definitions" IN SHARE ROW EXCLUSIVE MODE;
  SELECT set_config('singulfit.basic_legacy_id', :'legacy_plan_id', true),
         set_config('singulfit.basic_v2_id', :'new_plan_id', true),
         set_config('singulfit.expected_fingerprint', :'expected_fingerprint', true),
         set_config('singulfit.authorization', :'authorization', true);
  DO $$
  DECLARE legacy_id TEXT := current_setting('singulfit.basic_legacy_id');
    new_id TEXT := current_setting('singulfit.basic_v2_id');
    fingerprint TEXT;
    resource RECORD;
  BEGIN
    IF current_setting('singulfit.authorization') <> 'BASIC_V2_CREATE_AND_ACTIVATE' THEN
      RAISE EXCEPTION 'Explicit provisioning and activation authorization required';
    END IF;
    PERFORM new_id::uuid;
    SELECT encode(sha256(convert_to(jsonb_build_object('plan', to_jsonb(p), 'grants',
      COALESCE((SELECT jsonb_agg(jsonb_build_object('grant',to_jsonb(pe),'definition',to_jsonb(ed)) ORDER BY pe."id") FROM "plan_entitlements" pe JOIN "entitlement_definitions" ed ON ed."id"=pe."entitlementId" WHERE pe."planId" = p."id"), '[]'::jsonb))::text, 'UTF8')), 'hex')
      INTO fingerprint FROM "plans" p WHERE p."id" = legacy_id AND p."type" = 'BASIC' AND p."contractVersion" = 'legacy-v1';
    IF fingerprint IS NULL OR fingerprint <> current_setting('singulfit.expected_fingerprint') THEN
      RAISE EXCEPTION 'Legacy commercial fingerprint changed';
    END IF;
    IF new_id = legacy_id THEN RAISE EXCEPTION 'Version requires a new identity'; END IF;
    IF EXISTS (SELECT 1 FROM "plans" WHERE "type" = 'BASIC' AND "isCurrentOffer" AND "id" NOT IN (legacy_id, new_id)) THEN
      RAISE EXCEPTION 'Unexpected current BASIC offer';
    END IF;
    IF EXISTS (SELECT 1 FROM "plans" WHERE ("id" = new_id OR ("type" = 'BASIC' AND "contractVersion" = 'basic-v2'))
      AND NOT ("id" = new_id AND "type" = 'BASIC' AND "contractVersion" = 'basic-v2'
        AND "price" = 29.90 AND "currency" = 'BRL' AND "billingInterval" = 'MONTH'
        AND "billingIntervalCount" = 1 AND "imageLimit" = 30 AND NOT "imageUnlimited" AND "isActive")) THEN
      RAISE EXCEPTION 'Existing version conflicts with approved contract';
    END IF;
    INSERT INTO "plans" ("id", "type", "contractVersion", "isCurrentOffer", "name", "price", "currency", "billingInterval", "billingIntervalCount", "imageLimit", "imageUnlimited", "isActive", "updatedAt")
      VALUES (new_id, 'BASIC', 'basic-v2', false, 'Basic', 29.90, 'BRL', 'MONTH', 1, 30, false, true, now())
      ON CONFLICT ("type", "contractVersion") DO NOTHING;
    FOR resource IN SELECT * FROM (VALUES ('AUDIO_TRANSCRIPTION', 30), ('IMAGE_ANALYSIS', 30), ('NUTRITION_PLAN_GENERATION', 2), ('WORKOUT_PLAN_GENERATION', 2)) AS grants(code, quantity) LOOP
      INSERT INTO "entitlement_definitions" ("id", "code", "name") VALUES (gen_random_uuid()::text, resource.code, resource.code) ON CONFLICT ("code") DO NOTHING;
      IF EXISTS (SELECT 1 FROM "plan_entitlements" pe JOIN "entitlement_definitions" e ON e."id" = pe."entitlementId"
          WHERE pe."planId" = new_id AND e."code" = resource.code AND (pe."value" <> resource.quantity OR pe."unlimited")) THEN
        RAISE EXCEPTION 'Existing V2 grant conflicts; no overwrite authorized';
      END IF;
      INSERT INTO "plan_entitlements" ("id", "planId", "entitlementId", "value", "unlimited")
        SELECT gen_random_uuid()::text, new_id, e."id", resource.quantity, false FROM "entitlement_definitions" e WHERE e."code" = resource.code
        ON CONFLICT ("planId", "entitlementId") DO NOTHING;
    END LOOP;
    UPDATE "plans" SET "isCurrentOffer" = false WHERE "id" = legacy_id;
    UPDATE "plans" SET "isCurrentOffer" = true WHERE "id" = new_id;
  END $$;
  SET CONSTRAINTS ALL IMMEDIATE;
  SELECT jsonb_build_object('operation', 'BASIC_V2_CREATE_AND_ACTIVATE',
    'legacyPlanId', current_setting('singulfit.basic_legacy_id'), 'newPlanId', current_setting('singulfit.basic_v2_id'),
    'legacyFingerprintBefore', current_setting('singulfit.expected_fingerprint'),
    'schemaRollbackAllowed', false, 'subscriptionsReassigned', false) AS reversal_receipt;
  \if :simulate
    ROLLBACK;
  \else
    COMMIT;
  \endif
\endif
