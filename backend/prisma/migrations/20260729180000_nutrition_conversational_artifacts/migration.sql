-- CreateTable
ALTER TABLE "nutrition_plans_v2"
  ADD CONSTRAINT "nutrition_plans_v2_operational_artifact_check"
  CHECK ("artifactType" IN ('DAILY_STRUCTURE', 'WEEKLY_PLAN', 'PLAN_ADAPTATION', 'FOOD_SUBSTITUTION'));

CREATE TABLE "nutrition_conversational_artifacts" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "artifactType" "NutritionArtifactType" NOT NULL,
  "schemaVersion" TEXT NOT NULL,
  "document" JSONB NOT NULL,
  "aiJobId" TEXT NOT NULL,
  "operationKey" TEXT NOT NULL,
  "reviewedPlanId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "nutrition_conversational_artifacts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "nutrition_conversational_artifacts_type_check" CHECK ("artifactType" IN ('POINT_GUIDANCE', 'MEAL_SUGGESTION', 'PLAN_REVIEW')),
  CONSTRAINT "nutrition_conversational_artifacts_version_check" CHECK ("schemaVersion" = '1.0'),
  CONSTRAINT "nutrition_conversational_artifacts_review_reference_check" CHECK (("artifactType" = 'PLAN_REVIEW' AND "reviewedPlanId" IS NOT NULL) OR ("artifactType" IN ('POINT_GUIDANCE', 'MEAL_SUGGESTION') AND "reviewedPlanId" IS NULL)),
  CONSTRAINT "nutrition_conversational_artifacts_document_check" CHECK (COALESCE(jsonb_typeof("document") = 'object' AND "document" ->> 'schemaVersion' = "schemaVersion" AND "document" ->> 'artifactType' = "artifactType"::TEXT AND jsonb_typeof("document" -> 'title') = 'string' AND length(btrim("document" ->> 'title')) > 0 AND jsonb_typeof("document" -> 'summary') = 'string' AND length(btrim("document" ->> 'summary')) > 0 AND jsonb_typeof("document" -> 'generatedAt') = 'string', FALSE)),
  CONSTRAINT "nutrition_conversational_artifacts_review_document_check" CHECK (COALESCE(("artifactType" <> 'PLAN_REVIEW' AND NOT ("document" ? 'reviewedPlanId')) OR ("artifactType" = 'PLAN_REVIEW' AND "document" ->> 'reviewedPlanId' = "reviewedPlanId"), FALSE))
);

CREATE UNIQUE INDEX "nutrition_conversational_artifacts_aiJobId_key" ON "nutrition_conversational_artifacts"("aiJobId");
CREATE UNIQUE INDEX "nutrition_conversational_artifacts_operationKey_key" ON "nutrition_conversational_artifacts"("operationKey");
CREATE INDEX "nutrition_conversational_artifacts_userId_artifactType_createdAt_idx" ON "nutrition_conversational_artifacts"("userId", "artifactType", "createdAt");
CREATE INDEX "nutrition_conversational_artifacts_reviewedPlanId_idx" ON "nutrition_conversational_artifacts"("reviewedPlanId");

ALTER TABLE "nutrition_conversational_artifacts" ADD CONSTRAINT "nutrition_conversational_artifacts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "nutrition_conversational_artifacts" ADD CONSTRAINT "nutrition_conversational_artifacts_aiJobId_fkey" FOREIGN KEY ("aiJobId") REFERENCES "ai_jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "nutrition_conversational_artifacts" ADD CONSTRAINT "nutrition_conversational_artifacts_reviewedPlanId_fkey" FOREIGN KEY ("reviewedPlanId") REFERENCES "nutrition_plans_v2"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "prevent_nutrition_conversational_artifact_update"() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'NutritionConversationalArtifact canonical data is immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "nutrition_conversational_artifact_immutable" BEFORE UPDATE ON "nutrition_conversational_artifacts" FOR EACH ROW EXECUTE FUNCTION "prevent_nutrition_conversational_artifact_update"();
