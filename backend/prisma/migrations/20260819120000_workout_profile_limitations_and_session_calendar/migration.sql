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
