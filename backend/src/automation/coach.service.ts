import { Injectable } from '@nestjs/common';
import { CoachReviewType, WorkoutStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  AUTOMATION_RULE_CODES,
  AutomationRuleCode,
} from './automation.constants';
import { CoachIntelligenceService } from './coach-intelligence.service';
import { CurrentNutritionPlanReaderService } from '../diet/current-nutrition-plan-reader.service';
import type { CurrentNutritionPlan } from '../diet/current-nutrition-plan-reader.contract';
import type { NutritionPlanMeal } from '../diet/v2/nutrition-plan-v2.contract';
import {
  COACH_PROACTIVE_INTENTS,
  type CoachProactiveRealizationInput,
  type CoachProactiveSlot,
} from './coach-proactive.contract';
import { CoachProactiveRealizerService } from './coach-proactive-realizer.service';
import { CurrentWorkoutPlanReaderService } from '../workout/v2/current-workout-plan-reader.service';
import type { WorkoutSessionV2 } from '../workout/v2/workout-plan-v2.contract';

const GOAL_LABELS: Record<string, string> = {
  WEIGHT_LOSS: 'emagrecimento',
  MUSCLE_GAIN: 'ganho de massa muscular',
  MAINTENANCE: 'manutenção',
};

const MEAL_PERIOD_LABELS: Record<NutritionPlanMeal['period'], string> = {
  BREAKFAST: 'café da manhã',
  MORNING_SNACK: 'lanche da manhã',
  LUNCH: 'almoço',
  AFTERNOON_SNACK: 'lanche da tarde',
  DINNER: 'jantar',
  EVENING_SNACK: 'ceia',
  FLEXIBLE: 'horário flexível',
};

