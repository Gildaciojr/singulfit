CREATE TYPE "NutritionShadowRuntimeDecisionType" AS ENUM (
  'PENDING', 'STARTED', 'SKIPPED'
);

CREATE TYPE "NutritionShadowRuntimeSkipReason" AS ENUM (
  'DISABLED_BY_POLICY',
  'NON_NUTRITION_GOAL',
  'CONCURRENCY_LIMIT',
  'SHUTTING_DOWN',
  'MISSING_REQUIRED_CONTEXT',
  'POLICY_EVALUATION_ERROR',
  'STORAGE_UNAVAILABLE'
);

ALTER TABLE "nutrition_shadow_runs"
  ADD COLUMN "conversationGoal" TEXT;

ALTER TABLE "nutrition_shadow_comparisons"
  ADD COLUMN "conversationGoal" TEXT;

CREATE INDEX "nutrition_shadow_runs_goal_created_idx"
  ON "nutrition_shadow_runs"("conversationGoal", "createdAt");
CREATE INDEX "nutrition_shadow_comparisons_goal_created_idx"
  ON "nutrition_shadow_comparisons"("conversationGoal", "createdAt");

ALTER TABLE "nutrition_shadow_runs"
  ADD CONSTRAINT "nutrition_shadow_runs_conversation_goal_check" CHECK (
    "conversationGoal" IS NULL OR "conversationGoal" IN (
      'ANSWER_MESSAGE',
      'ASK_PROFILE_INFORMATION',
      'GENERATE_DIET_PLAN',
      'GENERATE_WORKOUT_PLAN',
      'GENERATE_COMBINED_PLANS',
      'UPDATE_DIET_PLAN',
      'UPDATE_WORKOUT_PLAN',
      'REVIEW_PROGRESS',
      'REQUEST_CONFIRMATION',
      'SHOW_CURRENT_PLAN',
      'SHOW_PLAN_STATUS',
      'GENERAL_GUIDANCE',
      'UNKNOWN'
    )
  );

-- NOT VALID preserves historical rows while enforcing the field for every new run.
ALTER TABLE "nutrition_shadow_runs"
  ADD CONSTRAINT "nutrition_shadow_runs_conversation_goal_required_for_new_check"
  CHECK ("conversationGoal" IS NOT NULL) NOT VALID;

ALTER TABLE "nutrition_shadow_comparisons"
  ADD CONSTRAINT "nutrition_shadow_comparisons_conversation_goal_check" CHECK (
    "conversationGoal" IS NULL OR "conversationGoal" IN (
      'ANSWER_MESSAGE',
      'ASK_PROFILE_INFORMATION',
      'GENERATE_DIET_PLAN',
      'GENERATE_WORKOUT_PLAN',
      'GENERATE_COMBINED_PLANS',
      'UPDATE_DIET_PLAN',
      'UPDATE_WORKOUT_PLAN',
      'REVIEW_PROGRESS',
      'REQUEST_CONFIRMATION',
      'SHOW_CURRENT_PLAN',
      'SHOW_PLAN_STATUS',
      'GENERAL_GUIDANCE',
      'UNKNOWN'
    )
  );

-- Comparison keeps an independent analytical snapshot without rewriting history.
ALTER TABLE "nutrition_shadow_comparisons"
  ADD CONSTRAINT "nutrition_shadow_comparisons_conversation_goal_required_for_new_check"
  CHECK ("conversationGoal" IS NOT NULL) NOT VALID;

CREATE TABLE "nutrition_shadow_runtime_decisions" (
  "id" TEXT NOT NULL,
  "operationKey" TEXT NOT NULL,
  "inputFingerprint" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "conversationId" TEXT,
  "messageId" TEXT,
  "correlationId" TEXT NOT NULL,
  "traceId" TEXT,
  "conversationGoal" TEXT NOT NULL,
  "decision" "NutritionShadowRuntimeDecisionType" NOT NULL DEFAULT 'PENDING',
  "skipReason" "NutritionShadowRuntimeSkipReason",
  "shadowRunId" TEXT,
  "decisionAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "nutrition_shadow_runtime_decisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "nutrition_shadow_runtime_decisions_goal_check" CHECK (
    "conversationGoal" IN (
      'ANSWER_MESSAGE',
      'ASK_PROFILE_INFORMATION',
      'GENERATE_DIET_PLAN',
      'GENERATE_WORKOUT_PLAN',
      'GENERATE_COMBINED_PLANS',
      'UPDATE_DIET_PLAN',
      'UPDATE_WORKOUT_PLAN',
      'REVIEW_PROGRESS',
      'REQUEST_CONFIRMATION',
      'SHOW_CURRENT_PLAN',
      'SHOW_PLAN_STATUS',
      'GENERAL_GUIDANCE',
      'UNKNOWN'
    )
  ),
  CONSTRAINT "nutrition_shadow_runtime_decisions_state_check" CHECK (
    ("decision" = 'PENDING' AND "shadowRunId" IS NULL AND "skipReason" IS NULL)
    OR ("decision" = 'STARTED' AND "shadowRunId" IS NOT NULL AND "skipReason" IS NULL)
    OR ("decision" = 'SKIPPED' AND "shadowRunId" IS NULL AND "skipReason" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "nutrition_shadow_runtime_decisions_operationKey_key"
  ON "nutrition_shadow_runtime_decisions"("operationKey");
CREATE UNIQUE INDEX "nutrition_shadow_runtime_decisions_shadowRunId_key"
  ON "nutrition_shadow_runtime_decisions"("shadowRunId");
CREATE INDEX "nutrition_shadow_runtime_decisions_createdAt_idx"
  ON "nutrition_shadow_runtime_decisions"("createdAt");
CREATE INDEX "nutrition_shadow_runtime_decisions_goal_created_idx"
  ON "nutrition_shadow_runtime_decisions"("conversationGoal", "createdAt");
CREATE INDEX "nutrition_shadow_runtime_decisions_decision_createdAt_idx"
  ON "nutrition_shadow_runtime_decisions"("decision", "createdAt");
CREATE INDEX "nutrition_shadow_runtime_decisions_skipReason_createdAt_idx"
  ON "nutrition_shadow_runtime_decisions"("skipReason", "createdAt");
CREATE INDEX "nutrition_shadow_runtime_decisions_userId_createdAt_idx"
  ON "nutrition_shadow_runtime_decisions"("userId", "createdAt");
CREATE INDEX "nutrition_shadow_runtime_decisions_conversationId_createdAt_idx"
  ON "nutrition_shadow_runtime_decisions"("conversationId", "createdAt");
CREATE INDEX "nutrition_shadow_runtime_decisions_messageId_createdAt_idx"
  ON "nutrition_shadow_runtime_decisions"("messageId", "createdAt");

ALTER TABLE "nutrition_shadow_runtime_decisions"
  ADD CONSTRAINT "nutrition_shadow_runtime_decisions_shadowRunId_fkey"
  FOREIGN KEY ("shadowRunId") REFERENCES "nutrition_shadow_runs"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

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
    RAISE EXCEPTION 'NutritionShadowRuntimeDecision must become terminal';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "nutrition_shadow_runtime_decision_terminal_guard"
BEFORE UPDATE ON "nutrition_shadow_runtime_decisions"
FOR EACH ROW EXECUTE FUNCTION "protect_nutrition_shadow_runtime_decision"();
