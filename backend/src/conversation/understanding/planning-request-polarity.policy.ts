/** Scope negation to requests, not to facts such as "não tenho equipamento".
 * This is an effect veto shared by recognition and authorization, not a new
 * intent classifier. The existing policies still recognize the affirmative span.
 */
export function affirmativePlanningText(text: string): string {
  return planningRequestPolarity(text).affirmativeText;
}

export function hasWorkoutEffectRefusal(text: string): boolean {
  return planningRequestPolarity(text).workoutRefused;
}

function planningRequestPolarity(text: string): {
  affirmativeText: string;
  workoutRefused: boolean;
} {
  const fold = (value: string) =>
    value
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase();
  const clauses = text.split(
    /[.!?;]|\b(?:mas|porém|porem|contudo|entretanto)\b|,\s*(?=não|nao|nunca)|\s+e\s+(?=não|nao|nunca|monte\b|crie\b|gere\b|adapte\b|quero\b)|(?=\bsem\s+(?:alterar|mudar|gerar|criar|substituir|ajustar)\b)/giu,
  );
  const affirmative: string[] = [];
  let workoutRefused = false;
  for (const clause of clauses) {
    const value = fold(clause);
    // Prevention/interruption vetoes apply only to a requested planning effect.
    // Facts such as avoiding an exercise or lacking equipment are unaffected.
    const preventedEffect =
      /\b(?:evit\w*|impec\w*|imped\w*|proib\w*|pare|parar|cesse|cessar|interromp\w*|deixe)\s+(?:(?:que|voce|eu|de|a|o|me|se|por favor)\s+)*(?:ger\w*|cri\w*|mont\w*|elabor\w*|refa\w*|tro(?:c|qu)\w*|substitu\w*|atualiz\w*|adapt\w*|ajust\w*|alter\w*|mud\w*|faz\w*|fac\w*)\b/u.test(
        value,
      ) &&
      /\b(?:planos?|treinos?|fichas?|dietas?|cardapios?|crossfit|musculacao)\b/u.test(
        value,
      );
    const negativeRequest =
      preventedEffect ||
      /\b(?:nao|nunca|nem|sem)\s+(?:(?:me|voce|o|a|os|as|ele|ela|isso|esse|por favor|precisa|preciso|deve|devo|pode|podemos|quero|queria|gostaria|que|de|para|um|novo|outro)\s+)*(?:ger\w*|cri\w*|mont\w*|elabor\w*|refa\w*|tro(?:c|qu)\w*|substitu\w*|atualiz\w*|adapt\w*|ajust\w*|alter\w*|mud\w*|faz\w*|fac\w*)\b/u.test(
        value,
      ) ||
      /^\s*(?:nao|nem)\s+(?:(?:um|uma|novo|nova|outro|outra)\s+)*(?:plano|treino|dieta|cardapio|ficha)\b/u.test(
        value,
      ) ||
      /\b(?:nao|nunca)\s+(?:quero|preciso|queria|gostaria)\b[^.!?;]*\b(?:plano|treino|dieta|cardapio|ficha|crossfit|musculacao)\b/u.test(
        value,
      );
    if (negativeRequest) {
      // A later refusal revokes an earlier request for the same target.
      const workout = /\b(?:treinos?|fichas?|crossfit|musculacao)\b/u.test(
        value,
      );
      const nutrition = /\b(?:dietas?|cardapios?|alimentar)\b/u.test(value);
      workoutRefused ||= workout || !nutrition;
      for (let i = affirmative.length - 1; i >= 0; i -= 1) {
        const prior = fold(affirmative[i]);
        if (
          (!workout && !nutrition) ||
          (workout &&
            /\b(?:treinos?|fichas?|crossfit|musculacao)\b/u.test(prior)) ||
          (nutrition && /\b(?:dietas?|cardapios?|alimentar)\b/u.test(prior))
        )
          affirmative.splice(i, 1);
      }
    } else affirmative.push(clause.trim());
  }
  return {
    affirmativeText: affirmative.filter(Boolean).join('; '),
    workoutRefused,
  };
}
