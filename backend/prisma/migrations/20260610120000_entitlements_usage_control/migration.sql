CREATE TYPE "UsageEventStatus" AS ENUM ('RESERVED', 'CONFIRMED', 'REVERSED');

ALTER TYPE "ResponseType" ADD VALUE 'USAGE_LIMIT';

ALTER TABLE "outbound_messages"
  ALTER COLUMN "mealAnalysisId" DROP NOT NULL;

CREATE TABLE "entitlement_definitions" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "entitlement_definitions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "plan_entitlements" (
  "id" TEXT NOT NULL,
  "planId" TEXT NOT NULL,
  "entitlementId" TEXT NOT NULL,
  "value" INTEGER NOT NULL,
  CONSTRAINT "plan_entitlements_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "usage_buckets" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "entitlementCode" TEXT NOT NULL,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd" TIMESTAMP(3) NOT NULL,
  "used" INTEGER NOT NULL DEFAULT 0,
  "reserved" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "usage_buckets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "usage_events" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "aiJobId" TEXT NOT NULL,
  "entitlementCode" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "status" "UsageEventStatus" NOT NULL DEFAULT 'RESERVED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "usage_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "entitlement_definitions_code_key"
ON "entitlement_definitions"("code");

CREATE UNIQUE INDEX "plan_entitlements_planId_entitlementId_key"
ON "plan_entitlements"("planId", "entitlementId");

CREATE INDEX "plan_entitlements_entitlementId_idx"
ON "plan_entitlements"("entitlementId");

CREATE UNIQUE INDEX "usage_buckets_userId_entitlementCode_periodStart_periodEnd_key"
ON "usage_buckets"("userId", "entitlementCode", "periodStart", "periodEnd");

CREATE INDEX "usage_buckets_userId_entitlementCode_periodEnd_idx"
ON "usage_buckets"("userId", "entitlementCode", "periodEnd");

CREATE INDEX "usage_buckets_periodEnd_idx"
ON "usage_buckets"("periodEnd");

CREATE UNIQUE INDEX "usage_events_aiJobId_entitlementCode_key"
ON "usage_events"("aiJobId", "entitlementCode");

CREATE INDEX "usage_events_userId_entitlementCode_status_createdAt_idx"
ON "usage_events"("userId", "entitlementCode", "status", "createdAt");

CREATE INDEX "usage_events_aiJobId_status_idx"
ON "usage_events"("aiJobId", "status");

ALTER TABLE "plan_entitlements"
ADD CONSTRAINT "plan_entitlements_planId_fkey"
FOREIGN KEY ("planId") REFERENCES "plans"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "plan_entitlements"
ADD CONSTRAINT "plan_entitlements_entitlementId_fkey"
FOREIGN KEY ("entitlementId") REFERENCES "entitlement_definitions"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "usage_buckets"
ADD CONSTRAINT "usage_buckets_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "usage_buckets"
ADD CONSTRAINT "usage_buckets_entitlementCode_fkey"
FOREIGN KEY ("entitlementCode") REFERENCES "entitlement_definitions"("code")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "usage_events"
ADD CONSTRAINT "usage_events_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "usage_events"
ADD CONSTRAINT "usage_events_aiJobId_fkey"
FOREIGN KEY ("aiJobId") REFERENCES "ai_jobs"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "usage_events"
ADD CONSTRAINT "usage_events_entitlementCode_fkey"
FOREIGN KEY ("entitlementCode") REFERENCES "entitlement_definitions"("code")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "plan_entitlements"
ADD CONSTRAINT "plan_entitlements_value_check" CHECK ("value" >= 0);

ALTER TABLE "usage_buckets"
ADD CONSTRAINT "usage_buckets_values_check"
CHECK (
  "used" >= 0
  AND "reserved" >= 0
  AND "periodEnd" > "periodStart"
);

ALTER TABLE "usage_events"
ADD CONSTRAINT "usage_events_quantity_check" CHECK ("quantity" > 0);

INSERT INTO "entitlement_definitions" (
  "id",
  "code",
  "name",
  "description",
  "createdAt"
)
VALUES
  (
    'a71e3215-a90d-4f5d-9554-7e5d3f63c101',
    'IMAGE_ANALYSIS_DAILY',
    'Análises de imagem por dia',
    'Quantidade máxima diária de análises nutricionais por imagem.',
    CURRENT_TIMESTAMP
  ),
  (
    'a71e3215-a90d-4f5d-9554-7e5d3f63c102',
    'IMAGE_ANALYSIS_MONTHLY',
    'Análises de imagem por mês',
    'Quantidade máxima mensal de análises nutricionais por imagem.',
    CURRENT_TIMESTAMP
  )
ON CONFLICT ("code") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description";

INSERT INTO "plan_entitlements" (
  "id",
  "planId",
  "entitlementId",
  "value"
)
SELECT
  md5(p."id" || ':' || e."id"),
  p."id",
  e."id",
  CASE
    WHEN p."type" = 'BASIC' AND e."code" = 'IMAGE_ANALYSIS_DAILY' THEN 5
    WHEN p."type" = 'BASIC' AND e."code" = 'IMAGE_ANALYSIS_MONTHLY' THEN 100
    WHEN p."type" = 'PREMIUM' AND e."code" = 'IMAGE_ANALYSIS_DAILY' THEN 50
    WHEN p."type" = 'PREMIUM' AND e."code" = 'IMAGE_ANALYSIS_MONTHLY' THEN 1500
  END
FROM "plans" p
CROSS JOIN "entitlement_definitions" e
WHERE
  p."type" IN ('BASIC', 'PREMIUM')
  AND e."code" IN ('IMAGE_ANALYSIS_DAILY', 'IMAGE_ANALYSIS_MONTHLY')
ON CONFLICT ("planId", "entitlementId") DO UPDATE SET
  "value" = EXCLUDED."value";
