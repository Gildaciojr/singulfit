CREATE TYPE "WorkoutStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

CREATE TABLE "workout_plans" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "profileId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "objective" "FitnessGoal" NOT NULL,
  "status" "WorkoutStatus" NOT NULL DEFAULT 'ACTIVE',
  "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "workout_plans_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "workout_days" (
  "id" TEXT NOT NULL,
  "workoutPlanId" TEXT NOT NULL,
  "dayNumber" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  CONSTRAINT "workout_days_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "workout_exercises" (
  "id" TEXT NOT NULL,
  "workoutDayId" TEXT NOT NULL,
  "exerciseName" TEXT NOT NULL,
  "sets" INTEGER NOT NULL,
  "reps" TEXT NOT NULL,
  "restSeconds" INTEGER NOT NULL,
  "notes" TEXT,
  CONSTRAINT "workout_exercises_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "workout_plans_one_active_user_key"
ON "workout_plans"("userId")
WHERE "status" = 'ACTIVE';

CREATE INDEX "workout_plans_userId_status_generatedAt_idx"
ON "workout_plans"("userId", "status", "generatedAt");

CREATE INDEX "workout_plans_profileId_generatedAt_idx"
ON "workout_plans"("profileId", "generatedAt");

CREATE UNIQUE INDEX "workout_days_workoutPlanId_dayNumber_key"
ON "workout_days"("workoutPlanId", "dayNumber");

CREATE INDEX "workout_days_workoutPlanId_idx"
ON "workout_days"("workoutPlanId");

CREATE INDEX "workout_exercises_workoutDayId_idx"
ON "workout_exercises"("workoutDayId");

ALTER TABLE "workout_plans"
ADD CONSTRAINT "workout_plans_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "workout_plans"
ADD CONSTRAINT "workout_plans_profileId_fkey"
FOREIGN KEY ("profileId") REFERENCES "fitness_profiles"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "workout_days"
ADD CONSTRAINT "workout_days_workoutPlanId_fkey"
FOREIGN KEY ("workoutPlanId") REFERENCES "workout_plans"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "workout_exercises"
ADD CONSTRAINT "workout_exercises_workoutDayId_fkey"
FOREIGN KEY ("workoutDayId") REFERENCES "workout_days"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "workout_plans"
  ADD CONSTRAINT "workout_plans_title_check"
    CHECK (length(btrim("title")) BETWEEN 1 AND 200);

ALTER TABLE "workout_days"
  ADD CONSTRAINT "workout_days_number_check"
    CHECK ("dayNumber" BETWEEN 1 AND 7),
  ADD CONSTRAINT "workout_days_title_check"
    CHECK (length(btrim("title")) BETWEEN 1 AND 200);

ALTER TABLE "workout_exercises"
  ADD CONSTRAINT "workout_exercises_name_check"
    CHECK (length(btrim("exerciseName")) BETWEEN 1 AND 200),
  ADD CONSTRAINT "workout_exercises_sets_check"
    CHECK ("sets" BETWEEN 1 AND 20),
  ADD CONSTRAINT "workout_exercises_reps_check"
    CHECK (length(btrim("reps")) BETWEEN 1 AND 100),
  ADD CONSTRAINT "workout_exercises_rest_check"
    CHECK ("restSeconds" BETWEEN 0 AND 600),
  ADD CONSTRAINT "workout_exercises_notes_check"
    CHECK (
      "notes" IS NULL
      OR length(btrim("notes")) BETWEEN 1 AND 1000
    );

UPDATE "prompt_versions"
SET "isActive" = false
WHERE "name" IN (
  'workout_generation_weight_loss',
  'workout_generation_muscle_gain',
  'workout_generation_maintenance'
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
    'f2515dc7-50eb-4f03-a1a6-c064e6d92301',
    'workout_generation_weight_loss',
    1,
    'Voce e um profissional de educacao fisica especializado em emagrecimento seguro. Gere um plano semanal personalizado usando somente os dados fornecidos. Priorize aderencia, progressao conservadora, condicionamento e preservacao de massa muscular. Respeite integralmente lesoes e limitacoes. Nao inclua diagnosticos, dieta, medicamentos ou promessas de resultado. Retorne somente o JSON exigido pelo schema.',
    true,
    CURRENT_TIMESTAMP
  ),
  (
    'f2515dc7-50eb-4f03-a1a6-c064e6d92302',
    'workout_generation_muscle_gain',
    1,
    'Voce e um profissional de educacao fisica especializado em hipertrofia segura. Gere um plano semanal personalizado usando somente os dados fornecidos. Priorize tecnica, volume recuperavel, progressao e distribuicao muscular coerente. Respeite integralmente lesoes e limitacoes. Nao inclua diagnosticos, dieta, medicamentos ou promessas de resultado. Retorne somente o JSON exigido pelo schema.',
    true,
    CURRENT_TIMESTAMP
  ),
  (
    'f2515dc7-50eb-4f03-a1a6-c064e6d92303',
    'workout_generation_maintenance',
    1,
    'Voce e um profissional de educacao fisica especializado em manutencao da saude e condicionamento. Gere um plano semanal personalizado usando somente os dados fornecidos. Priorize equilibrio, mobilidade, forca geral e aderencia. Respeite integralmente lesoes e limitacoes. Nao inclua diagnosticos, dieta, medicamentos ou promessas de resultado. Retorne somente o JSON exigido pelo schema.',
    true,
    CURRENT_TIMESTAMP
  )
ON CONFLICT ("name", "version")
DO UPDATE SET
  "prompt" = EXCLUDED."prompt",
  "isActive" = true;
