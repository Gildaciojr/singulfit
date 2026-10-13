import { isUUID } from 'class-validator';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NutritionConsumptionSummaryService } from '../nutrition/nutrition-consumption-summary.service';
import { CurrentNutritionPlanReaderService } from '../diet/current-nutrition-plan-reader.service';
import { CoachProactiveSchedulePolicy } from './coach-proactive-schedule.policy';
import { hydrationTotal } from '../nutrition/nutrition-intake-evidence.policy';

/** Independent factual-weekly rollout. Malformed configuration always fails closed. */
export function weeklyReportEnabled(
  userId: string,
  mode: unknown = 'OFF',
  allowlist: unknown = '',
  globalAuthorized: unknown = 'false',
): boolean {
  if (
    !isUUID(userId) ||
    typeof mode !== 'string' ||
    typeof allowlist !== 'string' ||
    typeof globalAuthorized !== 'string'
  )
    return false;
  const selected = mode.trim();
  const global = globalAuthorized.trim();
  if (
    !['OFF', 'CANARY', 'GLOBAL'].includes(selected) ||
    !['true', 'false'].includes(global)
  )
    return false;
  const ids = allowlist.trim()
    ? allowlist.split(',').map((id) => id.trim().toLowerCase())
    : [];
  if (ids.some((id) => !isUUID(id))) return false;
  if (selected === 'CANARY') return ids.includes(userId.toLowerCase());
  return selected === 'GLOBAL' && global === 'true';
}

export interface CoachWeeklySnapshot {
  readonly version: 1;
  readonly userId: string;
  readonly start: string;
  readonly cutoff: string;
  readonly timezone: string;
  readonly name: string | null;
  readonly meals: number;
  readonly incompleteMeals: number;
  readonly calories: number | null;
  readonly protein: number | null;
  readonly carbs: number | null;
  readonly fat: number | null;
  readonly hydration: readonly {
    date: string;
    volumeMl: number | null;
    goalMl?: number | null;
  }[];
  readonly confirmedWorkoutReports: number;
  readonly weights: readonly { at: string; kg: number }[];
  readonly previous?: {
    meals: number;
    incompleteMeals: number;
    calories: number | null;
    protein: number | null;
    carbs: number | null;
    fat: number | null;
  };
  readonly targets: readonly {
    date: string;
    planId: string | null;
    calories: number | null;
  }[];
}

@Injectable()
export class CoachWeeklySnapshotService {
  private readonly clock = new CoachProactiveSchedulePolicy();
  constructor(
    private readonly prisma: PrismaService,
    private readonly consumption: NutritionConsumptionSummaryService,
    private readonly plans: CurrentNutritionPlanReaderService,
  ) {}

