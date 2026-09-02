export function isFullPlanReplacementRequest(message: string): boolean {
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
