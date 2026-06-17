CREATE TYPE "MealAnalysisStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');
CREATE TYPE "MealSource" AS ENUM ('WHATSAPP', 'UPLOAD');

ALTER TABLE "meals"
  ALTER COLUMN "imageUrl" DROP NOT NULL,
  ADD COLUMN "conversationId" TEXT,
  ADD COLUMN "messageId" TEXT,
  ADD COLUMN "mediaFileId" TEXT,
  ADD COLUMN "source" "MealSource" NOT NULL DEFAULT 'UPLOAD';

ALTER TABLE "meal_analyses"
  RENAME COLUMN "calories" TO "totalCalories";

ALTER TABLE "meal_analyses"
  RENAME COLUMN "protein" TO "totalProtein";

ALTER TABLE "meal_analyses"
  RENAME COLUMN "carbs" TO "totalCarbs";

ALTER TABLE "meal_analyses"
  RENAME COLUMN "fat" TO "totalFat";

ALTER TABLE "meal_analyses"
  ALTER COLUMN "totalCalories" TYPE DECIMAL(10, 2) USING "totalCalories"::DECIMAL(10, 2),
  ALTER COLUMN "totalProtein" TYPE DECIMAL(10, 2) USING "totalProtein"::DECIMAL(10, 2),
  ALTER COLUMN "totalCarbs" TYPE DECIMAL(10, 2) USING "totalCarbs"::DECIMAL(10, 2),
  ALTER COLUMN "totalFat" TYPE DECIMAL(10, 2) USING "totalFat"::DECIMAL(10, 2),
  ADD COLUMN "aiJobId" TEXT,
  ADD COLUMN "status" "MealAnalysisStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "confidence" DECIMAL(5, 4),
  ADD COLUMN "rawResponse" JSONB,
  ADD COLUMN "error" TEXT;

UPDATE "meal_analyses"
SET
  "status" = 'COMPLETED',
  "confidence" = 0,
  "totalCalories" = COALESCE("totalCalories", 0),
  "totalProtein" = COALESCE("totalProtein", 0),
  "totalCarbs" = COALESCE("totalCarbs", 0),
  "totalFat" = COALESCE("totalFat", 0),
  "rawResponse" = jsonb_build_object(
    'migratedFromLegacy', true,
    'foods', jsonb_build_array(),
    'totalCalories', COALESCE("totalCalories", 0),
    'protein', COALESCE("totalProtein", 0),
    'carbs', COALESCE("totalCarbs", 0),
    'fat', COALESCE("totalFat", 0),
    'confidence', 0
  )
WHERE
  "totalCalories" IS NOT NULL
  OR "totalProtein" IS NOT NULL
  OR "totalCarbs" IS NOT NULL
  OR "totalFat" IS NOT NULL;

