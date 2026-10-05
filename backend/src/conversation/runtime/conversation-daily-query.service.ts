import { Injectable } from '@nestjs/common';
import { MessageDirection, MessageType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CurrentNutritionPlanReaderService } from '../../diet/current-nutrition-plan-reader.service';
import type { NutritionPlanMeal } from '../../diet/v2/nutrition-plan-v2.contract';
import { CoachProactiveSchedulePolicy } from '../../automation/coach-proactive-schedule.policy';
import { NutritionConsumptionSummaryService } from '../../nutrition/nutrition-consumption-summary.service';
import {
  dailyQuery,
  foldDailyText,
  isDailyMealRequest,
  isWeeklyFollowUp,
  metricFollowUp,
} from '../understanding/daily-query.policy';

const DAY_LABELS = [
  'domingo',
  'segunda',
  'terca',
  'quarta',
  'quinta',
  'sexta',
  'sabado',
] as const;

@Injectable()
export class ConversationDailyQueryService {
  private readonly clock = new CoachProactiveSchedulePolicy();
  constructor(
    private readonly prisma: PrismaService,
    private readonly consumption: NutritionConsumptionSummaryService,
    private readonly nutrition: CurrentNutritionPlanReaderService,
  ) {}

  accepts(text: string): boolean {
    return (
      dailyQuery(text) !== null ||
      isWeeklyFollowUp(text) ||
      metricFollowUp(text) !== null ||
      isDailyMealRequest(text)
    );
  }

  async answer(input: {
    userId: string;
    conversationId: string;
    messageId: string;
    text: string;
    referenceDate: Date;
  }): Promise<string | null> {
    const text = foldDailyText(input.text);
    let query = dailyQuery(text);
    const metric = metricFollowUp(text);
    if (isWeeklyFollowUp(text) || metric) {
      const previous = await this.prisma.message.findFirst({
        where: {
          conversationId: input.conversationId,
          conversation: { userId: input.userId },
          id: { not: input.messageId },
          direction: MessageDirection.INBOUND,
          type: MessageType.TEXT,
          timestamp: { lt: input.referenceDate },
        },
        select: {
          content: true,
          timestamp: true,
          conversation: { select: { id: true, userId: true } },
        },
        orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
      });
      const antecedent =
        previous &&
        previous.conversation.userId === input.userId &&
        previous.conversation.id === input.conversationId &&
        previous.timestamp < input.referenceDate
          ? dailyQuery(previous.content)
          : null;
      if (!antecedent)
        return metric
          ? 'Você quer consultar essa quantidade consumida hoje ou nesta semana?'
          : 'Você quer consultar esta semana sobre qual informação: alimentação registrada ou outra coisa?';
      if (metric && antecedent.kind !== 'CONSUMPTION')
        return 'Você quer consultar essa quantidade na alimentação registrada hoje ou nesta semana?';
      query = {
        ...antecedent,
        ...(metric ? { metric } : { period: 'THIS_WEEK' as const }),
      };
    }
    if (query?.kind === 'EXPENDITURE') {
      return `Consigo acompanhar a alimentação que você registrou, mas ainda não tenho uma fonte confiável dos seus gastos calóricos reais ${query.period === 'TODAY' ? 'de hoje' : 'desta semana'}.`;
    }
    if (!query && !isDailyMealRequest(text)) return null;
    try {
      const preferences = await this.prisma.userPreferences.findUnique({
        where: { userId: input.userId },
        select: { timezone: true, userId: true },
      });
      if (
        preferences &&
        preferences.userId !== undefined &&
        preferences.userId !== input.userId
      )
        throw new Error('Preferences ownership mismatch');
      const timezone = this.clock.timezone(preferences?.timezone);
      if (query) {
        const summary = await this.consumption.summarize({
          userId: input.userId,
          period: query.period,
          referenceDate: input.referenceDate,
          timezone,
        });
        if (summary.mealCount === 0)
          return `Ainda não há refeições com análise nutricional registrada ${query.period === 'TODAY' ? 'hoje' : 'nesta semana'}. Sem essa análise, não consigo informar seu consumo de calorias e nutrientes.`;
        const number = (value: number | null, unit: string) =>
          value === null
            ? 'valor incompleto'
            : `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(value)} ${unit}`;
        const values =
          query.metric === 'PROTEIN'
            ? `proteína: ${number(summary.protein, 'g')}`
            : query.metric === 'CARBS'
              ? `carboidratos: ${number(summary.carbs, 'g')}`
              : query.metric === 'FAT'
                ? `gorduras: ${number(summary.fat, 'g')}`
                : query.metric === 'CALORIES'
                  ? number(summary.calories, 'kcal')
                  : `${number(summary.calories, 'kcal')}; proteína: ${number(summary.protein, 'g')}; carboidratos: ${number(summary.carbs, 'g')}; gorduras: ${number(summary.fat, 'g')}`;
        return `Com base nas ${summary.mealCount} refeições que você registrou e foram analisadas ${query.period === 'TODAY' ? 'hoje' : 'nesta semana'}: ${values}. Isso inclui somente as refeições registradas.`;
      }
      return await this.meal(input.userId, text, input.referenceDate, timezone);
    } catch {
      return 'Não consegui consultar essas informações com segurança agora. Tente novamente em instantes.';
    }
  }

