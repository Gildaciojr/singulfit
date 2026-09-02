export function isNutritionCurrentPlanRead(
  message: string | undefined,
): boolean {
  if (!message?.trim()) return false;
  const text = message
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/[^a-z0-9\s]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  const mutation =
    /\b(?:crie|criar|gere|gerar|monte|montar|novo|nova|adapte|adaptar|atualize|atualizar|ajuste|ajustar|altere|alterar|mude|mudar|troque|trocar|substitua|substituir)\b/u.test(
      text,
    );
  if (mutation || /\b(?:status|andamento|situacao)\b/u.test(text)) return false;
  const owned =
    /\b(?:minha dieta|meu plano alimentar|meu cardapio|minhas refeicoes)\b/u.test(
      text,
    );
  const current =
    /\b(?:dieta|plano alimentar|cardapio)\s+(?:atual|ativo|existente)\b/u.test(
      text,
    );
  const createdForUser =
    /\b(?:dieta|plano alimentar|cardapio)\b.*\b(?:montou|criou|fez)\b.*\b(?:mim|pra mim|para mim)\b/u.test(
      text,
    );
  const readCue =
    /\b(?:qual|quais|o que|como esta|mostre|mostrar|mostra|ver|visualizar|consulte|consultar|consulta|mande|mandar|manda|envie|enviar|envia|exiba|exibir|relembre|lembrar|acesse|acessar|abra|abrir)\b/u.test(
      text,
    );

  const onlyOwnedReference =
    /^(?:minha dieta|meu plano alimentar|meu cardapio)$/u.test(text);

  return (
    current || createdForUser || (owned && (readCue || onlyOwnedReference))
  );
}