  async build(userId: string, cutoff: Date): Promise<CoachWeeklySnapshot> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { name: true, preferences: { select: { timezone: true } } },
    });
    const timezone = this.clock.timezone(user.preferences?.timezone);
    const range = this.clock.localWeekRange(cutoff, timezone);
    const [nutrition, water, workouts, weights] = await Promise.all([
      this.consumption.summarize({
        userId,
        period: 'THIS_WEEK',
        referenceDate: cutoff,
        timezone,
        confirmedOnly: true,
      }),
      this.prisma.nutritionIntakeRecord.findMany({
        where: {
          userId,
          kind: { in: ['WATER_ADD', 'WATER_TOTAL'] },
          OR: [{ voidedAt: null }, { voidedAt: { gt: cutoff } }],
          reportedAt: { lte: cutoff },
          occurredAt: { gte: range.start, lte: cutoff },
        },
        orderBy: [{ reportedAt: 'asc' }, { sourceMessageId: 'asc' }],
      }),
      this.prisma.coachMessage.findMany({
        where: {
          userId,
          generatedAt: { gte: range.start, lte: cutoff },
          AND: [
            { context: { path: ['canonicalIntent'], equals: 'WORKOUT' } },
            {
              context: {
                path: ['continuationEvidence', 'consumption'],
                equals: 'CONFIRMED',
              },
            },
          ],
        },
        select: { idempotencyKey: true },
      }),
      this.prisma.progressSnapshot.findMany({
        where: { userId, createdAt: { gte: range.start, lte: cutoff } },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true, weightKg: true },
      }),
    ]);
    const groups = new Map<string, typeof water>();
    for (const record of water) {
      const date = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
      }).format(record.occurredAt);
      groups.set(date, [...(groups.get(date) ?? []), record]);
    }
    const hydration = await Promise.all(
      [...groups].map(async ([date, records]) => {
        const end = this.clock.localDayRange(
          records[0].occurredAt,
          timezone,
        ).end;
        const goal = await this.prisma.nutritionIntakeRecord.findFirst({
          where: {
            userId,
            kind: 'WATER_GOAL',
            OR: [
              { voidedAt: null },
              {
                voidedAt: {
                  gt: new Date(Math.min(end.getTime() - 1, cutoff.getTime())),
                },
              },
            ],
            reportedAt: {
              lte: new Date(Math.min(end.getTime() - 1, cutoff.getTime())),
            },
          },
          orderBy: { reportedAt: 'desc' },
          select: { volumeMl: true },
        });
        return {
          date,
          volumeMl: hydrationTotal(records),
          goalMl: goal?.volumeMl ?? null,
        };
      }),
    );
    const targets: {
      date: string;
      planId: string | null;
      calories: number | null;
    }[] = [];
    let day = range.start;
    while (day <= cutoff) {
      const end = this.clock.localDayRange(day, timezone).end;
      const applicable = await this.plans.getApplicableAt(
        userId,
        new Date(Math.min(end.getTime() - 1, cutoff.getTime())),
      );
      const calories =
        applicable?.implementation === 'LEGACY'
          ? applicable.dailyCaloriesTarget
          : applicable &&
              applicable.document.strategy.energyTargetKcal.status !==
                'NOT_SET' &&
              applicable.document.strategy.energyTargetKcal.status !==
                'REQUIRES_CONFIRMATION'
            ? applicable.document.strategy.energyTargetKcal.value
            : null;
      targets.push({
        date: new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(
          day,
        ),
        planId: applicable?.id ?? null,
        calories,
      });
      day = end;
    }
    const previous = await this.consumption.summarize({
      userId,
      period: 'THIS_WEEK',
      referenceDate: new Date(range.start.getTime() - 1),
      knownAt: cutoff,
      timezone,
      confirmedOnly: true,
    });
    return {
      previous: {
        meals: previous.mealCount,
        incompleteMeals: previous.incompleteMealCount ?? 0,
        calories: previous.calories,
        protein: previous.protein,
        carbs: previous.carbs,
        fat: previous.fat,
      },
      version: 1,
      userId,
      start: range.start.toISOString(),
      cutoff: cutoff.toISOString(),
      timezone,
      name: user.name?.trim().split(/\s+/u, 1)[0] ?? null,
      meals: nutrition.mealCount,
      incompleteMeals: nutrition.incompleteMealCount ?? 0,
      calories: nutrition.calories,
      protein: nutrition.protein,
      carbs: nutrition.carbs,
      fat: nutrition.fat,
      hydration,
      confirmedWorkoutReports: new Set(
        workouts.map((record) => record.idempotencyKey),
      ).size,
      weights: weights
        .filter(
          (record) =>
            Number.isFinite(record.weightKg.toNumber()) &&
            record.weightKg.toNumber() > 0,
        )
        .map((record) => ({
          at: record.createdAt.toISOString(),
          kg: record.weightKg.toNumber(),
        })),
      targets,
    };
  }

  render(snapshot: CoachWeeklySnapshot, planType: string = 'PREMIUM'): string {
    const number = (value: number | null, unit: string) =>
      value === null
        ? 'dados incompletos'
        : `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(value)} ${unit}`;
    const date = (value: string) =>
      new Date(value).toLocaleDateString('pt-BR', {
        timeZone: snapshot.timezone,
      });
    const name = snapshot.name?.slice(0, 60);
    if (planType === 'BASIC') {
      const water = snapshot.hydration.reduce(
        (sum, day) => sum + (day.volumeMl ?? 0),
        0,
      );
      return [
        `${name ? `${name}, ` : ''}vamos olhar sua semana? 💚`,
        `*${date(snapshot.start)} a ${date(snapshot.cutoff)}*`,
        '',
        '*🥗 Alimentação*',
        `${snapshot.meals} refeições registradas; ${snapshot.incompleteMeals} com dados incompletos.`,
        snapshot.meals
          ? `Calorias estimadas nos registros: ${number(snapshot.calories, 'kcal')}.`
          : 'Ainda não há refeições registradas; isso não significa que você deixou de comer.',
        '',
        '*💧 Água e movimento*',
        snapshot.hydration.length
          ? `${number(water, 'ml')} informados em ${snapshot.hydration.length} dias.`
          : 'Sem volumes de água informados.',
        `${snapshot.confirmedWorkoutReports} relatos explícitos de treino concluído.`,
        '',
        snapshot.meals
          ? `O destaque foi você ter compartilhado ${snapshot.meals} refeições para acompanharmos juntos.`
          : snapshot.hydration.length
            ? 'Você compartilhou volumes de água para acompanharmos.'
            : snapshot.confirmedWorkoutReports
              ? 'Você compartilhou relatos de treino concluído.'
              : 'Ainda temos poucos registros para destacar fatos da semana.',
        'Na próxima semana, me conte como foram suas refeições e sua água quando puder. Sem culpa e sem compensações. 💚',
      ].join('\n');
    }
    const lines = [
      `${name ? `${name}, ` : ''}vamos olhar sua semana com calma? 💚`,
      `*${date(snapshot.start)} a ${date(snapshot.cutoff)}*`,
      '',
      '*🥗 Alimentação registrada*',
      `${snapshot.meals} refeições; ${snapshot.incompleteMeals} com dados incompletos.`,
      snapshot.meals
        ? `Calorias: ${number(snapshot.calories, 'kcal')}. Proteínas: ${number(snapshot.protein, 'g')}; carboidratos: ${number(snapshot.carbs, 'g')}; gorduras: ${number(snapshot.fat, 'g')}.`
        : 'Ainda não há refeições registradas nesse período.',
      'Os valores são estimativas dos registros, não o consumo total comprovado da semana.',
      '',
      '*💧 Água informada*',
    ];
    const targets = snapshot.targets.flatMap((target) =>
      target.calories !== null ? [target.calories] : [],
    );
    if (targets.length)
      lines.splice(
        lines.length - 2,
        0,
        `Metas planejadas nas versões disponíveis: ${number(Math.min(...targets), 'kcal')} a ${number(Math.max(...targets), 'kcal')} por dia (${targets.length} dias). Não são calorias consumidas.`,
      );
    if (snapshot.hydration.length) {
      const total = snapshot.hydration.reduce(
        (sum, day) => sum + (day.volumeMl ?? 0),
        0,
      );
      lines.push(
        `${number(total, 'ml')} informados em ${snapshot.hydration.length} dias.`,
      );
      const knownGoals = snapshot.hydration.filter(
        (day) =>
          day.goalMl !== null &&
          day.goalMl !== undefined &&
          day.volumeMl !== null,
      );
      lines.push(
        knownGoals.length
          ? `Há meta informada em ${knownGoals.length} dias com volumes; os registros atingem essa referência em ${knownGoals.filter((day) => day.volumeMl! >= day.goalMl!).length} dias. Não avalio os dias sem dados.`
          : 'Sem meta válida registrada, não vou avaliar cumprimento.',
      );
    } else lines.push('Não há volumes informados nesse período.');
    lines.push(
      '',
      '*🏋️ Atividade*',
      `${snapshot.confirmedWorkoutReports} relatos explícitos de treino concluído. Treinos prescritos não contam como realizados.`,
    );
    if (snapshot.weights.length)
      lines.push(
        '',
        '*📈 Peso registrado*',
        (snapshot.weights.length > 2
          ? [snapshot.weights[0], snapshot.weights[snapshot.weights.length - 1]]
          : snapshot.weights
        )
          .map((weight) => `${date(weight.at)}: ${number(weight.kg, 'kg')}`)
          .join(' · '),
      );
    if (snapshot.previous?.meals && snapshot.meals)
      lines.push(
        '',
        '*↔️ Registros entre semanas*',
        `Semana anterior: ${snapshot.previous.meals} refeições (${snapshot.previous.incompleteMeals} incompletas); nesta: ${snapshot.meals} (${snapshot.incompleteMeals} incompletas).`,
        snapshot.previous.calories !== null && snapshot.calories !== null
          ? `Calorias estimadas registradas: ${number(snapshot.previous.calories, 'kcal')} antes e ${number(snapshot.calories, 'kcal')} nesta semana. Cobertura diferente não comprova evolução física.`
          : 'Dados incompletos impedem comparar totais; não avalio adesão pelo silêncio.',
      );
    lines.push(
      '',
      'Ausência de registro não significa falta de cuidado. Na próxima semana, me conte as refeições e os volumes de água quando puder — seguimos sem culpa e sem compensações. 💚',
    );
    return lines.join('\n');
  }
}