@Injectable()
export class CoachService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly coachIntelligence: CoachIntelligenceService,
    private readonly currentNutritionPlanReader: CurrentNutritionPlanReaderService,
    private readonly proactiveRealizer: CoachProactiveRealizerService,
    private readonly currentWorkoutPlanReader: CurrentWorkoutPlanReaderService,
  ) {}

  async generateContent(
    userId: string,
    ruleCode: AutomationRuleCode,
    scheduledFor: Date,
  ): Promise<string> {
    const [user, workout, nutritionPlan, snapshots, latestCheckIn] =
      await Promise.all([
        this.prisma.user.findUnique({
          where: {
            id: userId,
          },
          select: {
            name: true,
            fitnessProfile: {
              select: {
                currentWeightKg: true,
                targetWeightKg: true,
                goal: true,
              },
            },
          },
        }),
        this.prisma.workoutPlan.findFirst({
          where: {
            userId,
            status: WorkoutStatus.ACTIVE,
          },
          include: {
            days: {
              orderBy: {
                dayNumber: 'asc',
              },
              include: {
                exercises: {
                  orderBy: {
                    id: 'asc',
                  },
                },
              },
            },
          },
          orderBy: {
            generatedAt: 'desc',
          },
        }),
        this.currentNutritionPlanReader.getCurrent(userId),
        this.prisma.progressSnapshot.findMany({
          where: {
            userId,
          },
          include: {
            insights: {
              orderBy: {
                createdAt: 'desc',
              },
              take: 1,
            },
          },
          orderBy: {
            createdAt: 'desc',
          },
          take: 2,
        }),
        this.prisma.fitnessCheckIn.findFirst({
          where: {
            userId,
          },
          orderBy: {
            createdAt: 'desc',
          },
        }),
      ]);
    const name = user?.name?.trim()?.split(/\s+/, 1)[0] || 'atleta';

    switch (ruleCode) {
      case AUTOMATION_RULE_CODES.GOOD_MORNING:
        return this.goodMorning(name, user?.fitnessProfile);
      case AUTOMATION_RULE_CODES.DAILY_WORKOUT:
        return this.workoutReminder(name, workout, scheduledFor);
      case AUTOMATION_RULE_CODES.MEAL_REMINDER:
        return this.mealReminder(name, nutritionPlan, scheduledFor);
      case AUTOMATION_RULE_CODES.HYDRATION_REMINDER:
        return `Hora de beber água, ${name}. Mantenha sua garrafa por perto e distribua a hidratação ao longo do dia.`;
      case AUTOMATION_RULE_CODES.DAILY_CHECK_IN:
        return this.checkInReminder(name, latestCheckIn?.adherenceScore);
      case AUTOMATION_RULE_CODES.WEEKLY_SUMMARY:
        return this.weeklySummary(
          name,
          snapshots,
          workout?.title,
          nutritionPlan?.title,
        );
      case AUTOMATION_RULE_CODES.DAILY_COACH:
      case AUTOMATION_RULE_CODES.REENGAGEMENT:
        return (
          await this.coachIntelligence.generateCoachMessage(
            userId,
            ruleCode,
            scheduledFor,
          )
        ).content;
      case AUTOMATION_RULE_CODES.WEEKLY_REVIEW:
        return (
          await this.coachIntelligence.generateReview(
            userId,
            CoachReviewType.WEEKLY,
            scheduledFor,
          )
        ).content;
      case AUTOMATION_RULE_CODES.MONTHLY_REVIEW:
        return (
          await this.coachIntelligence.generateReview(
            userId,
            CoachReviewType.MONTHLY,
            scheduledFor,
          )
        ).content;
      case AUTOMATION_RULE_CODES.SUBSCRIPTION_LIFECYCLE:
        return `${name}, vamos manter seu acompanhamento em dia. Posso ajudar com a continuidade da sua assinatura.`;
    }
  }

  async generateProactiveContent(
    userId: string,
    slot: CoachProactiveSlot,
  ): Promise<{
    readonly content: string;
    readonly operationKey: string;
  } | null> {
    const [user, workout, nutritionPlan, preferences] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          name: true,
          fitnessProfile: { select: { goal: true } },
          goalClassification: { select: { goal: true } },
        },
      }),
      this.currentWorkoutPlanReader.read(userId),
      this.currentNutritionPlanReader.getCurrent(userId),
      this.prisma.userPreferences.findUnique({ where: { userId } }),
    ]);
    const workoutSession =
      slot.intent === COACH_PROACTIVE_INTENTS.WORKOUT_CHECK &&
      workout.status === 'AVAILABLE'
        ? this.currentWorkoutPlanReader.select(
            workout.plan,
            'hoje',
            slot.scheduledFor,
          )
        : null;
    if (
      slot.intent === COACH_PROACTIVE_INTENTS.WORKOUT_CHECK &&
      workoutSession?.kind !== 'SESSION'
    ) {
      return null;
    }
    const preferredName = user?.name?.trim().split(/\s+/u, 1)[0] || null;
    const operationKey = `proactive:${userId}:${slot.ruleCode}:${slot.slotKey}:${slot.scheduledFor.toISOString()}`;
    const fallback = this.proactiveFallback(
      preferredName,
      slot.intent,
      nutritionPlan !== null,
      workoutSession?.kind === 'SESSION' ? workoutSession.session : null,
    );
    const realization: CoachProactiveRealizationInput = {
      userId,
      operationKey,
      preferredName,
      intent: slot.intent,
      slotKey: slot.slotKey,
      localTime: slot.localTime,
      goal:
        user?.goalClassification?.goal ?? user?.fitnessProfile?.goal ?? null,
      nutritionPlanSummary: nutritionPlan?.title ?? null,
      workoutPlanSummary:
        workoutSession?.kind === 'SESSION'
          ? this.workoutSessionSummary(workoutSession.session)
          : workout.status === 'AVAILABLE'
            ? workout.plan.document.title
            : null,
      trainingTime: preferences?.preferredTrainingTime ?? null,
      mealTimes: preferences?.preferredMealTimes ?? [],
      fallback,
    };
    return Object.freeze({
      content: await this.proactiveRealizer.realize(realization),
      operationKey,
    });
  }

  async generateOnboardingKickoff(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: {
        id: userId,
      },
      select: {
        name: true,
        fitnessProfile: {
          select: {
            goal: true,
          },
        },
        goalClassification: {
          select: {
            goal: true,
          },
        },
      },
    });
    const name = user?.name?.trim()?.split(/\s+/, 1)[0] || 'atleta';
    const goal =
      user?.goalClassification?.goal ??
      user?.fitnessProfile?.goal ??
      'EVOLUCAO_FISICA';

    return [
      `Olá ${name} 👋`,
      '',
      'Agora já tenho todas as informações necessárias para personalizar seu acompanhamento.',
      '',
      `Identifiquei que seu principal objetivo é ${this.premiumGoalLabel(goal)}.`,
      '',
      'A partir de agora posso ajudar você com:',
      '',
      '🥗 Alimentação',
      '🏋️ Treinos',
      '📸 Análise de refeições',
      '📈 Evolução física',
      '🎯 Estratégias personalizadas',
      '',
      'O que você gostaria de fazer primeiro?',
      '',
      'Pode me contar com suas palavras se quer começar pela alimentação, pelo treino ou pelo acompanhamento da sua evolução.',
    ].join('\n');
  }

  private goodMorning(
    name: string,
    profile:
      | {
          goal: string;
          currentWeightKg: { toNumber(): number };
          targetWeightKg: { toNumber(): number };
        }
      | null
      | undefined,
  ): string {
    if (!profile) {
      return `Bom dia, ${name}! Complete seu perfil fitness para receber orientações mais personalizadas.`;
    }

    return `Bom dia, ${name}! Seu foco continua em ${GOAL_LABELS[profile.goal] ?? 'evolução física'}. Peso atual: ${this.formatNumber(profile.currentWeightKg.toNumber())} kg; meta: ${this.formatNumber(profile.targetWeightKg.toNumber())} kg. Um passo consistente de cada vez.`;
  }

  private proactiveFallback(
    preferredName: string | null,
    intent: CoachProactiveRealizationInput['intent'],
    nutritionPlanAvailable: boolean,
    workoutSession: WorkoutSessionV2 | null,
  ): string {
    const greeting = preferredName ? `Oi, ${preferredName}!` : 'Oi!';
    switch (intent) {
      case COACH_PROACTIVE_INTENTS.GOOD_MORNING:
        return `${greeting} Como você está começando o dia hoje?`;
      case COACH_PROACTIVE_INTENTS.HYDRATION_CHECK:
        return `${greeting} Como está sua hidratação hoje? Quanto você já conseguiu beber?`;
      case COACH_PROACTIVE_INTENTS.MEAL_PLAN_CHECK:
        return nutritionPlanAvailable
          ? `${greeting} Como está indo seu plano alimentar hoje?`
          : `${greeting} Como está sua alimentação hoje?`;
      case COACH_PROACTIVE_INTENTS.LUNCH_CHECK:
        return nutritionPlanAvailable
          ? `${greeting} Já conseguiu almoçar? Como foi para seguir o planejado?`
          : `${greeting} Já conseguiu almoçar? Como foi sua refeição?`;
      case COACH_PROACTIVE_INTENTS.DINNER_CHECK:
        return `${greeting} Já jantou? Como ficou sua alimentação hoje à noite?`;
      case COACH_PROACTIVE_INTENTS.WORKOUT_CHECK:
        return workoutSession
          ? `${greeting} Conseguiu fazer a sessão ${workoutSession.sequence} — ${workoutSession.label} hoje? Como foi?`
          : `${greeting} Como foi seu treino hoje?`;
      case COACH_PROACTIVE_INTENTS.DAILY_CHECK_IN:
        return `${greeting} Como estão sua energia e sua rotina hoje?`;
    }
  }

  private workoutSessionSummary(session: WorkoutSessionV2): string {
    return `Sessão ${session.sequence}: ${session.label} (${session.estimatedDurationMinutes} min)`;
  }

  private workoutReminder(
    name: string,
    workout: {
      title: string;
      days: Array<{
        dayNumber: number;
        title: string;
        exercises: Array<{ exerciseName: string }>;
      }>;
    } | null,
    scheduledFor: Date,
  ): string {
    if (!workout) {
      return `${name}, você ainda não possui um treino ativo. Gere seu plano antes de começar uma nova rotina.`;
    }

    const weekday = scheduledFor.getUTCDay() || 7;
    const day =
      workout.days.find((item) => item.dayNumber === weekday) ??
      workout.days[0];

    if (!day) {
      return `${name}, consulte o treino ativo "${workout.title}" antes de iniciar sua atividade de hoje.`;
    }

    const exercises = day.exercises
      .slice(0, 4)
      .map((exercise) => exercise.exerciseName)
      .join(', ');

    return `${name}, treino de hoje: ${day.title}. ${exercises ? `Exercícios principais: ${exercises}. ` : ''}Respeite seus limites e mantenha a técnica.`;
  }

  private mealReminder(
    name: string,
    plan: CurrentNutritionPlan | null,
    scheduledFor: Date,
  ): string {
    if (!plan) {
      return `${name}, você ainda não possui uma dieta ativa. Gere seu plano alimentar para receber lembretes personalizados.`;
    }

    if (plan.implementation === 'LEGACY') {
      const meals = plan.meals
        .slice(0, 5)
        .map(
          (meal) =>
            `${meal.name} (${this.formatNumber(meal.caloriesTarget)} kcal)`,
        )
        .join(', ');
      return `${name}, lembrete do plano "${plan.title}": ${meals}. Escolha a refeição correspondente ao seu horário e siga as porções planejadas.`;
    }

    const weekday = scheduledFor.getUTCDay() || 7;
    const day =
      plan.document.days.find((item) => item.dayNumber === weekday) ??
      plan.document.days[0];
    const scheduledMeals =
      day?.meals.filter((meal) => meal.suggestedTime !== null).slice(0, 5) ??
      [];
    if (scheduledMeals.length === 0) {
      return `${name}, consulte o plano "${plan.title}" para a refeição de hoje. Os horários ainda não estão definidos, então o lembrete personalizado fica adiado.`;
    }
    const meals = scheduledMeals
      .map(
        (meal) =>
          `${meal.name} (${MEAL_PERIOD_LABELS[meal.period]}, ${meal.suggestedTime})`,
      )
      .join(', ');

    return `${name}, lembrete do plano "${plan.title}": ${meals}. Siga as porções planejadas para o período correspondente.`;
  }

  private checkInReminder(name: string, adherenceScore?: number): string {
    const previous =
      adherenceScore === undefined
        ? ''
        : adherenceScore >= 70
          ? ' Você vinha mantendo uma boa regularidade.'
          : adherenceScore >= 45
            ? ' Sua regularidade vinha oscilando.'
            : ' Sua rotina vinha pedindo um passo mais simples.';

    return `${name}, faça seu check-in diário: como estão seu humor, energia e aderência hoje?${previous}`;
  }

  private weeklySummary(
    name: string,
    snapshots: Array<{
      weightKg: { toNumber(): number };
      insights: Array<{ insight: string }>;
    }>,
    workoutTitle?: string,
    dietTitle?: string,
  ): string {
    const current = snapshots[0];
    const previous = snapshots[1];
    const parts = [`${name}, aqui está seu resumo semanal.`];

    if (current && previous) {
      const change = current.weightKg.toNumber() - previous.weightKg.toNumber();
      const direction =
        Math.abs(change) < 0.01
          ? 'permaneceu estável'
          : change < 0
            ? `reduziu ${this.formatNumber(Math.abs(change))} kg`
            : `aumentou ${this.formatNumber(change)} kg`;

      parts.push(
        `Seu peso ${direction} entre os dois registros mais recentes.`,
      );
    } else if (current) {
      parts.push(
        `Seu registro mais recente é ${this.formatNumber(current.weightKg.toNumber())} kg.`,
      );
    }

    const insight = current?.insights[0]?.insight;

    if (insight) {
      parts.push(insight);
    }

    if (workoutTitle) {
      parts.push(`Treino ativo: ${workoutTitle}.`);
    }

    if (dietTitle) {
      parts.push(`Dieta ativa: ${dietTitle}.`);
    }

    if (!current && !workoutTitle && !dietTitle) {
      parts.push(
        'Registre medidas e gere seus planos para enriquecer os próximos resumos.',
      );
    }

    return parts.join(' ');
  }

  private formatNumber(value: number): string {
    return Number(value.toFixed(2)).toString().replace('.', ',');
  }

  private premiumGoalLabel(goal: string): string {
    const labels: Record<string, string> = {
      ...GOAL_LABELS,
      WEIGHT_LOSS: 'emagrecimento',
      HYPERTROPHY: 'ganho de massa muscular',
      HEALTH: 'saúde e qualidade de vida',
      EVOLUCAO_FISICA: 'evolução física',
    };

    return labels[goal] ?? 'evolução física';
  }
}
