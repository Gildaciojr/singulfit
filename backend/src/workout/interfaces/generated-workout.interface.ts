export interface GeneratedWorkoutExercise {
  readonly exerciseName: string;
  readonly sets: number;
  readonly reps: string;
  readonly restSeconds: number;
  readonly notes: string | null;
}

export interface GeneratedWorkoutDay {
  readonly dayNumber: number;
  readonly title: string;
  readonly exercises: readonly GeneratedWorkoutExercise[];
}

export interface GeneratedWorkoutPlan {
  readonly title: string;
  readonly days: readonly GeneratedWorkoutDay[];
}
