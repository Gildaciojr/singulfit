export interface GeneratedWorkoutExercise {
  exerciseName: string;
  sets: number;
  reps: string;
  restSeconds: number;
  notes: string | null;
}

export interface GeneratedWorkoutDay {
  dayNumber: number;
  title: string;
  exercises: GeneratedWorkoutExercise[];
}

export interface GeneratedWorkoutPlan {
  title: string;
  days: GeneratedWorkoutDay[];
}
