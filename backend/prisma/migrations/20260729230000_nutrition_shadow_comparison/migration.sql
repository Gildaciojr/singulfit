CREATE TYPE "NutritionShadowComparisonDivergence" AS ENUM (
  'WRONG_ARTIFACT_TYPE', 'WRONG_KIND', 'MISSING_PLAN', 'EXTRA_PLAN',
  'MISSING_GUIDANCE', 'MISSING_MEAL_SUGGESTION', 'MISSING_REVIEW',
  'MISSING_PRESENTATION', 'GOAL_MISMATCH', 'OBJECTIVE_MISMATCH',
  'FOCUS_MISMATCH', 'CONTEXT_MISMATCH', 'RESTRICTION_MISMATCH',
  'CONTENT_DIVERGENCE', 'PERFORMANCE_REGRESSION', 'TOKEN_REGRESSION',
  'COST_REGRESSION', 'PROVIDER_DIFFERENCE', 'MODEL_DIFFERENCE', 'RETRY_REGRESSION',
  'PARSER_DIFFERENCE', 'VALIDATION_DIFFERENCE'
);

CREATE TABLE "nutrition_shadow_comparisons" (
  "id" TEXT NOT NULL,
  "operationKey" TEXT NOT NULL,
  "inputFingerprint" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  "shadowRunId" TEXT NOT NULL,
  "expectedArtifactType" "NutritionArtifactType" NOT NULL,
  "actualArtifactType" "NutritionArtifactType" NOT NULL,
  "expectedKind" "NutritionShadowOutputKind" NOT NULL,
  "actualKind" "NutritionShadowOutputKind" NOT NULL,
  "equivalent" BOOLEAN NOT NULL,
  "structuralScore" INTEGER NOT NULL,
  "semanticScore" INTEGER NOT NULL,
  "operationalScore" INTEGER NOT NULL,
  "overallScore" INTEGER NOT NULL,
  "divergences" "NutritionShadowComparisonDivergence"[] NOT NULL,
  "legacyDurationMs" INTEGER,
  "shadowDurationMs" INTEGER NOT NULL,
  "legacyTokens" INTEGER,
  "shadowTokens" INTEGER NOT NULL,
  "legacyCostUsd" DECIMAL(14,8),
  "shadowCostUsd" DECIMAL(14,8),
  "timeRatio" DECIMAL(14,8),
  "tokenRatio" DECIMAL(14,8),
  "costRatio" DECIMAL(14,8),
  "legacyProvider" TEXT,
  "shadowProvider" TEXT,
  "legacyModel" TEXT,
  "shadowModel" TEXT,
  "legacyHash" TEXT NOT NULL,
  "shadowHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "nutrition_shadow_comparisons_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "nutrition_shadow_comparisons_scores_check" CHECK (
    "structuralScore" BETWEEN 0 AND 100 AND "semanticScore" BETWEEN 0 AND 100
    AND "operationalScore" BETWEEN 0 AND 100 AND "overallScore" BETWEEN 0 AND 100
  ),
  CONSTRAINT "nutrition_shadow_comparisons_metrics_check" CHECK (
    COALESCE("legacyDurationMs", 0) >= 0 AND "shadowDurationMs" >= 0
    AND COALESCE("legacyTokens", 0) >= 0 AND "shadowTokens" >= 0
    AND COALESCE("legacyCostUsd", 0) >= 0 AND COALESCE("shadowCostUsd", 0) >= 0
    AND COALESCE("timeRatio", 0) >= 0 AND COALESCE("tokenRatio", 0) >= 0
    AND COALESCE("costRatio", 0) >= 0
  ),
  CONSTRAINT "nutrition_shadow_comparisons_equivalence_check" CHECK (
    ("equivalent" = TRUE AND "overallScore" = 100 AND cardinality("divergences") = 0)
    OR "equivalent" = FALSE
  )
);

CREATE UNIQUE INDEX "nutrition_shadow_comparisons_operationKey_key" ON "nutrition_shadow_comparisons"("operationKey");
CREATE INDEX "nutrition_shadow_comparisons_conversationId_createdAt_idx" ON "nutrition_shadow_comparisons"("conversationId", "createdAt");
CREATE INDEX "nutrition_shadow_comparisons_messageId_createdAt_idx" ON "nutrition_shadow_comparisons"("messageId", "createdAt");
CREATE INDEX "nutrition_shadow_comparisons_shadowRunId_idx" ON "nutrition_shadow_comparisons"("shadowRunId");
CREATE INDEX "nutrition_shadow_comparisons_equivalent_createdAt_idx" ON "nutrition_shadow_comparisons"("equivalent", "createdAt");
CREATE INDEX "nutrition_shadow_comparisons_overallScore_createdAt_idx" ON "nutrition_shadow_comparisons"("overallScore", "createdAt");

CREATE FUNCTION "prevent_nutrition_shadow_comparison_update"() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'NutritionShadowComparison is immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "nutrition_shadow_comparison_immutable"
BEFORE UPDATE ON "nutrition_shadow_comparisons"
FOR EACH ROW EXECUTE FUNCTION "prevent_nutrition_shadow_comparison_update"();
