function normalize(message: string): string {
  return message
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/[^a-z0-9\s]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

export function isWorkoutCurrentPlanRead(message: string | undefined): boolean {
  if (!message?.trim()) return false;
  const text = normalize(message);
  const mutation =
    /\b(?:crie|criar|gere|gerar|monte|montar|novo|nova|outro|outra|adapte|adaptar|atualize|atualizar|ajuste|ajustar|altere|alterar|mude|mudar|troque|trocar|substitua|substituir|inclua|incluir|remova|remover)\b/u.test(
      text,
    );
  const changedParameters =
    /\b(?:quero|preciso|vou)\b.*\b(?:treinar|frequencia|vezes|minutos|duracao|modalidade|academia|casa|correr|corrida)\b/u.test(
      text,
    );
  if (mutation || changedParameters) return false;

  const workoutDomain =
    /\b(?:treino|plano de treino|ficha de treino|sessao de treino)\b/u.test(
      text,
    );
  const readCue =
    /\b(?:qual|quais|o que|como esta|mostre|mostrar|mostra|ver|visualizar|consulte|consultar|consulta|mande|mandar|manda|envie|enviar|envia|exiba|exibir|relembre|lembrar|acesse|acessar|abra|abrir|status|situacao)\b/u.test(
      text,
    );
  const currentCue =
    /\b(?:atual|ativo|existente|hoje|amanha|segunda|terca|quarta|quinta|sexta|sabado|domingo)\b/u.test(
      text,
    );
  const ownedWorkout =
    /\b(?:meu treino|minha ficha|meu plano de treino|minhas sessoes)\b/u.test(
      text,
    );
  const todayQuestion = /\bo que (?:eu )?treino (?:hoje|amanha)\b/u.test(text);
  const onlyOwnedReference =
    /^(?:meu treino|minha ficha|meu plano de treino)$/u.test(text);

  return (
    todayQuestion ||
    (workoutDomain && readCue && (currentCue || ownedWorkout)) ||
    onlyOwnedReference
  );
}