  private async meal(
    userId: string,
    text: string,
    at: Date,
    timezone: string,
  ): Promise<string> {
    const current = await this.nutrition.getCurrent(userId);
    if (!current) return 'Você ainda não possui um plano alimentar ativo.';
    if (current.userId !== userId)
      return 'Não consegui consultar seu plano com segurança agora.';
    if (current.implementation === 'LEGACY') {
      const matches = current.meals.filter((meal) =>
        text.includes(foldDailyText(meal.name)),
      );
      if (matches.length === 1 && !/\b(proxima|agora|depois)\b/u.test(text))
        return `Seu plano não tem calendário por dia. No plano atual, *${matches[0].name}*: ${matches[0].items.map((item) => `${item.quantity} de ${item.foodName}`).join(', ')}.`;
      return 'Seu plano alimentar atual não tem um calendário de refeições confirmado. Qual refeição você quer consultar pelo nome?';
    }
    const parts = this.clock.parts(at, timezone);
    const weekday = new Date(
      Date.UTC(parts.year, parts.month - 1, parts.day),
    ).getUTCDay();
    // dayNumber is sequence, not weekday. Only explicit weekday labels or a
    // single DAILY_STRUCTURE define a safe mapping in the existing contract.
    const labelled = current.document.days.filter(
      (day) =>
        foldDailyText(day.label).replace(/ feira$/u, '') ===
        DAY_LABELS[weekday],
    );
    const day =
      labelled.length === 1
        ? labelled[0]
        : current.document.artifactType === 'DAILY_STRUCTURE' &&
            current.document.days.length === 1
          ? current.document.days[0]
          : null;
    if (!day)
      return 'Seu plano não identifica com segurança qual estrutura corresponde a hoje. Qual dia ou estrutura do plano você quer consultar?';
    const next =
      /\b(?:proxima refeicao|refeicao vem depois|como agora|comer agora)\b/u.test(
        text,
      );
    if (next) {
      if (day.meals.some((meal) => this.minute(meal.suggestedTime) === null))
        return `Os horários de hoje não estão completos. As refeições disponíveis são ${day.meals.map((meal) => meal.name).join(', ')}. Qual delas você quer consultar?`;
      const minute = parts.hour * 60 + parts.minute;
      const resolvedPeriods = await this.resolvedMealPeriods(
        userId,
        at,
        timezone,
      );
      if (
        [...resolvedPeriods].some(
          (period) =>
            day.meals.filter((meal) => meal.period === period).length > 1,
        )
      )
        return 'Há mais de uma refeição desse tipo no plano de hoje. Qual delas você já fez?';
      const future = day.meals
        .filter(
          (meal) =>
            !resolvedPeriods.has(meal.period) &&
            this.minute(meal.suggestedTime) !== null &&
            (this.minute(meal.suggestedTime) ?? -1) >= minute,
        )
        .sort(
          (a, b) =>
            (this.minute(a.suggestedTime) ?? 0) -
            (this.minute(b.suggestedTime) ?? 0),
        );
      if (!future.length) {
        const tomorrowLabels = current.document.days.filter(
          (candidate) =>
            foldDailyText(candidate.label).replace(/ feira$/u, '') ===
            DAY_LABELS[(weekday + 1) % 7],
        );
        const tomorrow =
          tomorrowLabels.length === 1
            ? tomorrowLabels[0]
            : current.document.artifactType === 'DAILY_STRUCTURE' &&
                current.document.days.length === 1
              ? day
              : null;
        if (
          tomorrow &&
          tomorrow.meals.length > 0 &&
          tomorrow.meals.every(
            (meal) => this.minute(meal.suggestedTime) !== null,
          )
        ) {
          const ordered = [...tomorrow.meals].sort(
            (a, b) =>
              (this.minute(a.suggestedTime) ?? 0) -
              (this.minute(b.suggestedTime) ?? 0),
          );
          if (
            ordered.length === 1 ||
            ordered[0].suggestedTime !== ordered[1].suggestedTime
          )
            return `A próxima refeição programada é amanhã: ${this.formatMeal(ordered[0])}`;
        }
        return 'As refeições programadas de hoje já passaram. Posso mostrar a estrutura de hoje pelo nome da refeição.';
      }
      if (
        future.length > 1 &&
        future[0].suggestedTime === future[1].suggestedTime
      )
        return 'Há mais de uma refeição no próximo horário do plano. Qual delas você quer consultar?';
      return this.formatMeal(future[0]);
    }
    const periods: NutritionPlanMeal['period'][] = /\balmoco\b/u.test(text)
      ? ['LUNCH']
      : /\bjantar\b/u.test(text)
        ? ['DINNER']
        : /\bcafe da manha\b/u.test(text)
          ? ['BREAKFAST']
          : /\bceia\b/u.test(text)
            ? ['EVENING_SNACK']
            : ['MORNING_SNACK', 'AFTERNOON_SNACK'];
    const matches = day.meals.filter((meal) => periods.includes(meal.period));
    return matches.length === 1
      ? this.formatMeal(matches[0])
      : 'Não há uma única refeição correspondente a esse pedido no dia selecionado. Qual nome de refeição aparece no seu plano?';
  }

