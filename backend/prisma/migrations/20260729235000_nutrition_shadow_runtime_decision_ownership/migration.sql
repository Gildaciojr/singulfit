ALTER TABLE "nutrition_shadow_runtime_decisions"
  ADD COLUMN "ownershipToken" TEXT,
  ADD COLUMN "ownershipClaimedAt" TIMESTAMP(3),
  ADD COLUMN "ownershipExpiresAt" TIMESTAMP(3);

DROP TRIGGER "nutrition_shadow_runtime_decision_terminal_guard"
  ON "nutrition_shadow_runtime_decisions";
DROP FUNCTION "protect_nutrition_shadow_runtime_decision"();

UPDATE "nutrition_shadow_runtime_decisions"
SET
  "ownershipToken" = 'migration-expired:' || "id",
  "ownershipClaimedAt" = LEAST(
    "createdAt",
    CURRENT_TIMESTAMP - INTERVAL '2 milliseconds'
  ),
  "ownershipExpiresAt" = CURRENT_TIMESTAMP - INTERVAL '1 millisecond'
WHERE "decision" = 'PENDING';

ALTER TABLE "nutrition_shadow_runtime_decisions"
  DROP CONSTRAINT "nutrition_shadow_runtime_decisions_state_check";

ALTER TABLE "nutrition_shadow_runtime_decisions"
  ADD CONSTRAINT "nutrition_shadow_runtime_decisions_state_check" CHECK (
    (
      "decision" = 'PENDING'
      AND "shadowRunId" IS NULL
      AND "skipReason" IS NULL
      AND "ownershipToken" IS NOT NULL
      AND "ownershipClaimedAt" IS NOT NULL
      AND "ownershipExpiresAt" IS NOT NULL
      AND "ownershipExpiresAt" > "ownershipClaimedAt"
    )
    OR (
      "decision" = 'STARTED'
      AND "shadowRunId" IS NOT NULL
      AND "skipReason" IS NULL
      AND "ownershipToken" IS NULL
      AND (
        (
          "ownershipClaimedAt" IS NULL
          AND "ownershipExpiresAt" IS NULL
        )
        OR (
          "ownershipClaimedAt" IS NOT NULL
          AND "ownershipExpiresAt" IS NOT NULL
          AND "ownershipExpiresAt" > "ownershipClaimedAt"
        )
      )
    )
    OR (
      "decision" = 'SKIPPED'
      AND "shadowRunId" IS NULL
      AND "skipReason" IS NOT NULL
      AND "ownershipToken" IS NULL
      AND (
        (
          "ownershipClaimedAt" IS NULL
          AND "ownershipExpiresAt" IS NULL
        )
        OR (
          "ownershipClaimedAt" IS NOT NULL
          AND "ownershipExpiresAt" IS NOT NULL
          AND "ownershipExpiresAt" > "ownershipClaimedAt"
        )
      )
    )
  );

CREATE UNIQUE INDEX "nutrition_shadow_runtime_decisions_ownershipToken_key"
  ON "nutrition_shadow_runtime_decisions"("ownershipToken");
CREATE INDEX "nutrition_shadow_runtime_decisions_ownership_expiry_idx"
  ON "nutrition_shadow_runtime_decisions"("decision", "ownershipExpiresAt");

CREATE FUNCTION "protect_nutrition_shadow_runtime_decision"() RETURNS TRIGGER AS $$
BEGIN
  IF OLD."decision" <> 'PENDING' THEN
    RAISE EXCEPTION 'Terminal NutritionShadowRuntimeDecision is immutable';
  END IF;
  IF NEW."id" <> OLD."id"
    OR NEW."operationKey" <> OLD."operationKey"
    OR NEW."inputFingerprint" <> OLD."inputFingerprint"
    OR NEW."userId" <> OLD."userId"
    OR NEW."correlationId" <> OLD."correlationId"
    OR NEW."conversationGoal" <> OLD."conversationGoal"
    OR NEW."createdAt" <> OLD."createdAt"
    OR NEW."conversationId" IS DISTINCT FROM OLD."conversationId"
    OR NEW."messageId" IS DISTINCT FROM OLD."messageId"
    OR NEW."traceId" IS DISTINCT FROM OLD."traceId"
  THEN
    RAISE EXCEPTION 'NutritionShadowRuntimeDecision identity is immutable';
  END IF;
  IF NEW."decision" = 'PENDING' THEN
    IF NEW."decisionAt" <> OLD."decisionAt"
      OR NEW."shadowRunId" IS DISTINCT FROM OLD."shadowRunId"
      OR NEW."skipReason" IS DISTINCT FROM OLD."skipReason"
    THEN
      RAISE EXCEPTION 'Pending NutritionShadowRuntimeDecision may only change ownership';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "nutrition_shadow_runtime_decision_terminal_guard"
BEFORE UPDATE ON "nutrition_shadow_runtime_decisions"
FOR EACH ROW EXECUTE FUNCTION "protect_nutrition_shadow_runtime_decision"();