CREATE TABLE "meal_items" (
  "id" TEXT NOT NULL,
  "mealAnalysisId" TEXT NOT NULL,
  "foodName" TEXT NOT NULL,
  "estimatedGrams" DECIMAL(10, 2) NOT NULL,
  "calories" DECIMAL(10, 2) NOT NULL,
  "protein" DECIMAL(10, 2) NOT NULL,
  "carbs" DECIMAL(10, 2) NOT NULL,
  "fat" DECIMAL(10, 2) NOT NULL,
  CONSTRAINT "meal_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "meals_messageId_key" ON "meals"("messageId");
CREATE UNIQUE INDEX "meals_mediaFileId_key" ON "meals"("mediaFileId");
CREATE INDEX "meals_conversationId_createdAt_idx" ON "meals"("conversationId", "createdAt");
CREATE INDEX "meals_source_createdAt_idx" ON "meals"("source", "createdAt");
CREATE UNIQUE INDEX "meal_analyses_aiJobId_key" ON "meal_analyses"("aiJobId");
CREATE INDEX "meal_analyses_status_createdAt_idx" ON "meal_analyses"("status", "createdAt");
CREATE INDEX "meal_items_mealAnalysisId_idx" ON "meal_items"("mealAnalysisId");

ALTER TABLE "meals"
  ADD CONSTRAINT "meals_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "conversations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "meals"
  ADD CONSTRAINT "meals_messageId_fkey"
  FOREIGN KEY ("messageId") REFERENCES "messages"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "meals"
  ADD CONSTRAINT "meals_mediaFileId_fkey"
  FOREIGN KEY ("mediaFileId") REFERENCES "media_files"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "meal_analyses"
  ADD CONSTRAINT "meal_analyses_aiJobId_fkey"
  FOREIGN KEY ("aiJobId") REFERENCES "ai_jobs"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "meal_items"
  ADD CONSTRAINT "meal_items_mealAnalysisId_fkey"
  FOREIGN KEY ("mealAnalysisId") REFERENCES "meal_analyses"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "meals"
  ADD CONSTRAINT "meals_whatsapp_links_check"
  CHECK (
    "source" <> 'WHATSAPP'
    OR (
      "conversationId" IS NOT NULL
      AND "messageId" IS NOT NULL
      AND "mediaFileId" IS NOT NULL
    )
  );

ALTER TABLE "meal_analyses"
  ADD CONSTRAINT "meal_analyses_confidence_check"
  CHECK ("confidence" IS NULL OR ("confidence" >= 0 AND "confidence" <= 1)),
  ADD CONSTRAINT "meal_analyses_totals_check"
  CHECK (
    ("totalCalories" IS NULL OR "totalCalories" >= 0)
    AND ("totalProtein" IS NULL OR "totalProtein" >= 0)
    AND ("totalCarbs" IS NULL OR "totalCarbs" >= 0)
    AND ("totalFat" IS NULL OR "totalFat" >= 0)
  ),
  ADD CONSTRAINT "meal_analyses_lifecycle_check"
  CHECK (
    (
      "status" IN ('PENDING', 'PROCESSING')
      AND "confidence" IS NULL
      AND "totalCalories" IS NULL
      AND "totalProtein" IS NULL
      AND "totalCarbs" IS NULL
      AND "totalFat" IS NULL
      AND "rawResponse" IS NULL
      AND "error" IS NULL
    )
    OR (
      "status" = 'COMPLETED'
      AND "confidence" IS NOT NULL
      AND "totalCalories" IS NOT NULL
      AND "totalProtein" IS NOT NULL
      AND "totalCarbs" IS NOT NULL
      AND "totalFat" IS NOT NULL
      AND "rawResponse" IS NOT NULL
      AND "error" IS NULL
    )
    OR (
      "status" = 'FAILED'
      AND "error" IS NOT NULL
    )
  );

ALTER TABLE "meal_items"
  ADD CONSTRAINT "meal_items_food_name_check"
  CHECK (length(btrim("foodName")) > 0),
  ADD CONSTRAINT "meal_items_values_check"
  CHECK (
    "estimatedGrams" >= 0
    AND "calories" >= 0
    AND "protein" >= 0
    AND "carbs" >= 0
    AND "fat" >= 0
  );

UPDATE "prompt_versions"
SET "isActive" = false
WHERE "name" = 'nutrition_vision_brazilian_meal' AND "isActive" = true;

INSERT INTO "prompt_versions" (
  "id",
  "name",
  "version",
  "prompt",
  "isActive",
  "createdAt"
)
VALUES (
  '7f1d3b40-5f56-4a2a-9b91-0e5de318c901',
  'nutrition_vision_brazilian_meal',
  1,
  'Voce e um assistente de estimativa nutricional visual. Analise somente alimentos e bebidas visiveis na imagem. Considere refeicoes brasileiras, pratos mistos, acompanhamentos, molhos, bebidas e porcoes. Para cada item, estime nome, gramas, calorias, proteinas, carboidratos e gorduras. Some os totais de forma coerente e informe confidence entre 0 e 1. Quando houver incerteza visual, use estimativas conservadoras e reduza confidence. Nao invente itens ocultos. Nao forneca diagnostico, prescricao, dieta ou aconselhamento medico. Retorne somente o JSON exigido pelo schema.',
  true,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("name", "version")
DO UPDATE SET
  "prompt" = EXCLUDED."prompt",
  "isActive" = true;
