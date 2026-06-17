CREATE TYPE "EnergyLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

CREATE TABLE "fitness_check_ins" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "profileId" TEXT NOT NULL,
  "mood" TEXT NOT NULL,
  "energyLevel" "EnergyLevel" NOT NULL,
  "adherenceScore" INTEGER NOT NULL,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fitness_check_ins_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "progress_snapshots" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "profileId" TEXT NOT NULL,
  "weightKg" DECIMAL(6, 2) NOT NULL,
  "bodyFatPercent" DECIMAL(5, 2),
  "muscleMassKg" DECIMAL(6, 2),
  "bmi" DECIMAL(5, 2) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "progress_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "progress_insights" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "snapshotId" TEXT NOT NULL,
  "insight" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "progress_insights_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "fitness_check_ins_userId_createdAt_idx"
ON "fitness_check_ins"("userId", "createdAt");

CREATE INDEX "fitness_check_ins_profileId_createdAt_idx"
ON "fitness_check_ins"("profileId", "createdAt");

CREATE INDEX "progress_snapshots_userId_createdAt_idx"
ON "progress_snapshots"("userId", "createdAt");

CREATE INDEX "progress_snapshots_profileId_createdAt_idx"
ON "progress_snapshots"("profileId", "createdAt");

CREATE INDEX "progress_insights_userId_createdAt_idx"
ON "progress_insights"("userId", "createdAt");

CREATE INDEX "progress_insights_snapshotId_createdAt_idx"
ON "progress_insights"("snapshotId", "createdAt");

ALTER TABLE "fitness_check_ins"
ADD CONSTRAINT "fitness_check_ins_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "fitness_check_ins"
ADD CONSTRAINT "fitness_check_ins_profileId_fkey"
FOREIGN KEY ("profileId") REFERENCES "fitness_profiles"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "progress_snapshots"
ADD CONSTRAINT "progress_snapshots_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "progress_snapshots"
ADD CONSTRAINT "progress_snapshots_profileId_fkey"
FOREIGN KEY ("profileId") REFERENCES "fitness_profiles"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "progress_insights"
ADD CONSTRAINT "progress_insights_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "progress_insights"
ADD CONSTRAINT "progress_insights_snapshotId_fkey"
FOREIGN KEY ("snapshotId") REFERENCES "progress_snapshots"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "fitness_check_ins"
  ADD CONSTRAINT "fitness_check_ins_mood_check"
    CHECK (length(btrim("mood")) BETWEEN 1 AND 100),
  ADD CONSTRAINT "fitness_check_ins_adherence_check"
    CHECK ("adherenceScore" BETWEEN 0 AND 100),
  ADD CONSTRAINT "fitness_check_ins_notes_check"
    CHECK (
      "notes" IS NULL
      OR length(btrim("notes")) BETWEEN 1 AND 1000
    );

ALTER TABLE "progress_snapshots"
  ADD CONSTRAINT "progress_snapshots_weight_check"
    CHECK ("weightKg" BETWEEN 20 AND 500),
  ADD CONSTRAINT "progress_snapshots_body_fat_check"
    CHECK (
      "bodyFatPercent" IS NULL
      OR "bodyFatPercent" BETWEEN 0 AND 100
    ),
  ADD CONSTRAINT "progress_snapshots_muscle_mass_check"
    CHECK (
      "muscleMassKg" IS NULL
      OR "muscleMassKg" BETWEEN 0 AND 500
    ),
  ADD CONSTRAINT "progress_snapshots_bmi_check"
    CHECK ("bmi" BETWEEN 5 AND 150);

ALTER TABLE "progress_insights"
  ADD CONSTRAINT "progress_insights_text_check"
    CHECK (length(btrim("insight")) BETWEEN 1 AND 500);

UPDATE "prompt_versions"
SET "isActive" = false
WHERE "name" = 'progress_insight_simple';

INSERT INTO "prompt_versions" (
  "id",
  "name",
  "version",
  "prompt",
  "isActive",
  "createdAt"
)
VALUES (
  'f2515dc7-50eb-4f03-a1a6-c064e6d92304',
  'progress_insight_simple',
  1,
  'Voce analisa evolucao fisica com linguagem simples, acolhedora e objetiva. Use somente os dados fornecidos. Quando houver comparacao, destaque a mudanca mais relevante dos ultimos 30 dias; sem comparacao, registre que esta e a linha de base. Nao forneca diagnostico, dieta, treino, medicamento ou promessa de resultado. Evite julgamentos e retorne somente o JSON exigido pelo schema.',
  true,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("name", "version")
DO UPDATE SET
  "prompt" = EXCLUDED."prompt",
  "isActive" = true;
