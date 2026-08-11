export function normalizeFoodTerm(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isSemanticFoodTerm(value: string): boolean {
  const trimmed = value.trim();
  const normalized = normalizeFoodTerm(trimmed);
  if (normalized.length < 2) return false;

  if (
    /^(?:sem|nenhum(?:a)?|nao (?:tenho|possuo|ha)(?: nenhum(?:a)?)?)\s+(?:qualquer\s+)?(?:restric(?:ao|oes)|alergia(?:s)?|intolerancia(?:s)?)(?:\s+alimentar(?:es)?)?(?:\s+(?:conhecid[ao]s?|declarad[ao]s?))?$/u.test(
      normalized,
    ) ||
    /^(?:nao se aplica|nada|nenhum(?:a)?)$/u.test(normalized)
  ) {
    return false;
  }

  if (
    /\b(?:emagrecer|engordar|perder peso|perder gordura|ganhar massa|treinar|treino|plano alimentar|objetivo)\b/u.test(
      normalized,
    )
  ) {
    return false;
  }

  // Valores de proveniência/ciclo são metadata estrutural mesmo quando vazaram
  // de um campo `type`; caixa alta, isoladamente, não invalida um alimento.
  if (
    /^[A-Z][A-Z0-9_]*$/u.test(trimmed) &&
    /(?:ONBOARDING|PROFILE|SOURCE|SYSTEM|DEFAULT|USER|REPORTED|INFERRED|PROFESSIONAL|DEFINED)/u.test(
      trimmed,
    )
  ) {
    return false;
  }

  return true;
}

export function foodPreferenceEvidenceSource(evidence: unknown): string | null {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    return null;
  }
  const source = Reflect.get(evidence, 'source');
  return typeof source === 'string' ? source : null;
}
