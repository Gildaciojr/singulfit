import type { ConsumptionPeriod } from '../../nutrition/nutrition-consumption-summary.service';
import { isNutritionAdvice } from './nutrition-request.policy';

export function foldDailyText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/[^a-z0-9 ]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}
export type DailyMetric = 'CALORIES' | 'PROTEIN' | 'CARBS' | 'FAT' | 'ALL';
export function isDailyMealRequest(value: string): boolean {
  if (isNutritionAdvice(value)) return false;
  const text = foldDailyText(value);
  if (
    /\b(troque|trocar|substitua|substituir|monte|crie|gere|adapte|quero outra|nao tenho)\b/u.test(
      text,
    )
  )
    return false;
  return (
    /\b(?:qual|quais|o que|mostre|perguntei)\b/u.test(text) &&
    /\b(?:almoco|jantar|cafe da manha|lanche|ceia|proxima refeicao|refeicao vem depois|como agora|comer agora)\b/u.test(
      text,
    )
  );
}
export type DailyQuery = Readonly<{
  kind: 'CONSUMPTION' | 'EXPENDITURE';
  period: ConsumptionPeriod;
  metric: DailyMetric;
}>;
export function dailyQuery(value: string): DailyQuery | null {
  const text = foldDailyText(value);
  if (
    !/^(?:quanto|quantas|quantos|qual|quais|mostre|calorias (?:consumidas|gast|queim)|consumo)\b/u.test(
      text,
    )
  )
    return null;
  // A read must never authorize a mutation, or silently reinterpret another date.
  if (
    /\b(troque|substitua|crie|gere|monte|adapte|ontem|amanha|passada|ultima)\b/u.test(
      text,
    )
  )
    return null;
  const period = /\b(?:essa|esta|nessa|nesta) semana\b/u.test(text)
    ? 'THIS_WEEK'
    : 'TODAY';
  const metric = /\bproteina\b/u.test(text)
    ? 'PROTEIN'
    : /\bcarboidratos?\b/u.test(text)
      ? 'CARBS'
      : /\b(?:gordura|gorduras|lipidios)\b/u.test(text)
        ? 'FAT'
        : /\bcalorias?\b/u.test(text)
          ? 'CALORIES'
          : 'ALL';
  if (
    /\b(gastei|queimei|gasto calorico|calorias gastas|calorias queimadas)\b/u.test(
      text,
    )
  )
    return { kind: 'EXPENDITURE', period, metric };
  if (/\b(consumi|comi|ingeri|consumido|consumidas|ingeridas)\b/u.test(text))
    return { kind: 'CONSUMPTION', period, metric };
  return null;
}
export function isWeeklyFollowUp(value: string): boolean {
  return /^e (?:essa|esta|nesta) semana$/u.test(foldDailyText(value));
}
export function metricFollowUp(
  value: string,
): Exclude<DailyMetric, 'ALL'> | null {
  const text = foldDailyText(value);
  if (/^e (?:a )?proteina$/u.test(text)) return 'PROTEIN';
  if (/^e (?:os )?carboidratos?$/u.test(text)) return 'CARBS';
  if (/^e (?:as )?gorduras?$/u.test(text)) return 'FAT';
  if (/^e (?:as )?calorias?$/u.test(text)) return 'CALORIES';
  return null;
}
export function isIsolatedReminderReply(value: string): boolean {
  return /^(?:sim|nao|ok|feito|ja fiz|fiz|ja treinei|treinei|ja comi|comi|terminei|conclui|nao fiz|nao consegui(?: hoje)?|nao deu|pulei|nao treinei|nao comi|vou fazer (?:agora|depois|mais tarde)|depois eu faco|faco mais tarde|comi outra coisa)$/u.test(
    foldDailyText(value),
  );
}
export const UNCORRELATED_REPLY =
  'Não consegui identificar a que sua resposta se refere. Você está falando de uma refeição, de um treino ou de outra mensagem?';
