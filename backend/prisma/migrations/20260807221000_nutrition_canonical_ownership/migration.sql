CREATE TYPE "NutritionPlanImplementation" AS ENUM ('LEGACY', 'V2');

CREATE TABLE "nutrition_plan_ownerships" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "profileId" TEXT NOT NULL,
  "implementation" "NutritionPlanImplementation" NOT NULL,
  "planId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "nutrition_plan_ownerships_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "nutrition_plan_ownerships_planId_not_empty_check"
    CHECK (length(btrim("planId")) > 0)
);

CREATE UNIQUE INDEX "nutrition_plan_ownerships_userId_key"
  ON "nutrition_plan_ownerships"("userId");
CREATE UNIQUE INDEX "nutrition_plan_ownerships_profileId_key"
  ON "nutrition_plan_ownerships"("profileId");
CREATE UNIQUE INDEX "nutrition_plan_ownerships_implementation_planId_key"
  ON "nutrition_plan_ownerships"("implementation", "planId");
CREATE INDEX "nutrition_plan_ownerships_implementation_updatedAt_idx"
  ON "nutrition_plan_ownerships"("implementation", "updatedAt");

ALTER TABLE "nutrition_plan_ownerships"
  ADD CONSTRAINT "nutrition_plan_ownerships_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "nutrition_plan_ownerships"
  ADD CONSTRAINT "nutrition_plan_ownerships_profileId_fkey"
  FOREIGN KEY ("profileId") REFERENCES "fitness_profiles"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Safe backfill: exactly one ACTIVE implementation and one ACTIVE aggregate.
-- Historical dual-active and duplicated-active scopes remain intentionally empty.
INSERT INTO "nutrition_plan_ownerships" (
  "id", "userId", "profileId", "implementation", "planId", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid()::text,
  legacy."userId",
  legacy."profileId",
  'LEGACY'::"NutritionPlanImplementation",
  legacy."id",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "diet_plans" legacy
WHERE legacy."status" = 'ACTIVE'
  AND (
    SELECT COUNT(*) FROM "diet_plans" candidate
    WHERE candidate."userId" = legacy."userId" AND candidate."status" = 'ACTIVE'
  ) = 1
  AND NOT EXISTS (
    SELECT 1 FROM "nutrition_plans_v2" candidate
    WHERE candidate."userId" = legacy."userId" AND candidate."status" = 'ACTIVE'
  );

INSERT INTO "nutrition_plan_ownerships" (
  "id", "userId", "profileId", "implementation", "planId", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid()::text,
  v2."userId",
  v2."profileId",
  'V2'::"NutritionPlanImplementation",
  v2."id",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "nutrition_plans_v2" v2
WHERE v2."status" = 'ACTIVE'
  AND (
    SELECT COUNT(*) FROM "nutrition_plans_v2" candidate
    WHERE candidate."userId" = v2."userId" AND candidate."status" = 'ACTIVE'
  ) = 1
  AND NOT EXISTS (
    SELECT 1 FROM "diet_plans" candidate
    WHERE candidate."userId" = v2."userId" AND candidate."status" = 'ACTIVE'
  )
  AND NOT EXISTS (
    SELECT 1 FROM "nutrition_plan_ownerships" ownership
    WHERE ownership."userId" = v2."userId"
  );
