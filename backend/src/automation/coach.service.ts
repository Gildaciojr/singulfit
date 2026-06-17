import { Injectable } from '@nestjs/common';
import { CoachReviewType, DietPlanStatus, WorkoutStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  AUTOMATION_RULE_CODES,
  AutomationRuleCode,
} from './automation.constants';
import { CoachIntelligenceService } from './coach-intelligence.service';

const GOAL_LABELS: Record<string, string> = {
  WEIGHT_LOSS: 'emagrecimento',
  MUSCLE_GAIN: 'ganho de massa muscular',
  MAINTENANCE: 'manutenção',
};

@Injectable()
export class CoachService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly coachIntelligence: CoachIntelligenceService,
  ) {}

  async generateContent(
    userId: string,
    ruleCode: AutomationRuleCode,
    scheduledFor: Date,
  ): Promise<string> {
    const [user, workout, diet, snapshots, latestCheckIn] = await Promise.all([
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
      this.prisma.dietPlan.findFirst({
        where: {
          userId,
          status: DietPlanStatus.ACTIVE,
        },
        include: {
          meals: {
            orderBy: {
              order: 'asc',
            },
          },
        },
        orderBy: {
          generatedAt: 'desc',
        },
      }),
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
        return this.mealReminder(name, diet);
      case AUTOMATION_RULE_CODES.HYDRATION_REMINDER:
        return `Hora de beber água, ${name}. Mantenha sua garrafa por perto e distribua a hidratação ao longo do dia.`;
      case AUTOMATION_RULE_CODES.DAILY_CHECK_IN:
        return this.checkInReminder(name, latestCheckIn?.adherenceScore);
      case AUTOMATION_RULE_CODES.WEEKLY_SUMMARY:
        return this.weeklySummary(name, snapshots, workout?.title, diet?.title);
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
    }
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
    diet: {
      title: string;
      meals: Array<{ name: string; caloriesTarget: { toNumber(): number } }>;
    } | null,
  ): string {
    if (!diet) {
      return `${name}, você ainda não possui uma dieta ativa. Gere seu plano alimentar para receber lembretes personalizados.`;
    }

    const meals = diet.meals
      .slice(0, 5)
      .map(
        (meal) =>
          `${meal.name} (${this.formatNumber(meal.caloriesTarget.toNumber())} kcal)`,
      )
      .join(', ');

    return `${name}, lembrete do plano "${diet.title}": ${meals}. Escolha a refeição correspondente ao seu horário e siga as porções planejadas.`;
  }

  private checkInReminder(name: string, adherenceScore?: number): string {
    const previous =
      adherenceScore === undefined
        ? ''
        : ` Seu último índice de aderência foi ${adherenceScore}/100.`;

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
}
