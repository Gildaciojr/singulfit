-- CreateEnum
CREATE TYPE "NutritionArtifactType" AS ENUM (
  'POINT_GUIDANCE',
  'MEAL_SUGGESTION',
  'DAILY_STRUCTURE',
  'WEEKLY_PLAN',
  'PLAN_REVIEW',
  'PLAN_ADAPTATION',
  'FOOD_SUBSTITUTION',
  'CURRENT_PLAN_PRESENTATION'
);

-- CreateEnum
CREATE TYPE "NutritionPlanLifecycleReason" AS ENUM (
  'CREATION',
  'REPLACEMENT',
  'ADAPTATION',
  'REVIEW',
  'REACTIVATION'
);

-- CreateEnum
CREATE TYPE "NutritionPlanStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateTable
CREATE TABLE "nutrition_plans_v2" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "profileId" TEXT NOT NULL,
  "aiJobId" TEXT NOT NULL,
  "schemaVersion" INTEGER NOT NULL,
  "engineVersion" INTEGER NOT NULL,
  "artifactType" "NutritionArtifactType" NOT NULL,
  "lifecycleReason" "NutritionPlanLifecycleReason" NOT NULL,
  "replacesPlanReference" TEXT,
  "status" "NutritionPlanStatus" NOT NULL DEFAULT 'ACTIVE',
  "document" JSONB NOT NULL,
  "generatedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "nutrition_plans_v2_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "nutrition_plans_v2_supported_versions_check"
    CHECK ("schemaVersion" = 2 AND "engineVersion" = 2),
  CONSTRAINT "nutrition_plans_v2_document_shape_check"
    CHECK (COALESCE((
      jsonb_typeof("document") = 'object'
      AND jsonb_typeof("document" -> 'schemaVersion') = 'number'
      AND ("document" ->> 'schemaVersion')::INTEGER = "schemaVersion"
      AND jsonb_typeof("document" -> 'artifactType') = 'string'
      AND "document" ->> 'artifactType' = "artifactType"::TEXT
      AND jsonb_typeof("document" -> 'lifecycleReason') = 'string'
      AND "document" ->> 'lifecycleReason' = "lifecycleReason"::TEXT
      AND jsonb_typeof("document" -> 'title') = 'string'
      AND length(btrim("document" ->> 'title')) > 0
      AND jsonb_typeof("document" -> 'objectiveSummary') = 'string'
      AND jsonb_typeof("document" -> 'strategy') = 'object'
      AND jsonb_typeof("document" -> 'guidance') = 'array'
      AND jsonb_typeof("document" -> 'days') = 'array'
      AND jsonb_typeof("document" -> 'substitutions') = 'array'
      AND jsonb_typeof("document" -> 'adaptationRules') = 'array'
      AND jsonb_typeof("document" -> 'hydrationGuidance') = 'array'
      AND jsonb_typeof("document" -> 'safetyNotes') = 'array'
      AND jsonb_typeof("document" -> 'generation') = 'object'
      AND jsonb_typeof("document" -> 'validation') = 'object'
    ), FALSE)),
  CONSTRAINT "nutrition_plans_v2_generation_metadata_check"
    CHECK (COALESCE((
      jsonb_typeof("document" #> '{generation,engineVersion}') = 'number'
      AND ("document" #>> '{generation,engineVersion}')::INTEGER = "engineVersion"
      AND jsonb_typeof("document" #> '{generation,promptVersionId}') = 'string'
      AND length(btrim("document" #>> '{generation,promptVersionId}')) > 0
      AND jsonb_typeof("document" #> '{generation,aiJobId}') = 'string'
      AND "document" #>> '{generation,aiJobId}' = "aiJobId"::TEXT
      AND jsonb_typeof("document" #> '{generation,operationKey}') = 'string'
      AND length(btrim("document" #>> '{generation,operationKey}')) > 0
      AND jsonb_typeof("document" #> '{generation,model}') = 'string'
      AND length(btrim("document" #>> '{generation,model}')) > 0
      AND jsonb_typeof("document" #> '{generation,generatedAt}') = 'string'
      AND ("document" #>> '{generation,generatedAt}')::TIMESTAMPTZ = "generatedAt"
      AND jsonb_typeof("document" #> '{generation,reused}') = 'boolean'
    ), FALSE)),
  CONSTRAINT "nutrition_plans_v2_lineage_check"
    CHECK (COALESCE((
      (
        "replacesPlanReference" IS NULL
        AND "document" -> 'replacesPlanReference' = 'null'::JSONB
      )
      OR (
        "replacesPlanReference" IS NOT NULL
        AND jsonb_typeof("document" -> 'replacesPlanReference') = 'string'
        AND "document" ->> 'replacesPlanReference' = "replacesPlanReference"
      )
    ), FALSE))
);

-- CreateIndex
CREATE UNIQUE INDEX "nutrition_plans_v2_aiJobId_key"
  ON "nutrition_plans_v2"("aiJobId");

-- CreateIndex
CREATE INDEX "nutrition_plans_v2_userId_status_generatedAt_idx"
  ON "nutrition_plans_v2"("userId", "status", "generatedAt");

-- CreateIndex
CREATE INDEX "nutrition_plans_v2_profileId_generatedAt_idx"
  ON "nutrition_plans_v2"("profileId", "generatedAt");

-- CreateIndex
CREATE INDEX "nutrition_plans_v2_userId_artifactType_generatedAt_idx"
  ON "nutrition_plans_v2"("userId", "artifactType", "generatedAt");

-- CreateIndex
CREATE INDEX "nutrition_plans_v2_replacesPlanReference_idx"
  ON "nutrition_plans_v2"("replacesPlanReference");

-- Only one V2 plan may be operationally active for a user.
CREATE UNIQUE INDEX "nutrition_plans_v2_one_active_user_key"
  ON "nutrition_plans_v2"("userId")
  WHERE "status" = 'ACTIVE';

-- AddForeignKey
ALTER TABLE "nutrition_plans_v2"
  ADD CONSTRAINT "nutrition_plans_v2_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nutrition_plans_v2"
  ADD CONSTRAINT "nutrition_plans_v2_profileId_fkey"
  FOREIGN KEY ("profileId") REFERENCES "fitness_profiles"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nutrition_plans_v2"
  ADD CONSTRAINT "nutrition_plans_v2_aiJobId_fkey"
  FOREIGN KEY ("aiJobId") REFERENCES "ai_jobs"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- The canonical V2 document and its identity/generation metadata are immutable.
CREATE FUNCTION "prevent_nutrition_plan_v2_canonical_update"()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."userId" IS DISTINCT FROM OLD."userId"
    OR NEW."profileId" IS DISTINCT FROM OLD."profileId"
    OR NEW."aiJobId" IS DISTINCT FROM OLD."aiJobId"
    OR NEW."schemaVersion" IS DISTINCT FROM OLD."schemaVersion"
    OR NEW."engineVersion" IS DISTINCT FROM OLD."engineVersion"
    OR NEW."artifactType" IS DISTINCT FROM OLD."artifactType"
    OR NEW."lifecycleReason" IS DISTINCT FROM OLD."lifecycleReason"
    OR NEW."replacesPlanReference" IS DISTINCT FROM OLD."replacesPlanReference"
    OR NEW."document" IS DISTINCT FROM OLD."document"
    OR NEW."generatedAt" IS DISTINCT FROM OLD."generatedAt"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
  THEN
    RAISE EXCEPTION 'NutritionPlanV2 canonical data is immutable';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "nutrition_plans_v2_canonical_immutable"
BEFORE UPDATE ON "nutrition_plans_v2"
FOR EACH ROW
EXECUTE FUNCTION "prevent_nutrition_plan_v2_canonical_update"();
