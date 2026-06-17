ALTER TYPE "AIJobType" ADD VALUE 'DIET';

CREATE TYPE "DietPlanStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

ALTER TABLE "ai_jobs"
  ALTER COLUMN "conversationId" DROP NOT NULL,
  ALTER COLUMN "messageId" DROP NOT NULL;

ALTER TABLE "ai_jobs"
  ADD CONSTRAINT "ai_jobs_context_check"
  CHECK (
    (
      "type"::text = 'DIET'
      AND "conversationId" IS NULL
      AND "messageId" IS NULL
    )
    OR (
      "type"::text <> 'DIET'
      AND "conversationId" IS NOT NULL
      AND "messageId" IS NOT NULL
    )
  );

CREATE TABLE "diet_plans" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "profileId" TEXT NOT NULL,
  "aiJobId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "objective" "FitnessGoal" NOT NULL,
  "dailyCaloriesTarget" DECIMAL(8, 2) NOT NULL,
  "proteinTarget" DECIMAL(8, 2) NOT NULL,
  "carbsTarget" DECIMAL(8, 2) NOT NULL,
  "fatTarget" DECIMAL(8, 2) NOT NULL,
  "status" "DietPlanStatus" NOT NULL DEFAULT 'ACTIVE',
  "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "diet_plans_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "diet_meals" (
  "id" TEXT NOT NULL,
  "dietPlanId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "order" INTEGER NOT NULL,
  "caloriesTarget" DECIMAL(8, 2) NOT NULL,
  "notes" TEXT,
  CONSTRAINT "diet_meals_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "diet_meal_items" (
  "id" TEXT NOT NULL,
  "dietMealId" TEXT NOT NULL,
  "foodName" TEXT NOT NULL,
  "quantity" TEXT NOT NULL,
  "calories" DECIMAL(8, 2) NOT NULL,
  "protein" DECIMAL(8, 2) NOT NULL,
  "carbs" DECIMAL(8, 2) NOT NULL,
  "fat" DECIMAL(8, 2) NOT NULL,
  "substitutionGroup" TEXT,
  CONSTRAINT "diet_meal_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "diet_plans_aiJobId_key"
ON "diet_plans"("aiJobId");

CREATE UNIQUE INDEX "diet_plans_one_active_user_key"
ON "diet_plans"("userId")
WHERE "status" = 'ACTIVE';

CREATE INDEX "diet_plans_userId_status_generatedAt_idx"
ON "diet_plans"("userId", "status", "generatedAt");

CREATE INDEX "diet_plans_profileId_generatedAt_idx"
ON "diet_plans"("profileId", "generatedAt");

CREATE UNIQUE INDEX "diet_meals_dietPlanId_order_key"
ON "diet_meals"("dietPlanId", "order");

CREATE INDEX "diet_meals_dietPlanId_idx"
ON "diet_meals"("dietPlanId");

CREATE INDEX "diet_meal_items_dietMealId_idx"
ON "diet_meal_items"("dietMealId");

ALTER TABLE "diet_plans"
ADD CONSTRAINT "diet_plans_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "diet_plans"
ADD CONSTRAINT "diet_plans_profileId_fkey"
FOREIGN KEY ("profileId") REFERENCES "fitness_profiles"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "diet_plans"
ADD CONSTRAINT "diet_plans_aiJobId_fkey"
FOREIGN KEY ("aiJobId") REFERENCES "ai_jobs"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "diet_meals"
ADD CONSTRAINT "diet_meals_dietPlanId_fkey"
FOREIGN KEY ("dietPlanId") REFERENCES "diet_plans"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "diet_meal_items"
ADD CONSTRAINT "diet_meal_items_dietMealId_fkey"
FOREIGN KEY ("dietMealId") REFERENCES "diet_meals"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "diet_plans"
  ADD CONSTRAINT "diet_plans_title_check"
    CHECK (length(btrim("title")) BETWEEN 1 AND 200),
  ADD CONSTRAINT "diet_plans_targets_check"
    CHECK (
      "dailyCaloriesTarget" BETWEEN 800 AND 6000
      AND "proteinTarget" BETWEEN 0 AND 1000
      AND "carbsTarget" BETWEEN 0 AND 1500
      AND "fatTarget" BETWEEN 0 AND 500
    );

ALTER TABLE "diet_meals"
  ADD CONSTRAINT "diet_meals_name_check"
    CHECK (length(btrim("name")) BETWEEN 1 AND 100),
  ADD CONSTRAINT "diet_meals_order_check"
    CHECK ("order" BETWEEN 1 AND 10),
  ADD CONSTRAINT "diet_meals_calories_check"
    CHECK ("caloriesTarget" BETWEEN 0 AND 3000),
  ADD CONSTRAINT "diet_meals_notes_check"
    CHECK (
      "notes" IS NULL
      OR length(btrim("notes")) BETWEEN 1 AND 1000
    );

ALTER TABLE "diet_meal_items"
  ADD CONSTRAINT "diet_meal_items_food_name_check"
    CHECK (length(btrim("foodName")) BETWEEN 1 AND 200),
  ADD CONSTRAINT "diet_meal_items_quantity_check"
    CHECK (length(btrim("quantity")) BETWEEN 1 AND 100),
  ADD CONSTRAINT "diet_meal_items_values_check"
    CHECK (
      "calories" BETWEEN 0 AND 2000
      AND "protein" BETWEEN 0 AND 500
      AND "carbs" BETWEEN 0 AND 500
      AND "fat" BETWEEN 0 AND 300
    ),
  ADD CONSTRAINT "diet_meal_items_substitution_check"
    CHECK (
      "substitutionGroup" IS NULL
      OR length(btrim("substitutionGroup")) BETWEEN 1 AND 300
    );

UPDATE "prompt_versions"
SET "isActive" = false
WHERE "name" IN (
  'diet_generation_weight_loss',
  'diet_generation_muscle_gain',
  'diet_generation_maintenance'
);

INSERT INTO "prompt_versions" (
  "id",
  "name",
  "version",
  "prompt",
  "isActive",
  "createdAt"
)
VALUES
  (
    'f2515dc7-50eb-4f03-a1a6-c064e6d92305',
    'diet_generation_weight_loss',
    1,
    'Voce e um nutricionista virtual especializado em emagrecimento gradual e alimentacao brasileira. Gere um plano alimentar personalizado usando somente os dados fornecidos. Defina calorias e macronutrientes coerentes, priorize saciedade, alimentos brasileiros acessiveis e preservacao de massa muscular. Respeite integralmente todas as restricoes alimentares e nunca inclua um alimento proibido. Organize refeicoes, quantidades e substituicoes simples. Nao forneca diagnostico, medicamento, promessa de resultado ou conduta para doencas. Retorne somente o JSON exigido pelo schema.',
    true,
    CURRENT_TIMESTAMP
  ),
  (
    'f2515dc7-50eb-4f03-a1a6-c064e6d92306',
    'diet_generation_muscle_gain',
    1,
    'Voce e um nutricionista virtual especializado em hipertrofia e alimentacao brasileira. Gere um plano alimentar personalizado usando somente os dados fornecidos. Defina calorias e macronutrientes coerentes, priorize proteina distribuida ao longo do dia, energia para o treino e alimentos brasileiros acessiveis. Respeite integralmente todas as restricoes alimentares e nunca inclua um alimento proibido. Organize refeicoes, quantidades e substituicoes simples. Nao forneca diagnostico, medicamento, promessa de resultado ou conduta para doencas. Retorne somente o JSON exigido pelo schema.',
    true,
    CURRENT_TIMESTAMP
  ),
  (
    'f2515dc7-50eb-4f03-a1a6-c064e6d92307',
    'diet_generation_maintenance',
    1,
    'Voce e um nutricionista virtual especializado em manutencao de peso, saude e alimentacao brasileira. Gere um plano alimentar personalizado usando somente os dados fornecidos. Defina calorias e macronutrientes coerentes, priorize variedade, equilibrio, praticidade e alimentos brasileiros acessiveis. Respeite integralmente todas as restricoes alimentares e nunca inclua um alimento proibido. Organize refeicoes, quantidades e substituicoes simples. Nao forneca diagnostico, medicamento, promessa de resultado ou conduta para doencas. Retorne somente o JSON exigido pelo schema.',
    true,
    CURRENT_TIMESTAMP
  )
ON CONFLICT ("name", "version")
DO UPDATE SET
  "prompt" = EXCLUDED."prompt",
  "isActive" = true;
