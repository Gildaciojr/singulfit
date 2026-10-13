import { UsageService } from '../../usage/usage.service';
import { NutritionIntakeLedgerService } from '../../nutrition/nutrition-intake-ledger.service';
import { COMMERCIAL_USAGE_ENTITLEMENTS } from '../../entitlements/entitlement.constants';
import { ConversationOperationResolverService } from '../understanding/conversation-operation-resolver.service';
import { Injectable, Optional } from '@nestjs/common';
import { ConversationSafetyDetectorService } from '../understanding/conversation-safety-detector.service';
import { ConversationMessageNormalizerService } from '../understanding/conversation-message-normalizer.service';
import { MessageDirection, MessageType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CurrentNutritionPlanReaderService } from '../../diet/current-nutrition-plan-reader.service';
import type { NutritionPlanMeal } from '../../diet/v2/nutrition-plan-v2.contract';
import type { CurrentNutritionPlan } from '../../diet/current-nutrition-plan-reader.contract';
import { CoachProactiveSchedulePolicy } from '../../automation/coach-proactive-schedule.policy';
import { NutritionConsumptionSummaryService } from '../../nutrition/nutrition-consumption-summary.service';
import {
  dailyQuery,
  foldDailyText,
  isDailyMealRequest,
  isNutritionMetricTopic,
  isWorkoutExpenditureTopic,
  isWeeklyFollowUp,
  metricFollowUp,
  type DailyQuery,
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
    @Optional() private readonly commercialUsage?: UsageService,
    @Optional() private readonly intakeLedger?: NutritionIntakeLedgerService,
  ) {}

  accepts(text: string): boolean {
    return (
      this.acceptsCommercialBalance(text) ||
      (Boolean(this.intakeLedger) && this.isWaterLedgerQuery(text)) ||
      this.historicalQuery(text) !== null ||
      dailyQuery(text) !== null ||
      isWeeklyFollowUp(text) ||
      metricFollowUp(text) !== null ||
      isDailyMealRequest(text)
    );
  }

  private historicalQuery(text: string): DailyQuery | null {
    const folded = foldDailyText(text);
    if (!/\b(ontem|semana passada|comparar|compare)\b/u.test(folded))
      return null;
    return dailyQuery(
      folded
        .replace(/\bontem\b/gu, 'hoje')
        .replace(/\bsemana passada\b/gu, 'esta semana')
        .replace(/^(?:compare|comparar)\s+/u, 'mostre '),
    );
  }

  private async historicalAnswer(
    input: {
      userId: string;
      conversationId: string;
      messageId: string;
      text: string;
      referenceDate: Date;
    },
    query: DailyQuery,
  ): Promise<string | null> {
    const source = await this.prisma.message.findFirst({
      where: {
        id: input.messageId,
        conversationId: input.conversationId,
        direction: MessageDirection.INBOUND,
        type: MessageType.TEXT,
        conversation: { userId: input.userId },
      },
      select: { id: true },
    });
    if (!source) return null;
    const preferences = await this.prisma.userPreferences.findUnique({
      where: { userId: input.userId },
      select: { userId: true, timezone: true },
    });
    if (
      preferences &&
      preferences.userId !== undefined &&
      preferences.userId !== input.userId
    )
      return null;
    const timezone = this.clock.timezone(preferences?.timezone);
    const text = foldDailyText(input.text);
    const previous = new Date(
      (query.period === 'THIS_WEEK'
        ? this.clock.localWeekRange(input.referenceDate, timezone)
        : this.clock.localDayRange(input.referenceDate, timezone)
      ).start.getTime() - 1,
    );
    const compare = /\b(compare|comparar)\b/u.test(text);
    const dates = compare ? [previous, input.referenceDate] : [previous];
    const number = (value: number | null, unit: string) =>
      value === null
        ? 'incompleto'
        : `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(value)} ${unit}`;
    const replies: string[] = [];
    for (const at of dates) {
      const summary = await this.consumption.summarize({
        userId: input.userId,
        period: query.period,
        referenceDate: at,
        timezone,
        confirmedOnly: true,
        knownAt: input.referenceDate,
      });
      const label = `${summary.periodStart.toLocaleDateString('pt-BR', { timeZone: timezone })} a ${at.toLocaleDateString('pt-BR', { timeZone: timezone })}`;
      let target = '';
      if (query.kind === 'TARGET' || query.kind === 'COMPARISON') {
        if (query.period === 'THIS_WEEK')
          target =
            'As metas semanais dependem das versões aplicáveis a cada dia; não multipliquei a meta atual por sete.';
        else {
          const plan = await this.nutrition.getApplicableAt(input.userId, at);
          if (plan && plan.userId !== input.userId) return null;
          const values = plan ? this.targetValues(plan) : null;
          target = values
            ? `Meta planejada nessa data: ${number(values.calories, 'kcal')}; proteína ${number(values.protein, 'g')}, carboidratos ${number(values.carbs, 'g')}, gordura ${number(values.fat, 'g')}.`
            : 'Não há versão de meta comprovada nessa data.';
        }
      }
      replies.push(
        `${label}: ${summary.mealCount} refeições registradas. ${summary.mealCount ? `Estimativas: ${number(summary.calories, 'kcal')}; proteína ${number(summary.protein, 'g')}, carboidratos ${number(summary.carbs, 'g')}, gordura ${number(summary.fat, 'g')}.` : 'Sem registro, não concluo ausência de consumo.'} ${target}`.trim(),
      );
    }
    return `${replies.join('\n')} Os registros não comprovam o consumo total nem adesão ao plano.`;
  }

  acceptsCommercialBalance(text: string): boolean {
    return Boolean(this.commercialUsage) && this.isBalanceQuestion(text);
  }

  private isWaterLedgerQuery(text: string): boolean {
    const value = foldDailyText(text);
    return (
      /\b(agua|hidratacao)\b/u.test(value) &&
      /\b(quanto|quantos|quantidade|total)\b/u.test(value) &&
      /\b(bebi|bebido|tomei|consumi|ingeri|falta|registrad\w*)\b/u.test(value)
    );
  }

  private isBalanceQuestion(value: string): boolean {
    const message = new ConversationMessageNormalizerService().normalize(value);
    if (
      isNutritionMetricTopic(value) ||
      isWorkoutExpenditureTopic(value) ||
      !message.question ||
      !(
        /\b(saldo|cotas?|usos?|renovacao)\b/u.test(message.folded) ||
        (/\blimites?\b/u.test(message.folded) &&
          /\b(assinatura|ciclo|audios?|fotos?|geracoes?|transcricoes?)\b/u.test(
            message.folded,
          ))
      ) ||
      !/\b(plano|assinatura|ciclo|audios?|fotos?|geracoes?|transcricoes?)\b/u.test(
        message.folded,
      )
    )
      return false;
    const resolution = new ConversationOperationResolverService().resolve(
      {
        continuity: {
          currentLogicalTurn: 0,
          activeProfileField: null,
          pendingConfirmation: false,
          targetPlan: null,
        },
      },
      message,
    );
    if (
      resolution.candidates.some(
        (operation) =>
          operation === 'GENERATE_PLAN' ||
          operation === 'UPDATE_PLAN' ||
          operation === 'SUBSTITUTE_ITEM' ||
          operation === 'REQUEST_CONFIRMATION',
      )
    )
      return false;
    const operation = resolution.operation;
    return (
      operation === 'PROVIDE_GUIDANCE' ||
      operation === 'ANSWER' ||
      operation === 'PRESENT_CURRENT_PLAN' ||
      operation === 'PRESENT_PLAN_STATUS'
    );
  }

  async answer(input: {
    userId: string;
    conversationId: string;
    messageId: string;
    text: string;
    referenceDate: Date;
  }): Promise<string | null> {
    if (
      new ConversationSafetyDetectorService().detect(
        new ConversationMessageNormalizerService().normalize(input.text),
      ).safety.requiresSafeResponse
    )
      return null;
    const historical = this.historicalQuery(input.text);
    if (historical) {
      try {
        return await this.historicalAnswer(input, historical);
      } catch {
        return 'Não consegui consultar os registros históricos com segurança agora.';
      }
    }
    if (this.intakeLedger && this.isWaterLedgerQuery(input.text)) {
      const source = await this.prisma.message.findFirst({
        where: {
          id: input.messageId,
          conversationId: input.conversationId,
          direction: 'INBOUND',
          type: 'TEXT',
          conversation: { userId: input.userId },
        },
        select: {
          conversation: {
            select: {
              user: { select: { preferences: { select: { timezone: true } } } },
            },
          },
        },
      });
      if (!source) return null;
      const result = await this.intakeLedger.water(
        input.userId,
        input.referenceDate,
        source.conversation.user.preferences?.timezone,
      );
      const amount =
        result.volumeMl === null
          ? 'Ainda não há volume de água registrado hoje.'
          : `Pelos volumes que você informou, há ${new Intl.NumberFormat('pt-BR').format(result.volumeMl)} ml de água registrados hoje.`;
      if (/\bsemana\b/u.test(foldDailyText(input.text))) {
        const days = await this.intakeLedger.waterWeek(
          input.userId,
          input.referenceDate,
          source.conversation.user.preferences?.timezone,
        );
        return (
          days
            .filter((day) => day.recordCount > 0)
            .map(
              (day) =>
                `${day.date.toLocaleDateString('pt-BR', { timeZone: source.conversation.user.preferences?.timezone ?? 'America/Sao_Paulo' })}: ${day.volumeMl} ml informados.`,
            )
            .join('\n') ||
          'Ainda não há volumes de água registrados nessa semana.'
        );
      }
      if (/\b(meta|falta)\b/u.test(foldDailyText(input.text))) {
        const goal = await this.intakeLedger.goal(
          input.userId,
          input.referenceDate,
        );
        return goal?.volumeMl && result.volumeMl !== null
          ? `${amount} Sua meta informada é ${goal.volumeMl} ml; a diferença dos registros é ${Math.max(0, goal.volumeMl - result.volumeMl)} ml. Não compense volumes de uma vez.`
          : `${amount} Não tenho meta e consumo suficientes registrados para calcular quanto falta.`;
      }
      return amount;
    }
    const commercialUsage = this.commercialUsage;
    if (commercialUsage && this.isBalanceQuestion(input.text)) {
      const source = await this.prisma.message.findFirst({
        where: {
          id: input.messageId,
          conversationId: input.conversationId,
          direction: MessageDirection.INBOUND,
          conversation: { userId: input.userId },
        },
        select: { id: true },
      });
      if (!source) return null;
      try {
        const balances = await Promise.all(
          COMMERCIAL_USAGE_ENTITLEMENTS.map((code) =>
            commercialUsage.commercialBalance(
              input.userId,
              code,
              input.referenceDate,
            ),
          ),
        );
        const labels = {
          NUTRITION_PLAN_GENERATION: 'Planos alimentares',
          WORKOUT_PLAN_GENERATION: 'Planos de treino',
          IMAGE_ANALYSIS: 'Fotos',
          AUDIO_TRANSCRIPTION: 'Áudios',
        };
        return balances
          .map(
            (balance) =>
              `${labels[balance.code]}: ${balance.unlimited ? 'sem limite configurado' : `${balance.remaining} disponíveis de ${balance.limit} neste ciclo`}. Renova em ${balance.renewsAt.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}.`,
          )
          .join('\n');
      } catch {
        return 'Não consegui consultar os usos disponíveis do seu plano agora. Seu saldo não foi alterado.';
      }
    }
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
      if (metric && antecedent.kind === 'EXPENDITURE')
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
      if (query?.kind === 'TARGET' || query?.kind === 'COMPARISON')
        return await this.target(input, query, timezone);
      if (query) {
        const summary = await this.consumption.summarize({
          userId: input.userId,
          period: query.period,
          referenceDate: input.referenceDate,
          timezone,
          confirmedOnly: true,
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

  /** Targets are stored strategy values; item estimates and observed intake
   * cannot create a missing target or an unconfirmed weekly calendar. */
  private async target(
    input: { userId: string; referenceDate: Date },
    query: DailyQuery,
    timezone: string,
  ): Promise<string> {
    const current = await this.nutrition.getCurrent(input.userId);
    if (!current)
      return 'Você ainda não tem uma meta registrada em um plano alimentar ativo.';
    if (current.userId !== input.userId)
      throw new Error('Plan ownership mismatch');
    const values = this.targetValues(current);
    const selected =
      query.metric === 'PROTEIN'
        ? values.protein
        : query.metric === 'CARBS'
          ? values.carbs
          : query.metric === 'FAT'
            ? values.fat
            : values.calories;
    if (selected === null || !Number.isFinite(selected) || selected <= 0)
      return 'Essa meta não está disponível no seu plano atual. Não vou estimá-la como se estivesse registrada.';
    const label =
      query.metric === 'PROTEIN'
        ? 'proteína'
        : query.metric === 'CARBS'
          ? 'carboidratos'
          : query.metric === 'FAT'
            ? 'gorduras'
            : 'calorias';
    const unit =
      query.metric === 'CALORIES' || query.metric === 'ALL' ? 'kcal' : 'g';
    const number = (value: number) =>
      new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(
        value,
      );
    let multiplier = 1;
    if (query.period === 'THIS_WEEK') {
      if (
        current.implementation !== 'V2' ||
        current.document.artifactType !== 'WEEKLY_PLAN'
      )
        return `Sua meta diária de ${label} é ${number(selected)} ${unit}. O plano não confirma um calendário semanal; não posso multiplicá-la por sete como uma meta semanal registrada.`;
      const labels = current.document.days.map((day) =>
        foldDailyText(day.label).replace(/ feira$/u, ''),
      );
      if (
        labels.length !== 7 ||
        new Set(labels).size !== 7 ||
        !DAY_LABELS.every((day) => labels.includes(day)) ||
        current.document.strategy.dayCount !== 7
      )
        return `Sua meta diária de ${label} é ${number(selected)} ${unit}. O plano não identifica os sete dias desta semana; não há uma meta semanal completa confirmada.`;
      multiplier = labels.length;
    }
    const target = selected * multiplier;
    const all =
      query.metric === 'ALL'
        ? ` Proteína: ${values.protein === null ? 'não disponível' : `${number(values.protein * multiplier)} g`}; carboidratos: ${values.carbs === null ? 'não disponíveis' : `${number(values.carbs * multiplier)} g`}; gorduras: ${values.fat === null ? 'não disponíveis' : `${number(values.fat * multiplier)} g`}.`
        : '';
    const provenance =
      current.implementation === 'V2'
        ? ' (estimativa da estratégia do plano)'
        : '';
    const answer = `Sua meta ${multiplier === 1 ? 'diária' : 'para os sete dias da semana'} de ${label} no plano atual é ${number(target)} ${unit}${multiplier > 1 ? ` (${number(selected)} ${unit} por dia)` : ''}${provenance}.${all}`;
    if (query.kind !== 'COMPARISON') return answer;
    const summary = await this.consumption.summarize({
      userId: input.userId,
      referenceDate: input.referenceDate,
      period: query.period,
      timezone,
      confirmedOnly: true,
    });
    const consumed =
      query.metric === 'PROTEIN'
        ? summary.protein
        : query.metric === 'CARBS'
          ? summary.carbs
          : query.metric === 'FAT'
            ? summary.fat
            : summary.calories;
    if (!summary.mealCount || consumed === null)
      return `${answer} O consumo analisado está ausente ou incompleto; não dá para compará-lo com a meta.`;
    return `${answer} Nas ${summary.mealCount} refeições registradas e analisadas ${query.period === 'TODAY' ? 'hoje' : 'nesta semana'}, constam ${number(consumed)} ${unit}, cerca de ${number((100 * consumed) / target)}% da meta. Isso não comprova seu consumo total nem indica quanto você deve compensar.`;
  }

  private targetValues(current: CurrentNutritionPlan) {
    if (current.implementation === 'LEGACY')
      return {
        calories: current.dailyCaloriesTarget,
        protein: current.proteinTarget,
        carbs: current.carbsTarget,
        fat: current.fatTarget,
      };
    const strategy = current.document.strategy;
    const macros =
      'value' in strategy.macroTargets ? strategy.macroTargets.value : null;
    return {
      calories:
        'value' in strategy.energyTargetKcal
          ? strategy.energyTargetKcal.value
          : null,
      protein: macros?.proteinGrams ?? null,
      carbs: macros?.carbohydrateGrams ?? null,
      fat: macros?.fatGrams ?? null,
    };
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
            : /\blanche da tarde\b/u.test(text)
              ? ['AFTERNOON_SNACK']
              : /\blanche da manha\b/u.test(text)
                ? ['MORNING_SNACK']
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
