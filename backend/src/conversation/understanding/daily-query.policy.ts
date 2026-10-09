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
/** A nutrition metric owns its domain even when its date/operation needs QA. */
export function isNutritionMetricTopic(value: string): boolean {
  if (isWorkoutExpenditureTopic(value)) return false;
  return /\b(?:calorias?|caloric[ao]s?|proteinas?|carboidratos?|gorduras?|macros|macronutrientes)\b/u.test(
    foldDailyText(value),
  );
}
/** Expenditure belongs to activity; a calorie unit alone is not food intake. */
export function isWorkoutExpenditureTopic(value: string): boolean {
  const text = foldDailyText(value);
  return (
    /\b(?:calorias?|caloric[ao]s?|gasto energetico)\b/u.test(text) &&
    /\b(?:gast\w*|queim\w*|energetico)\b/u.test(text) &&
    /\b(?:treinos?|exercicios?|sessoes?|sessao|academia|musculacao|corrida|caminhada|atividade fisica)\b/u.test(
      text,
    ) &&
    !/\b(?:consumi|consumo|ingeri|ingeridas|comi|comer|refeicao|dieta)\b/u.test(
      text,
    )
  );
}
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
  kind: 'CONSUMPTION' | 'EXPENDITURE' | 'TARGET' | 'COMPARISON';
  period: ConsumptionPeriod;
  metric: DailyMetric;
}>;
export function dailyQuery(value: string): DailyQuery | null {
  if (isWorkoutExpenditureTopic(value)) return null;
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
  const period = /\b(?:semana|semanal)\b/u.test(text) ? 'THIS_WEEK' : 'TODAY';
  const metric =
    /\b(?:macros|macronutrientes)\b/u.test(text) ||
    [
      /\bproteinas?\b/u,
      /\bcarboidratos?\b/u,
      /\b(?:gorduras?|lipidios)\b/u,
      /\b(?:calorias?|caloric[ao]s?)\b/u,
    ].filter((pattern) => pattern.test(text)).length > 1
      ? 'ALL'
      : /\bproteinas?\b/u.test(text)
        ? 'PROTEIN'
        : /\bcarboidratos?\b/u.test(text)
          ? 'CARBS'
          : /\b(?:gordura|gorduras|lipidios)\b/u.test(text)
            ? 'FAT'
            : /\b(?:calorias?|caloric[ao]s?)\b/u.test(text)
              ? 'CALORIES'
              : 'ALL';
  if (
    /\b(gastei|queimei|gasto calorico|calorias gastas|calorias queimadas)\b/u.test(
      text,
    )
  )
    return { kind: 'EXPENDITURE', period, metric };
  const target =
    /\b(?:metas?|objetivo calorico)\b/u.test(text) &&
    isNutritionMetricTopic(text);
  if (target)
    return {
      kind: /\b(?:consumi|comi|ingeri|consumo|consumido|consumidas|ingeridas)\b/u.test(
        text,
      )
        ? 'COMPARISON'
        : 'TARGET',
      period,
      metric,
    };
  if (
    /\b(consumi|comi|ingeri|consumo|consumido|consumidas|ingeridas)\b/u.test(
      text,
    )
  )
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
