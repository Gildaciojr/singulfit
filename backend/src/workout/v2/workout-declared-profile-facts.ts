import type { WorkoutEnvironment } from './workout-planning-context.contract';

export interface DeclaredWorkoutProfileFacts {
  readonly environment?: WorkoutEnvironment;
  readonly environmentMentioned: boolean;
  readonly weeklyFrequency: number | null;
  readonly frequencyMentioned: boolean;
  readonly equipmentRestricted: boolean;
  readonly equipmentScope: Readonly<{ text: string; restricted: boolean }>;
}

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

/** Scope uncertainty/negation to the declaration before the matched field. */
function uncertainDeclaration(text: string, index: number): boolean {
  const prefix =
    text
      .slice(0, index)
      .split(
        /[,;.!?]|\b(?:mas|porem)\b|\be\s+(?=(?:quero|pretendo|vou|treino|consigo|posso)\b)/u,
      )
      .at(-1) ?? '';
  return (
    /\b(?:talvez|provavelmente|possivelmente|acho(?: que)?|nao sei(?: se)?|nao tenho certeza(?: se)?)\b[^,;.!?]*$/u.test(
      prefix,
    ) ||
    /\b(?:nao|sem)\s+(?:(?:quero|pretendo|posso|consigo|vou|treino|treinar|em|na|no|a|uma?|para|fazer|sera|e)\s+)*$/u.test(
      prefix,
    )
  );
}

/** Restriction words qualify equipment, never an unrelated injury/cardio clause. */
export function hasDeclaredWorkoutEquipmentRestriction(
  message: string,
): boolean {
  const text = normalize(message);
  const equipment =
    '(?:equipamentos?|aparelhos?|maquinas?|halteres?|barras?|bancos?|polias?|cabos?|elasticos?|esteiras?|kettlebells?)';
  return (
    new RegExp(
      '\\b(?:sem|nao (?:tenho|tem|possuo|possui|ha)|falta(?:m)?|so (?:com|tenho)|somente|apenas)\\s+(?:(?:os?|as?|nenhum|nenhuma|alguns|algumas|dois|duas|um|uma|com)\\s+)*' +
        equipment +
        '\\b',
      'u',
    ).test(text) ||
    /\b(?:equipamentos?|aparelhos?)\s+(?:limitados?|restritos?|indisponiveis)\b/u.test(
      text,
    )
  );
}

