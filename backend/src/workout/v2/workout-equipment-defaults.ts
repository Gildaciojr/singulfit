import type {
  WorkoutEquipment,
  WorkoutPlanningValue,
} from './workout-planning-context.contract';

const BASELINES: Readonly<Record<string, readonly WorkoutEquipment[]>> =
  Object.freeze({
    FULL_GYM: Object.freeze([
      'BARBELL',
      'BENCH',
      'CABLE',
      'DUMBBELL',
      'MACHINE',
      'PULL_UP_BAR',
      'TREADMILL',
    ] as const),
    CROSSFIT_BOX: Object.freeze([
      'BARBELL',
      'BODYWEIGHT',
      'DUMBBELL',
      'KETTLEBELL',
      'PULL_UP_BAR',
      'ROW_ERGOMETER',
    ] as const),
    HOME: Object.freeze(['BODYWEIGHT'] as const),
  });

export function workoutEquipmentBaseline(
  environment: string | undefined,
): WorkoutPlanningValue<readonly WorkoutEquipment[]> | undefined {
  const value = environment ? BASELINES[environment] : undefined;
  return value ? Object.freeze({ status: 'INFERRED', value }) : undefined;
}

export function isWorkoutEquipmentBaseline(
  environment: string | undefined,
  equipment: readonly string[] | undefined,
): boolean {
  const baseline = environment ? BASELINES[environment] : undefined;
  return (
    !!baseline &&
    !!equipment &&
    baseline.length === equipment.length &&
    new Set(equipment).size === baseline.length &&
    baseline.every((item) => equipment.includes(item))
  );
}
