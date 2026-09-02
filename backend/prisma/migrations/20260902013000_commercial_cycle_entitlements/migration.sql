ALTER TABLE "plans"
ADD COLUMN "imageUnlimited" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "plan_entitlements"
ADD COLUMN "unlimited" BOOLEAN NOT NULL DEFAULT false;

INSERT INTO "entitlement_definitions" (
  "id",
  "code",
  "name",
  "description",
  "createdAt"
)
VALUES
  (
    'b82f4326-ba1e-4a6e-a665-8f6e4a74d201',
    'NUTRITION_PLAN_GENERATION',
    'Geração de plano alimentar por ciclo',
    'Quantidade de novos planos alimentares por ciclo da assinatura.',
    CURRENT_TIMESTAMP
  ),
  (
    'b82f4326-ba1e-4a6e-a665-8f6e4a74d202',
    'WORKOUT_PLAN_GENERATION',
    'Geração de plano de treino por ciclo',
    'Quantidade de novos planos de treino por ciclo da assinatura.',
    CURRENT_TIMESTAMP
  ),
  (
    'b82f4326-ba1e-4a6e-a665-8f6e4a74d203',
    'IMAGE_ANALYSIS',
    'Análises de alimentos e bebidas por ciclo',
    'Quantidade de análises de alimentos e bebidas por ciclo da assinatura.',
    CURRENT_TIMESTAMP
  )
ON CONFLICT ("code") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description";

INSERT INTO "plan_entitlements" (
  "id",
  "planId",
  "entitlementId",
  "value",
  "unlimited"
)
SELECT
  md5(p."id" || ':' || e."id"),
  p."id",
  e."id",
  CASE
    WHEN e."code" = 'IMAGE_ANALYSIS' THEN 5
    ELSE 1
  END,
  p."type" = 'PREMIUM'
FROM "plans" p
CROSS JOIN "entitlement_definitions" e
WHERE
  p."type" IN ('BASIC', 'PREMIUM')
  AND e."code" IN (
    'NUTRITION_PLAN_GENERATION',
    'WORKOUT_PLAN_GENERATION',
    'IMAGE_ANALYSIS'
  )
ON CONFLICT ("planId", "entitlementId") DO UPDATE SET
  "value" = EXCLUDED."value",
  "unlimited" = EXCLUDED."unlimited";

UPDATE "plans"
SET
  "price" = CASE
    WHEN "type" = 'BASIC' THEN 29.90
    WHEN "type" = 'PREMIUM' THEN 69.90
    ELSE "price"
  END,
  "imageLimit" = CASE
    WHEN "type" = 'BASIC' THEN 5
    WHEN "type" = 'PREMIUM' THEN 0
    ELSE "imageLimit"
  END,
  "imageUnlimited" = CASE
    WHEN "type" = 'PREMIUM' THEN true
    ELSE false
  END
WHERE "type" IN ('BASIC', 'PREMIUM');

-- Preserve consumption already completed in the subscription cycle that is
-- active when this entitlement model is introduced. Failed jobs, profile
-- clarifications and read-only artifacts are deliberately excluded.
WITH historical_usage AS (
  SELECT
    dp."userId",
    dp."aiJobId",
    'NUTRITION_PLAN_GENERATION'::TEXT AS "entitlementCode",
    dp."generatedAt" AS "occurredAt"
  FROM "diet_plans" dp
  JOIN "ai_jobs" aj ON aj."id" = dp."aiJobId"
  WHERE aj."status" = 'COMPLETED'

  UNION ALL

  SELECT
    np."userId",
    np."aiJobId",
    'NUTRITION_PLAN_GENERATION'::TEXT AS "entitlementCode",
    np."generatedAt" AS "occurredAt"
  FROM "nutrition_plans_v2" np
  JOIN "ai_jobs" aj ON aj."id" = np."aiJobId"
  WHERE
    aj."status" = 'COMPLETED'
    AND np."lifecycleReason" IN ('CREATION', 'REPLACEMENT')

  UNION ALL

  SELECT
    wp."userId",
    wp."aiJobId",
    'WORKOUT_PLAN_GENERATION'::TEXT AS "entitlementCode",
    wp."generatedAt" AS "occurredAt"
  FROM "workout_plans" wp
  JOIN "ai_jobs" aj ON aj."id" = wp."aiJobId"
  WHERE
    wp."aiJobId" IS NOT NULL
    AND aj."status" = 'COMPLETED'
    AND COALESCE(
      aj."result" #>> '{acceptedOutput,lifecycleReason}',
      'CREATION'
    ) IN ('CREATION', 'REPLACEMENT')

  UNION ALL

  SELECT
    m."userId",
    ma."aiJobId",
    'IMAGE_ANALYSIS'::TEXT AS "entitlementCode",
    ma."updatedAt" AS "occurredAt"
  FROM "meal_analyses" ma
  JOIN "meals" m ON m."id" = ma."mealId"
  JOIN "ai_jobs" aj ON aj."id" = ma."aiJobId"
  WHERE
    ma."aiJobId" IS NOT NULL
    AND ma."status" = 'COMPLETED'
    AND aj."status" = 'COMPLETED'
), cycle_usage AS (
  SELECT DISTINCT ON (usage."aiJobId", usage."entitlementCode")
    usage."userId",
    usage."aiJobId",
    usage."entitlementCode",
    usage."occurredAt",
    cycle."currentPeriodStart" AS "periodStart",
    cycle."currentPeriodEnd" AS "periodEnd"
  FROM historical_usage usage
  CROSS JOIN LATERAL (
    SELECT
      subscription."currentPeriodStart",
      subscription."currentPeriodEnd"
    FROM "subscriptions" subscription
    WHERE
      subscription."userId" = usage."userId"
      AND subscription."status" IN ('ACTIVE', 'PAST_DUE')
      AND subscription."currentPeriodStart" IS NOT NULL
      AND subscription."currentPeriodEnd" IS NOT NULL
      AND usage."occurredAt" >= subscription."currentPeriodStart"
      AND usage."occurredAt" < subscription."currentPeriodEnd"
    ORDER BY subscription."updatedAt" DESC
    LIMIT 1
  ) cycle
  ORDER BY usage."aiJobId", usage."entitlementCode", usage."occurredAt" DESC
)
INSERT INTO "usage_buckets" (
  "id",
  "userId",
  "entitlementCode",
  "periodStart",
  "periodEnd",
  "used",
  "reserved",
  "createdAt",
  "updatedAt"
)
SELECT
  md5(
    "userId" || ':' || "entitlementCode" || ':' ||
    "periodStart"::TEXT || ':' || "periodEnd"::TEXT
  ),
  "userId",
  "entitlementCode",
  "periodStart",
  "periodEnd",
  COUNT(*)::INTEGER,
  0,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM cycle_usage