  /** Reminder adherence is not observed nutrition. Only a unique meal period
   * on this local day can remove a scheduled meal from the next-meal list. */
  private async resolvedMealPeriods(
    userId: string,
    at: Date,
    timezone: string,
  ): Promise<ReadonlySet<NutritionPlanMeal['period']>> {
    const range = this.clock.localDayRange(at, timezone);
    const reminders = await this.prisma.scheduledMessage.findMany({
      where: {
        userId,
        status: 'SENT',
        scheduledFor: { gte: range.start, lt: range.end, lte: at },
        respondedAt: { lte: at },
        responseOutcome: { in: ['COMPLETED', 'PARTIAL', 'SKIPPED'] },
        context: { path: ['source'], equals: 'COACH_PROACTIVE_V1' },
      },
      select: {
        userId: true,
        conversationId: true,
        conversation: { select: { id: true, userId: true } },
        status: true,
        scheduledFor: true,
        respondedAt: true,
        responseOutcome: true,
        context: true,
      },
      orderBy: [{ respondedAt: 'desc' }, { id: 'desc' }],
    });
    const resolved = new Set<NutritionPlanMeal['period']>();
    for (const reminder of reminders) {
      if (
        reminder.userId !== userId ||
        reminder.conversation?.userId !== userId ||
        reminder.conversation.id !== reminder.conversationId ||
        reminder.status !== 'SENT' ||
        reminder.scheduledFor < range.start ||
        reminder.scheduledFor >= range.end ||
        reminder.scheduledFor > at ||
        !reminder.respondedAt ||
        reminder.respondedAt < reminder.scheduledFor ||
        reminder.respondedAt > at ||
        !['COMPLETED', 'PARTIAL', 'SKIPPED'].includes(
          reminder.responseOutcome ?? '',
        ) ||
        !reminder.context ||
        typeof reminder.context !== 'object' ||
        Array.isArray(reminder.context) ||
        reminder.context.source !== 'COACH_PROACTIVE_V1'
      )
        continue;
      if (reminder.context.intent === 'LUNCH_CHECK') resolved.add('LUNCH');
      if (reminder.context.intent === 'DINNER_CHECK') resolved.add('DINNER');
    }
    return resolved;
  }

  private minute(value: string | null): number | null {
    if (!value || !/^\d{2}:\d{2}$/u.test(value)) return null;
    const [hour, minute] = value.split(':').map(Number);
    return hour <= 23 && minute <= 59 ? hour * 60 + minute : null;
  }
  private formatMeal(meal: NutritionPlanMeal): string {
    return `*${meal.name}*${meal.suggestedTime ? ` (${meal.suggestedTime})` : ''}: ${meal.items.map((item) => `${item.quantity} de ${item.foodName}`).join(', ')}.`;
  }
}
