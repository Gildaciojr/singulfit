/** Explicit intent to adjust an existing Workout, never a negation or a question. */
export function isExplicitWorkoutPlanAdjustment(message: string): boolean {
  const text = message
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
  return (
    !text.includes('?') &&
    /^(?:eu\s+)?(?:quero|preciso|gostaria de)\s+(?:mudar|alterar|ajustar|adaptar)\s+(?:(?:o|meu|esse|este)\s+)?(?:treino|plano de treino)\b/u.test(
      text,
    )
  );
}
