import { Injectable } from '@nestjs/common';
import { ChurnRiskLevel } from '@prisma/client';

export interface HabitMetricInput {
  mealDates: Date[];
  messageDates: Date[];
  at: Date;
  windowDays?: number;
}

export interface HabitMetricResult {
  windowDays: number;
  mealsRegistered: number;
  messagesSent: number;
  activeDays: number;
  activeDaysLast7: number;
  consecutiveDays: number;
  daysSinceInteraction: number;
  mealFrequency: number;
  interactionFrequency: number;
  regularityScore: number;
}

export interface ConsistencyInput {
  habit: HabitMetricResult;
  adherenceScore: number;
}

export interface EngagementInput {
  messagesLast7Days: number;
  messagesLast30Days: number;
  analysesLast7Days: number;
  analysesLast30Days: number;
  activeDaysLast7: number;
  activeDaysLast30: number;
}

export interface ChurnInput {
  daysInactive: number;
  engagementScore: number;
  consistencyScore: number;
  interactionsLast7Days: number;
  interactionsPrevious7Days: number;
}

@Injectable()
export class CoachMetricsService {
  calculateHabits(input: HabitMetricInput): HabitMetricResult {
    const windowDays = input.windowDays ?? 30;
    const windowStart = new Date(input.at.getTime() - windowDays * 86_400_000);
    const mealDates = input.mealDates.filter(
      (date) => date >= windowStart && date <= input.at,
    );
    const messageDates = input.messageDates.filter(
      (date) => date >= windowStart && date <= input.at,
    );
    const allDates = [...mealDates, ...messageDates].sort(
      (left, right) => left.getTime() - right.getTime(),
    );
    const activeDayKeys = [
      ...new Set(allDates.map((date) => this.dayKey(date))),
    ];
    const sevenDaysAgo = new Date(input.at.getTime() - 7 * 86_400_000);
    const activeDaysLast7 = new Set(
      allDates
        .filter((date) => date >= sevenDaysAgo)
        .map((date) => this.dayKey(date)),
    ).size;
    const latest = allDates.at(-1) ?? null;
    const daysSinceInteraction = latest
      ? Math.max(
          0,
          Math.floor(
            (this.utcDay(input.at).getTime() - this.utcDay(latest).getTime()) /
              86_400_000,
          ),
        )
      : windowDays;
    const consecutiveDays = this.consecutiveDays(activeDayKeys);
    const coverageScore = this.clamp(
      Math.round((activeDayKeys.length / Math.min(windowDays, 15)) * 100),
    );
    const gapScore = this.gapRegularity(activeDayKeys);

    return {
      windowDays,
      mealsRegistered: mealDates.length,
      messagesSent: messageDates.length,
      activeDays: activeDayKeys.length,
      activeDaysLast7,
      consecutiveDays,
      daysSinceInteraction,
      mealFrequency: Number(((mealDates.length / windowDays) * 7).toFixed(2)),
      interactionFrequency: Number(
        ((messageDates.length / windowDays) * 7).toFixed(2),
      ),
      regularityScore: this.clamp(
        Math.round(coverageScore * 0.65 + gapScore * 0.35),
      ),
    };
  }

  calculateConsistency(input: ConsistencyInput) {
    const frequencyScore = this.clamp(
      Math.round((input.habit.mealFrequency / 7) * 100),
    );
    const continuityBase = this.clamp(
      100 - input.habit.daysSinceInteraction * 12,
    );
    const continuityScore = this.clamp(
      continuityBase + Math.min(20, input.habit.consecutiveDays * 4),
    );
    const score = this.clamp(
      Math.round(
        frequencyScore * 0.3 +
          input.habit.regularityScore * 0.25 +
          input.adherenceScore * 0.25 +
          continuityScore * 0.2,
      ),
    );

    return {
      score,
      frequencyScore,
      regularityScore: input.habit.regularityScore,
      adherenceScore: this.clamp(input.adherenceScore),
      continuityScore,
    };
  }

