export interface IntakeEvidence {
  readonly kind: 'MEAL' | 'WATER_ADD' | 'WATER_TOTAL' | 'WATER_GOAL' | 'VOID';
  readonly day: 'TODAY' | 'YESTERDAY';
  readonly quote: string;
  readonly volumeMl: number | null;
  readonly meal?: 'BREAKFAST' | 'LUNCH' | 'DINNER' | 'SNACK' | 'UNKNOWN';
  readonly action?: 'ADD' | 'CORRECT' | 'DELETE';
  readonly targetRecordId?: string | null;
  readonly plannedMeal?: boolean;
  readonly items?: readonly { foodQuote: string; quantityQuote: string }[];
  readonly date?: string | null;
}

/** Validate quoted quantities, never infer a glass size or trust model arithmetic. */
export function intakeEvidence(
  value: unknown,
  text: string,
): IntakeEvidence | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return null;
  const input = value as Record<string, unknown>;
  const quotedText = input.quote;
  const date = typeof input.date === 'string' ? input.date : null;
  if (
    date &&
    (!/^\d{4}-\d{2}-\d{2}$/u.test(date) ||
      !text.includes(date) ||
      !Number.isFinite(new Date(`${date}T12:00:00Z`).getTime()) ||
      new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date)
  )
    return null;
  const action = input.action ?? 'ADD';
  const intent = text.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
  if (
    action !== 'ADD' &&
    /\b(nao|evite|sem|pare)\b[^.!?]*\b(apag\w*|exclu\w*|corrig\w*|corrij\w*|retific\w*)\b/u.test(
      intent,
    )
  )
    return null;
  if (action === 'DELETE' && !/\b(apag\w*|exclu\w*|remov\w*)\b/u.test(intent))
    return null;
  if (
    action === 'CORRECT' &&
    !/\b(corrig\w*|corrij\w*|retific\w*|correcao|na verdade|registro)\b/u.test(
      intent,
    )
  )
    return null;
  if (
    input.kind === 'WATER_GOAL' &&
    (!/\bminha meta\b/u.test(intent) ||
      /\b(nao|talvez|qual|quanto|deveria)\b/u.test(intent))
  )
    return null;
  if (
    typeof action !== 'string' ||
    !['ADD', 'CORRECT', 'DELETE'].includes(action)
  )
    return null;
  if (
    action !== 'ADD' &&
    (typeof input.targetRecordId !== 'string' || !input.targetRecordId.trim())
  )
    return null;
  const revision = {
    action: action as IntakeEvidence['action'],
    targetRecordId:
      typeof input.targetRecordId === 'string' ? input.targetRecordId : null,
    date,
  };
  if (input.day === 'YESTERDAY' && !/\bontem\b/iu.test(text)) return null;
  if (
    !['MEAL', 'WATER_ADD', 'WATER_TOTAL', 'WATER_GOAL', 'VOID'].includes(
      String(input.kind),
    ) ||
    !['TODAY', 'YESTERDAY'].includes(String(input.day)) ||
    typeof input.quote !== 'string' ||
    !input.quote.trim() ||
    !text.includes(input.quote)
  )
    return null;
  if (input.kind === 'VOID')
    return action === 'DELETE'
      ? {
          kind: 'VOID',
          day: input.day as IntakeEvidence['day'],
          quote: input.quote,
          volumeMl: null,
          ...revision,
        }
      : null;
  if (action === 'DELETE') return null;
  if (input.kind === 'MEAL')
    return {
      kind: 'MEAL',
      day: input.day as IntakeEvidence['day'],
      quote: input.quote,
      volumeMl: null,
      ...revision,
      plannedMeal:
        input.plannedMeal === true && /\b(dieta|plano)\b/iu.test(input.quote),
      items: Array.isArray(input.items)
        ? input.items.flatMap((item: unknown) => {
            if (typeof item !== 'object' || !item || Array.isArray(item))
              return [];
            const portion = item as Record<string, unknown>;
            return typeof portion.foodQuote === 'string' &&
              portion.foodQuote.trim() &&
              typeof portion.quantityQuote === 'string' &&
              portion.quantityQuote.trim() &&
              typeof quotedText === 'string' &&
              quotedText.includes(portion.foodQuote) &&
              quotedText.includes(portion.quantityQuote)
              ? [
                  {
                    foodQuote: portion.foodQuote,
                    quantityQuote: portion.quantityQuote,
                  },
                ]
              : [];
          })
        : [],
      meal: ['BREAKFAST', 'LUNCH', 'DINNER', 'SNACK'].includes(
        String(input.meal),
      )
        ? (input.meal as IntakeEvidence['meal'])
        : 'UNKNOWN',
    };
  const quote = input.quote
    .toLocaleLowerCase('pt-BR')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim();
  const amount = /^(\d+(?:[.,]\d+)?)\s*(ml|mililitros?|l|litros?)$/u.exec(
    // Numerical units remain literal; a complete explicit absence reports zero.
    quote,
  );
  if (
    input.kind === 'WATER_TOTAL' &&
    input.quote.trim() === text.trim() &&
    /^(?:ainda )?nao (bebi|tomei|ingeri) agua(?: (ainda|hoje))?[.!]?$/u.test(
      quote,
    )
  )
    return {
      kind: 'WATER_TOTAL',
      day: input.day as IntakeEvidence['day'],
      quote: input.quote,
      volumeMl: 0,
      ...revision,
    };
  const glasses =
    /^(\d+)\s+copos?\s+de\s+(\d+(?:[.,]\d+)?)\s*(ml|mililitros?|l|litros?)$/u.exec(
      quote,
    );
  if (!amount && !glasses) return null;
  const numeric = Number((amount?.[1] ?? glasses?.[2] ?? '').replace(',', '.'));
  const unit = amount?.[2] ?? glasses?.[3];
  const multiplier = unit === 'l' || unit?.startsWith('litro') ? 1000 : 1;
  const volumeMl = numeric * multiplier * (glasses ? Number(glasses[1]) : 1);
  if (
    !Number.isSafeInteger(volumeMl) ||
    volumeMl < 0 ||
    volumeMl > 100000 ||
    (volumeMl === 0 && input.kind !== 'WATER_TOTAL')
  )
    return null;
  return {
    kind: input.kind as IntakeEvidence['kind'],
    day: input.day as IntakeEvidence['day'],
    quote: input.quote,
    volumeMl,
    ...revision,
  };
}

export function hydrationTotal(
  records: readonly { kind: string; volumeMl: number | null }[],
): number | null {
  if (!records.length) return null;
  let total = 0;
  for (const record of records) {
    if (record.volumeMl === null) continue;
    if (record.kind === 'WATER_TOTAL') total = record.volumeMl;
    if (record.kind === 'WATER_ADD') total += record.volumeMl;
  }
  return total;
}

/** One receipt cannot silently absorb other independently quantified facts.
 * This is coverage of literal evidence, not a classifier of user intent. */
export function intakeNeedsClarification(
  value: IntakeEvidence | null,
  text: string,
): boolean {
  if (!value || value.kind === 'VOID' || value.action === 'CORRECT')
    return false;
  const volumes = [
    ...text.matchAll(/\b\d+(?:[.,]\d+)?\s*(?:ml|mililitros?|litros?|l)\b/giu),
  ];
  if (value.kind === 'MEAL') return volumes.length > 0;
  return (
    volumes.some((volume) => !value.quote.includes(volume[0])) ||
    volumes.length > 1
  );
}