GROUP BY "userId", "entitlementCode", "periodStart", "periodEnd"
ON CONFLICT ("userId", "entitlementCode", "periodStart", "periodEnd")
DO UPDATE SET
  "used" = GREATEST("usage_buckets"."used", EXCLUDED."used"),
  "updatedAt" = CURRENT_TIMESTAMP;

WITH historical_usage AS (
  SELECT dp."userId", dp."aiJobId", 'NUTRITION_PLAN_GENERATION'::TEXT AS "entitlementCode", dp."generatedAt" AS "occurredAt"
  FROM "diet_plans" dp
  JOIN "ai_jobs" aj ON aj."id" = dp."aiJobId"
  WHERE aj."status" = 'COMPLETED'

  UNION ALL

  SELECT np."userId", np."aiJobId", 'NUTRITION_PLAN_GENERATION'::TEXT, np."generatedAt"
  FROM "nutrition_plans_v2" np
  JOIN "ai_jobs" aj ON aj."id" = np."aiJobId"
  WHERE aj."status" = 'COMPLETED' AND np."lifecycleReason" IN ('CREATION', 'REPLACEMENT')

  UNION ALL

  SELECT wp."userId", wp."aiJobId", 'WORKOUT_PLAN_GENERATION'::TEXT, wp."generatedAt"
  FROM "workout_plans" wp
  JOIN "ai_jobs" aj ON aj."id" = wp."aiJobId"
  WHERE
    wp."aiJobId" IS NOT NULL
    AND aj."status" = 'COMPLETED'
    AND COALESCE(aj."result" #>> '{acceptedOutput,lifecycleReason}', 'CREATION') IN ('CREATION', 'REPLACEMENT')

  UNION ALL

  SELECT m."userId", ma."aiJobId", 'IMAGE_ANALYSIS'::TEXT, ma."updatedAt"
  FROM "meal_analyses" ma
  JOIN "meals" m ON m."id" = ma."mealId"
  JOIN "ai_jobs" aj ON aj."id" = ma."aiJobId"
  WHERE ma."aiJobId" IS NOT NULL AND ma."status" = 'COMPLETED' AND aj."status" = 'COMPLETED'
), cycle_usage AS (
  SELECT DISTINCT ON (usage."aiJobId", usage."entitlementCode") usage.*
  FROM historical_usage usage
  WHERE EXISTS (
    SELECT 1
    FROM "subscriptions" subscription
    WHERE
      subscription."userId" = usage."userId"
      AND subscription."status" IN ('ACTIVE', 'PAST_DUE')
      AND subscription."currentPeriodStart" IS NOT NULL
      AND subscription."currentPeriodEnd" IS NOT NULL
      AND usage."occurredAt" >= subscription."currentPeriodStart"
      AND usage."occurredAt" < subscription."currentPeriodEnd"
  )
  ORDER BY usage."aiJobId", usage."entitlementCode", usage."occurredAt" DESC
)
INSERT INTO "usage_events" (
  "id",
  "userId",
  "aiJobId",
  "entitlementCode",
  "quantity",
  "status",
  "expiresAt",
  "createdAt",
  "updatedAt"
)
SELECT
  md5("aiJobId" || ':' || "entitlementCode"),
  "userId",
  "aiJobId",
  "entitlementCode",
  1,
  'CONFIRMED',
  NULL,
  "occurredAt",
  CURRENT_TIMESTAMP
FROM cycle_usage
ON CONFLICT ("aiJobId", "entitlementCode") DO NOTHING;
