export function isProductivePlanCreationRequest(message: string): boolean {
  const text = message
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/gu, ' ')
    .trim();
  const plan = /\b(?:treino|dieta|cardapio|plano|ficha)\b/u;
  // Negation is scoped to the requesting clause, not to later exercise restrictions.
  return text.split(/[,;.!?]|\bmas\b/u).some((clause) => {
    const request =
      /^(?:por favor\s+)?(?:eu\s+)?(?:me\s+)?(?:quero|preciso(?: de)?|gostaria(?: de)?|pode(?:ria)?(?: me)?|monte|monta|montar|crie|cria|criar|gere|gera|gerar|faca|faz|fazer|refaca|refaz|refazer|recrie|recria|recriar)\b/u.exec(
        clause.trim(),
      );
    if (!request || !plan.test(clause)) return false;
    const body = clause.trim().slice(request[0].length).trim();
    return /^(?:(?:de|um|uma|o|a|meu|minha|novo|nova|outro|outra|montar|criar|gerar|fazer|refazer|recriar)\s+)*(?:treino|dieta|cardapio|plano|ficha)\b/u.test(
      body,
    );
  });
}

export function isFullPlanReplacementRequest(message: string): boolean {
  if (
    /^(?:eu\s+)?n[aã]o\s+(?:quero|preciso|pretendo|vou|gostaria)\b/iu.test(
      message.trim(),
    )
  )
    return false;
  const text = message
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/[^a-z0-9\s]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  const plan = /\b(?:plano|dieta|cardapio|treino|ficha)\b/u.test(text);
  const replacement =
    /\b(?:outro|outra|novo|nova)\b/u.test(text) ||
    /\b(?:totalmente|completamente) diferente\b/u.test(text) ||
    /\b(?:refaca|refazer|recrie|recriar)\b.*\b(?:inteiro|completo|do zero)\b/u.test(
      text,
    ) ||
    /\b(?:substitua|substituir|troque|trocar)\b.*\b(?:todo|toda|inteiro|inteira|completo|completa)\b/u.test(
      text,
    );
  return plan && replacement;
}