export function declaredWorkoutProfileFacts(
  message: string,
): DeclaredWorkoutProfileFacts {
  const text = normalize(message);
  const equipmentRestricted = hasDeclaredWorkoutEquipmentRestriction(text);
  const environments: WorkoutEnvironment[] = [];
  let invalidEnvironment = false;
  const environmentMatches = [
    ...text.matchAll(
      /\b(?:academia(?:\s+(?:de|do)\s+(?:condominio|hotel))?|musculacao|(?:em\s+)?casa|home(?:\s+workout)?|crossfit|box|trilha|pista|estrada|rua|(?:ao\s+)?ar livre|parque)\b/gu,
    ),
  ];
  for (const [index, match] of environmentMatches.entries()) {
    if (uncertainDeclaration(text, match.index)) invalidEnvironment = true;
    const noun = match[0];
    if (/academia|musculacao/u.test(noun)) {
      const clausePrefix =
        text
          .slice(0, match.index)
          .split(/[,;.!?]|\b(?:mas|porem|e)\b/u)
          .at(-1) ?? '';
      const local = text
        .slice(match.index, environmentMatches[index + 1]?.index ?? text.length)
        // A direct equipment continuation still qualifies the same gym after a comma.
        .split(
          /[;.!?]|\b(?:mas|e)\b|,(?!\s*(?:nao (?:tem|tenho)|so (?:tenho|com)|sem|apenas|somente)\b)/u,
        )[0];
      environments.push(
        hasDeclaredWorkoutEquipmentRestriction(clausePrefix + local) ||
          /\bacademia\s+(?:de|do)\s+(?:condominio|hotel)\b/u.test(noun) ||
          /^\s+(?:(?:muito|bem)\s+)?(?:pequena|limitada)\b/u.test(
            local.slice(noun.length),
          )
          ? 'LIMITED_GYM'
          : 'FULL_GYM',
      );
    } else if (/casa|home/u.test(noun)) environments.push('HOME');
    else if (/crossfit|box/u.test(noun)) environments.push('CROSSFIT_BOX');
    else if (noun === 'trilha') environments.push('TRAIL');
    else if (noun === 'pista') environments.push('TRACK');
    else if (noun === 'estrada') environments.push('ROAD');
    else if (noun === 'rua') environments.push('STREET');
    else environments.push('OUTDOOR');
  }
  const environmentValues = new Set(environments);
  const environmentAlternative = environmentMatches.some(
    (match, index) =>
      index > 0 &&
      /\bou\b/u.test(
        text.slice(
          environmentMatches[index - 1].index +
            environmentMatches[index - 1][0].length,
          match.index,
        ),
      ),
  );
  if (environmentValues.size > 1 && environmentAlternative)
    invalidEnvironment = true;
  // A qualified gym declaration takes precedence over a generic mention of that gym.
  if (environmentValues.has('LIMITED_GYM'))
    environmentValues.delete('FULL_GYM');
  const environment =
    !invalidEnvironment && environmentValues.size === 1
      ? [...environmentValues][0]
      : undefined;

  // Keep equipment declarations with their environment and speaker. An unbound
  // first-person continuation can describe the selected training environment.
  const separators = [
    ...text.matchAll(
      /[;.!?]|\b(?:mas|porem)\b|\be\s+(?=(?:meu|minha|seu|sua)\b)/gu,
    ),
  ];
  const clauses = [
    0,
    ...separators.map((match) => match.index + match[0].length),
  ].map((start, index) => ({
    start,
    end: separators[index]?.index ?? text.length,
  }));
  const equipmentText = clauses
    .filter(({ start, end }) => {
      const clause = text.slice(start, end);
      if (
        /\b(?:meu|minha|seu|sua)\s+(?:irmao|irma|esposa|esposo|marido|mulher|pai|mae|filho|filha|amigo|amiga)\b/u.test(
          clause,
        )
      )
        return false;
      const mentions = environmentMatches.filter(
        (match) => match.index >= start && match.index < end,
      );
      if (!mentions.length) return true;
      if (!environment) return false;
      return mentions.every(
        (match) =>
          environments[environmentMatches.indexOf(match)] === environment,
      );
    })
    .map(({ start, end }) => text.slice(start, end))
    .join('; ');
  const equipmentScope = Object.freeze({
    text: equipmentText,
    restricted: hasDeclaredWorkoutEquipmentRestriction(equipmentText),
  });

  const words: Readonly<Record<string, number>> = {
    um: 1,
    uma: 1,
    dois: 2,
    duas: 2,
    tres: 3,
    quatro: 4,
    cinco: 5,
    seis: 6,
    sete: 7,
  };
  const frequencyMatches = [
    ...text.matchAll(
      /\b(0?[1-7]|um|uma|dois|duas|tres|quatro|cinco|seis|sete)\s*(?:x|vezes?|dias?)(?:\s*(?:por|na|esta)?\s*semana)?\b/gu,
    ),
  ];
  const frequencies = new Set(
    frequencyMatches.map((match) => words[match[1]] ?? Number(match[1])),
  );
  const invalidFrequency = frequencyMatches.some((match) =>
    uncertainDeclaration(text, match.index),
  );
  const weeklyFrequency =
    !invalidFrequency && frequencies.size === 1
      ? ([...frequencies][0] ?? null)
      : null;
  return Object.freeze({
    environment,
    environmentMentioned: environmentMatches.length > 0,
    weeklyFrequency,
    frequencyMentioned: frequencyMatches.length > 0,
    equipmentRestricted,
    equipmentScope,
  });
}

export function declaredWorkoutEnvironment(
  text: string,
): WorkoutEnvironment | undefined {
  return declaredWorkoutProfileFacts(text).environment;
}

export function declaredWorkoutFrequency(text: string): number | null {
  return declaredWorkoutProfileFacts(text).weeklyFrequency;
}
