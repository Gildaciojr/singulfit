ALTER TYPE "CoachProfileAcquisitionField" ADD VALUE 'PHYSICAL_LIMITATIONS';

CREATE TYPE "WorkoutWeekday" AS ENUM (
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
  'SUNDAY'
);

ALTER TABLE "workout_days"
ADD COLUMN "weekday" "WorkoutWeekday";

CREATE INDEX "workout_days_workoutPlanId_weekday_idx"
ON "workout_days"("workoutPlanId", "weekday");
