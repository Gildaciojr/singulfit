-- Expand-only hardening. Existing three migrations are unchanged.
CREATE FUNCTION "guard_nutrition_intake_record"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (to_jsonb(NEW) - 'voidedAt') IS DISTINCT FROM (to_jsonb(OLD) - 'voidedAt') THEN
      RAISE EXCEPTION 'INTAKE_RECEIPT_IMMUTABLE' USING ERRCODE = '23514';
    END IF;
    IF NEW."voidedAt" IS DISTINCT FROM OLD."voidedAt" AND
       (OLD."voidedAt" IS NOT NULL OR NEW."voidedAt" IS NULL OR NOT EXISTS (
          SELECT 1 FROM "nutrition_intake_records" r
          WHERE r."supersedesId" = OLD."id" AND r."userId" = OLD."userId"
            AND r."reportedAt" = NEW."voidedAt"
       )) THEN
      RAISE EXCEPTION 'INTAKE_REVISION_REQUIRED' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "messages" m JOIN "conversations" c ON c."id" = m."conversationId"
    WHERE m."id" = NEW."sourceMessageId" AND c."userId" = NEW."userId"
      AND m."direction" = 'INBOUND' AND m."type" = 'TEXT'
  ) OR (NEW."mealId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "meals" m WHERE m."id" = NEW."mealId" AND m."userId" = NEW."userId"
  )) OR (NEW."supersedesId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "nutrition_intake_records" r WHERE r."id" = NEW."supersedesId" AND r."userId" = NEW."userId"
  )) THEN
    RAISE EXCEPTION 'INTAKE_OWNERSHIP_MISMATCH' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "nutrition_intake_records_guard" BEFORE INSERT OR UPDATE ON "nutrition_intake_records"
FOR EACH ROW EXECUTE FUNCTION "guard_nutrition_intake_record"();
