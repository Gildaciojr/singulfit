/** Keep days, sections and exercise blocks together before falling back to lines. */
export function chunkWorkoutWhatsApp(
  content: string,
  maximumLength = 3400,
): readonly string[] {
  const text = content.trim();
  if (text.length <= maximumLength) return Object.freeze([text]);
  const budget = maximumLength - 80;
  if (budget < 100) throw new Error('Limite de chunk Workout insuficiente');
  const chunks: string[] = [];
  let current = '';
  const push = (unit: string) => {
    const combined = current ? `${current}\n\n${unit}` : unit;
    if (combined.length <= budget) current = combined;
    else {
      if (current) chunks.push(current);
      current = unit;
    }
  };
  const lines = (unit: string) => {
    // Contract-sized exercise lines remain intact; oversized legacy prose can reflow.
    const pieces: string[] = [];
    let piece = '';
    for (const line of unit.split('\n')) {
      if (line.length > budget && line.includes('*'))
        throw new Error('Linha de título Workout excede o limite de entrega');
      const words = line.length > budget ? line.split(/\s+/u) : [line];
      for (const word of words) {
        if (word.length > budget)
          throw new Error('Linha Workout não divisível');
        const joined = piece
          ? `${piece}${words.length > 1 ? ' ' : '\n'}${word}`
          : word;
        if (joined.length <= budget) piece = joined;
        else {
          pieces.push(piece);
          piece = word;
        }
      }
    }
    if (piece) pieces.push(piece);
    pieces.forEach(push);
  };
  const split = (unit: string, level: number): void => {
    if (unit.length <= budget) {
      push(unit);
      return;
    }
    const patterns = [
      /(?<!━━━━━━━━━━━━━━)\n\n(?=(?:━━━━━━━━━━━━━━\n\n)?(?:📅 )?\*(?:Sessão \d+|Segunda|Terça|Quarta|Quinta|Sexta|Sábado|Domingo)\b)/u,
      /\n\n(?=(?:🔥|🧩|💪|🏃|🧘) \*)/u,
      /\n\n(?=\*(?:\d+\. )?[^\n*]+\*\n)/u,
    ];
    if (level === patterns.length) {
      // A prescription and its safety guidance are atomic. Fail closed if even
      // one exercise cannot fit; never emit an orphaned metric or warning.
      if (/(?:^|\n\n)\*\d+\. [^\n*]+\*\n/u.test(unit))
        throw new Error('Exercício Workout excede o limite de entrega segura');
      lines(unit);
      return;
    }
    const units = unit.split(patterns[level]);
    // Attach each heading to its first content unit, including the introduction.
    if (units.length > 1 && !units[0].includes('• ')) {
      units.splice(0, 2, `${units[0]}\n\n${units[1]}`);
    }
    units.forEach((part) => split(part, level + 1));
  };
  split(text, 0);
  if (current) chunks.push(current);
  return Object.freeze(
    chunks.map((chunk, index) =>
      index === 0
        ? chunk
        : `➡️ *Continuação do seu treino — mensagem ${index + 1} de ${chunks.length}*\n\n${chunk}`,
    ),
  );
}