  calculateEngagement(input: EngagementInput) {
    const messagesScore = this.clamp(
      Math.round(
        Math.min(1, input.messagesLast7Days / 7) * 60 +
          Math.min(1, input.messagesLast30Days / 20) * 40,
      ),
    );
    const analysesScore = this.clamp(
      Math.round(
        Math.min(1, input.analysesLast7Days / 5) * 60 +
          Math.min(1, input.analysesLast30Days / 15) * 40,
      ),
    );
    const weeklyUsageScore = this.clamp(
      Math.round((input.activeDaysLast7 / 5) * 100),
    );
    const monthlyUsageScore = this.clamp(
      Math.round((input.activeDaysLast30 / 15) * 100),
    );
    const score = this.clamp(
      Math.round(
        messagesScore * 0.3 +
          analysesScore * 0.25 +
          weeklyUsageScore * 0.25 +
          monthlyUsageScore * 0.2,
      ),
    );

    return {
      score,
      messagesScore,
      analysesScore,
      weeklyUsageScore,
      monthlyUsageScore,
    };
  }

  calculateChurn(input: ChurnInput) {
    const activityDrop =
      input.interactionsPrevious7Days <= 0
        ? 0
        : this.clamp(
            Math.round(
              ((input.interactionsPrevious7Days - input.interactionsLast7Days) /
                input.interactionsPrevious7Days) *
                100,
            ),
          );
    const reasons: string[] = [];
    let points = 0;

    if (input.daysInactive >= 14) {
      points += 4;
      reasons.push('SEM_INTERACAO_14_DIAS');
    } else if (input.daysInactive >= 7) {
      points += 3;
      reasons.push('SEM_INTERACAO_7_DIAS');
    } else if (input.daysInactive >= 3) {
      points += 1;
      reasons.push('INTERACAO_EM_QUEDA');
    }

    points += this.scoreRisk(
      input.engagementScore,
      'ENGAJAMENTO_BAIXO',
      reasons,
    );
    points += this.scoreRisk(
      input.consistencyScore,
      'CONSISTENCIA_BAIXA',
      reasons,
    );

    if (activityDrop >= 60) {
      points += 3;
      reasons.push('ABANDONO_PROGRESSIVO');
    } else if (activityDrop >= 30) {
      points += 1;
      reasons.push('ATIVIDADE_RECENTE_EM_QUEDA');
    }

    const level =
      points >= 7
        ? ChurnRiskLevel.HIGH
        : points >= 3
          ? ChurnRiskLevel.MEDIUM
          : ChurnRiskLevel.LOW;

    return {
      level,
      reasons,
      activityDrop,
    };
  }

  private scoreRisk(score: number, reason: string, reasons: string[]): number {
    if (score < 30) {
      reasons.push(reason);
      return 3;
    }

    if (score < 50) {
      reasons.push(reason);
      return 2;
    }

    if (score < 70) {
      return 1;
    }

    return 0;
  }

  private gapRegularity(dayKeys: string[]): number {
    if (dayKeys.length <= 1) {
      return dayKeys.length === 1 ? 50 : 0;
    }

    const values = dayKeys.map((key) => new Date(`${key}T00:00:00.000Z`));
    const gaps = values
      .slice(1)
      .map((date, index) =>
        Math.round(
          (date.getTime() - (values[index]?.getTime() ?? date.getTime())) /
            86_400_000,
        ),
      );
    const average = gaps.reduce((sum, value) => sum + value, 0) / gaps.length;
    const variance =
      gaps.reduce((sum, value) => sum + (value - average) ** 2, 0) /
      gaps.length;

    return this.clamp(Math.round(100 - Math.sqrt(variance) * 25));
  }

  private consecutiveDays(dayKeys: string[]): number {
    if (dayKeys.length === 0) {
      return 0;
    }

    const sorted = [...dayKeys].sort().reverse();
    let streak = 1;

    for (let index = 1; index < sorted.length; index += 1) {
      const previous = new Date(`${sorted[index - 1]}T00:00:00.000Z`);
      const current = new Date(`${sorted[index]}T00:00:00.000Z`);

      if ((previous.getTime() - current.getTime()) / 86_400_000 !== 1) {
        break;
      }

      streak += 1;
    }

    return streak;
  }

  private dayKey(value: Date): string {
    return value.toISOString().slice(0, 10);
  }

  private utcDay(value: Date): Date {
    return new Date(
      Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
    );
  }

  private clamp(value: number): number {
    return Math.max(0, Math.min(100, value));
  }
}
