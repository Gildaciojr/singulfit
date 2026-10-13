\set ON_ERROR_STOP on
-- Public-offer rollback only. Never delete V2, change contracted planId or reduce grants.
-- Required variables must come from reviewed PREVIEW/receipt, not guessed values.
BEGIN;
LOCK TABLE "plans", "plan_entitlements", "entitlement_definitions" IN SHARE ROW EXCLUSIVE MODE;
SELECT set_config('singulfit.legacy_id', :'legacy_plan_id', true),
       set_config('singulfit.v2_id', :'new_plan_id', true),
       set_config('singulfit.legacy_fingerprint', :'expected_legacy_fingerprint', true),
       set_config('singulfit.v2_fingerprint', :'expected_v2_fingerprint', true),
       set_config('singulfit.authorization', :'authorization', true);
DO $$
DECLARE p RECORD;
  fingerprint TEXT;
  expected TEXT;
  found_count INTEGER := 0;
BEGIN
  IF current_setting('singulfit.authorization') <> 'BASIC_V2_PUBLIC_OFFER_ROLLBACK' THEN RAISE EXCEPTION 'Explicit offer rollback authorization required'; END IF;
  FOR p IN SELECT * FROM "plans" WHERE "id" IN (current_setting('singulfit.legacy_id'), current_setting('singulfit.v2_id')) LOOP
    found_count := found_count + 1;
    IF p."type" <> 'BASIC' OR NOT p."isActive" THEN RAISE EXCEPTION 'Unexpected rollback contract'; END IF;
    IF p."id" = current_setting('singulfit.legacy_id') THEN
      IF p."contractVersion" <> 'legacy-v1' OR p."isCurrentOffer" THEN RAISE EXCEPTION 'Unexpected legacy offer state'; END IF;
      expected := current_setting('singulfit.legacy_fingerprint');
    ELSE
      IF p."contractVersion" <> 'basic-v2' OR NOT p."isCurrentOffer" THEN RAISE EXCEPTION 'Unexpected V2 offer state'; END IF;
      expected := current_setting('singulfit.v2_fingerprint');
    END IF;
    SELECT encode(sha256(convert_to(jsonb_build_object('plan', to_jsonb(p), 'grants',
      COALESCE((SELECT jsonb_agg(jsonb_build_object('grant',to_jsonb(pe),'definition',to_jsonb(ed)) ORDER BY pe."id") FROM "plan_entitlements" pe JOIN "entitlement_definitions" ed ON ed."id"=pe."entitlementId" WHERE pe."planId" = p."id"), '[]'::jsonb))::text, 'UTF8')), 'hex') INTO fingerprint;
    IF fingerprint <> expected THEN RAISE EXCEPTION 'Rollback compare-and-swap fingerprint changed'; END IF;
  END LOOP;
  IF found_count <> 2 THEN RAISE EXCEPTION 'Rollback requires both distinct contract identities'; END IF;
  UPDATE "plans" SET "isCurrentOffer" = false WHERE "id" = current_setting('singulfit.v2_id');
  UPDATE "plans" SET "isCurrentOffer" = true WHERE "id" = current_setting('singulfit.legacy_id');
END $$;
SET CONSTRAINTS ALL IMMEDIATE;
-- Caller must explicitly choose APPLY=true. Otherwise this is a simulation.
\if :{?apply}
  \if :apply
    COMMIT;
  \else
    ROLLBACK;
  \endif
\else
  ROLLBACK;
\endif
