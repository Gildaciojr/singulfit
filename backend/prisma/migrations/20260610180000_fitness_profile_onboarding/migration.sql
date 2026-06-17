CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE');
CREATE TYPE "ActivityLevel" AS ENUM (
  'SEDENTARY',
  'LIGHT',
  'MODERATE',
  'HIGH',
  'ATHLETE'
);
CREATE TYPE "FitnessGoal" AS ENUM (
  'WEIGHT_LOSS',
  'MUSCLE_GAIN',
  'MAINTENANCE'
);

CREATE TABLE "fitness_profiles" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "gender" "Gender" NOT NULL,
  "birthDate" DATE NOT NULL,
  "heightCm" INTEGER NOT NULL,
  "currentWeightKg" DECIMAL(6, 2) NOT NULL,
  "targetWeightKg" DECIMAL(6, 2) NOT NULL,
  "activityLevel" "ActivityLevel" NOT NULL,
  "goal" "FitnessGoal" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "fitness_profiles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "food_restrictions" (
  "id" TEXT NOT NULL,
  "profileId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  CONSTRAINT "food_restrictions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "injury_restrictions" (
  "id" TEXT NOT NULL,
  "profileId" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  CONSTRAINT "injury_restrictions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "body_measurements" (
  "id" TEXT NOT NULL,
  "profileId" TEXT NOT NULL,
  "weightKg" DECIMAL(6, 2) NOT NULL,
  "bodyFatPercent" DECIMAL(5, 2),
  "muscleMassKg" DECIMAL(6, 2),
  "measuredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "body_measurements_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fitness_profiles_userId_key"
ON "fitness_profiles"("userId");

CREATE INDEX "food_restrictions_profileId_idx"
ON "food_restrictions"("profileId");

CREATE INDEX "injury_restrictions_profileId_idx"
ON "injury_restrictions"("profileId");

CREATE INDEX "body_measurements_profileId_measuredAt_idx"
ON "body_measurements"("profileId", "measuredAt");

ALTER TABLE "fitness_profiles"
ADD CONSTRAINT "fitness_profiles_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "food_restrictions"
ADD CONSTRAINT "food_restrictions_profileId_fkey"
FOREIGN KEY ("profileId") REFERENCES "fitness_profiles"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "injury_restrictions"
ADD CONSTRAINT "injury_restrictions_profileId_fkey"
FOREIGN KEY ("profileId") REFERENCES "fitness_profiles"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "body_measurements"
ADD CONSTRAINT "body_measurements_profileId_fkey"
FOREIGN KEY ("profileId") REFERENCES "fitness_profiles"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "fitness_profiles"
  ADD CONSTRAINT "fitness_profiles_birth_date_check"
    CHECK ("birthDate" < CURRENT_DATE),
  ADD CONSTRAINT "fitness_profiles_height_check"
    CHECK ("heightCm" BETWEEN 50 AND 300),
  ADD CONSTRAINT "fitness_profiles_weight_check"
    CHECK (
      "currentWeightKg" BETWEEN 20 AND 500
      AND "targetWeightKg" BETWEEN 20 AND 500
    );

ALTER TABLE "food_restrictions"
  ADD CONSTRAINT "food_restrictions_type_check"
    CHECK (length(btrim("type")) BETWEEN 1 AND 100),
  ADD CONSTRAINT "food_restrictions_description_check"
    CHECK (length(btrim("description")) BETWEEN 1 AND 500);

ALTER TABLE "injury_restrictions"
  ADD CONSTRAINT "injury_restrictions_description_check"
    CHECK (length(btrim("description")) BETWEEN 1 AND 500);

ALTER TABLE "body_measurements"
  ADD CONSTRAINT "body_measurements_weight_check"
    CHECK ("weightKg" BETWEEN 20 AND 500),
  ADD CONSTRAINT "body_measurements_body_fat_check"
    CHECK (
      "bodyFatPercent" IS NULL
      OR "bodyFatPercent" BETWEEN 0 AND 100
    ),
  ADD CONSTRAINT "body_measurements_muscle_mass_check"
    CHECK (
      "muscleMassKg" IS NULL
      OR "muscleMassKg" BETWEEN 0 AND 500
    );

UPDATE "users"
SET "onboardingCompleted" = false
WHERE NOT EXISTS (
  SELECT 1
  FROM "fitness_profiles"
  WHERE "fitness_profiles"."userId" = "users"."id"
);
