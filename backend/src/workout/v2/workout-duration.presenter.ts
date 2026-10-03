export function presentWorkoutSeconds(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return (
    [minutes ? `${minutes} min` : '', remainder ? `${remainder} s` : '']
      .filter(Boolean)
      .join(' ') || '0 s'
  );
}
