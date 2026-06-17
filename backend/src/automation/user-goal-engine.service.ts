import { Injectable } from '@nestjs/common';
import { FitnessGoal, Prisma, UserGoalType } from '@prisma/client';

export interface UserGoalInput {
  nutritionGoal: FitnessGoal | null;
  fitnessGoal: FitnessGoal | null;
  memorySummaries: string[];
  snapshotGoal: FitnessGoal | null;
}

export interface UserGoalResult {
  goal: UserGoalType;
  confidence: Prisma.Decimal;
  evidence: Prisma.InputJsonObject;
}

@Injectable()
export class UserGoalEngineService {
  classify(input: UserGoalInput): UserGoalResult {
    const profileGoals = [
      input.fitnessGoal,
      input.nutritionGoal,
      input.snapshotGoal,
    ].filter((goal): goal is FitnessGoal => goal !== null);
    const mapped = profileGoals.map((goal) => this.mapFitnessGoal(goal));
    const memoryText = input.memorySummaries
      .join(' ')
      .toLocaleLowerCase('pt-BR');
    const healthSignals = this.countMatches(memoryText, [
      'saúde',
      'saude',
      'bem-estar',
      'energia',
      'qualidade de vida',
      'hábitos',
      'habitos',
    ]);
    const hypertrophySignals = this.countMatches(memoryText, [
      'hipertrofia',
      'massa muscular',
      'ganhar massa',
    ]);
    const weightLossSignals = this.countMatches(memoryText, [
      'emagrecer',
      'perder peso',
      'redução de peso',
      'reducao de peso',
    ]);
    let goal = this.mode(mapped) ?? UserGoalType.HEALTH;
    let memoryOverride: UserGoalType | null = null;

    if (
      healthSignals >= 2 &&
      mapped.every((item) => item === UserGoalType.MAINTENANCE)
    ) {
      memoryOverride = UserGoalType.HEALTH;
    } else if (hypertrophySignals >= 2) {
      memoryOverride = UserGoalType.HYPERTROPHY;
    } else if (weightLossSignals >= 2) {
      memoryOverride = UserGoalType.WEIGHT_LOSS;
    }

    if (memoryOverride) {
      goal = memoryOverride;
    }

    const agreement =
      mapped.length === 0
        ? 0
        : mapped.filter((item) => item === goal).length / mapped.length;
    const confidence = Math.min(
      0.98,
      Math.max(0.55, 0.65 + agreement * 0.25 + (memoryOverride ? 0.08 : 0)),
    );

    return {
      goal,
      confidence: new Prisma.Decimal(confidence.toFixed(4)),
      evidence: {
        nutritionGoal: input.nutritionGoal,
        fitnessGoal: input.fitnessGoal,
        snapshotGoal: input.snapshotGoal,
        memorySignals: {
          health: healthSignals,
          hypertrophy: hypertrophySignals,
          weightLoss: weightLossSignals,
        },
        memoryOverride,
      },
    };
  }

  private mapFitnessGoal(goal: FitnessGoal): UserGoalType {
    switch (goal) {
      case FitnessGoal.WEIGHT_LOSS:
        return UserGoalType.WEIGHT_LOSS;
      case FitnessGoal.MUSCLE_GAIN:
        return UserGoalType.HYPERTROPHY;
      case FitnessGoal.MAINTENANCE:
        return UserGoalType.MAINTENANCE;
    }
  }

  private mode(values: UserGoalType[]): UserGoalType | null {
    if (values.length === 0) {
      return null;
    }

    const counts = new Map<UserGoalType, number>();

    for (const value of values) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }

    return (
      [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ??
      null
    );
  }

  private countMatches(value: string, terms: string[]): number {
    return terms.reduce(
      (count, term) => count + (value.includes(term) ? 1 : 0),
      0,
    );
  }
}
