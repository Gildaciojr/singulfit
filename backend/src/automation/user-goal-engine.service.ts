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

export type CurrentGoalResolution =
  | Readonly<{ status: 'NO_CHANGE'; reason: string }>
  | Readonly<{
      status: 'REQUIRES_CONFIRMATION';
      reason: string;
      composite: boolean;
      declaredOutcome: string | null;
    }>
  | Readonly<{
      status: 'RESOLVED';
      reason: 'EXPLICIT_CURRENT_GOAL';
      primaryGoal: FitnessGoal;
      classificationGoal: UserGoalType;
      confidence: number;
      declaredOutcome: string;
    }>;

@Injectable()
export class UserGoalEngineService {
  resolveCurrentMessage(message: string | undefined): CurrentGoalResolution {
    if (!message?.trim()) {
      return Object.freeze({ status: 'NO_CHANGE', reason: 'NO_MESSAGE' });
    }
    const text = this.normalize(message);
    if (this.isUncertain(text)) {
      return Object.freeze({
        status: 'REQUIRES_CONFIRMATION',
        reason: 'AMBIGUOUS_CURRENT_GOAL',
        composite: false,
        declaredOutcome: null,
      });
    }
    if (this.isThirdParty(text)) {
      return Object.freeze({ status: 'NO_CHANGE', reason: 'THIRD_PARTY_GOAL' });
    }
    if (this.isHistorical(text)) {
      return Object.freeze({ status: 'NO_CHANGE', reason: 'HISTORICAL_GOAL' });
    }
    if (this.isNegated(text)) {
      return Object.freeze({
        status: 'REQUIRES_CONFIRMATION',
        reason: 'NEGATED_GOAL',
        composite: false,
        declaredOutcome: null,
      });
    }
    if (!this.hasExplicitCurrentIntent(text)) {
      return Object.freeze({ status: 'NO_CHANGE', reason: 'NOT_EXPLICIT' });
    }

    const weightLoss = this.hasWeightLossGoal(text);
    const muscleGain = this.hasMuscleGainGoal(text);
    const maintenance = this.hasMaintenanceGoal(text);
    const signalCount =
      Number(weightLoss) + Number(muscleGain) + Number(maintenance);
    if (signalCount === 0) {
      return Object.freeze({ status: 'NO_CHANGE', reason: 'NO_GOAL_SIGNAL' });
    }
    if (maintenance && signalCount > 1) {
      return Object.freeze({
        status: 'REQUIRES_CONFIRMATION',
        reason: 'CONFLICTING_CURRENT_GOALS',
        composite: false,
        declaredOutcome: null,
      });
    }
    if (weightLoss && muscleGain) {
      return Object.freeze({
        status: 'REQUIRES_CONFIRMATION',
        reason: 'COMPOSITE_GOAL_UNSUPPORTED',
        composite: true,
        declaredOutcome: 'perder gordura e ganhar massa muscular',
      });
    }
    if (weightLoss) {
      return this.resolved(
        FitnessGoal.WEIGHT_LOSS,
        UserGoalType.WEIGHT_LOSS,
        'emagrecimento',
      );
    }
    if (muscleGain) {
      return this.resolved(
        FitnessGoal.MUSCLE_GAIN,
        UserGoalType.HYPERTROPHY,
        'ganho de massa muscular',
      );
    }
    return this.resolved(
      FitnessGoal.MAINTENANCE,
      UserGoalType.MAINTENANCE,
      'manutenção',
    );
  }

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

  private resolved(
    primaryGoal: FitnessGoal,
    classificationGoal: UserGoalType,
    declaredOutcome: string,
  ): CurrentGoalResolution {
    return Object.freeze({
      status: 'RESOLVED',
      reason: 'EXPLICIT_CURRENT_GOAL',
      primaryGoal,
      classificationGoal,
      confidence: 0.98,
      declaredOutcome,
    });
  }

  private normalize(value: string): string {
    return value
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLocaleLowerCase('pt-BR')
      .replace(/[^a-z0-9 ]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private hasExplicitCurrentIntent(value: string): boolean {
    return /\b(?:agora\s+)?(?:eu\s+)?(?:quero|pretendo|busco|decidi|meu objetivo (?:e|mudou(?: agora)?(?: para)?))\b/u.test(
      value,
    );
  }

  private isUncertain(value: string): boolean {
    return /\b(?:nao sei se|talvez|estou em duvida|tenho duvida|ainda nao decidi|ou talvez)\b/u.test(
      value,
    );
  }

  private isThirdParty(value: string): boolean {
    const thirdParty =
      /\b(?:minha|meu)\s+(?:esposa|marido|parceir[oa]|mae|pai|filh[oa]|irma[oa]|amig[oa])\b/u.test(
        value,
      );
    const firstPerson =
      /\b(?:eu|meu objetivo)\s+(?:quero|pretendo|busco|decidi|mudou)\b/u.test(
        value,
      );
    return thirdParty && !firstPerson;
  }

  private isHistorical(value: string): boolean {
    const past =
      /\b(?:ano passado|antigamente|antes eu|eu estava|estava tentando|ja tentei)\b/u.test(
        value,
      );
    const current = /\b(?:agora|atualmente|meu objetivo mudou|decidi)\b/u.test(
      value,
    );
    return past && !current;
  }

  private isNegated(value: string): boolean {
    return /\b(?:nao quero|nao pretendo|nao busco)\s+(?:emagrecer|perder|ganhar|aumentar|manter)\b/u.test(
      value,
    );
  }

  private hasWeightLossGoal(value: string): boolean {
    return /\b(?:emagrecer|perder (?:peso|gordura)|reduzir (?:peso|gordura|percentual de gordura))\b/u.test(
      value,
    );
  }

  private hasMuscleGainGoal(value: string): boolean {
    return /\b(?:(?:ganhar|aumentar) (?:massa muscular|musculos?)|ganho de massa muscular|hipertrofia)\b/u.test(
      value,
    );
  }

  private hasMaintenanceGoal(value: string): boolean {
    return /\b(?:manutencao|manter (?:meu )?(?:peso|forma|estado atual))\b/u.test(
      value,
    );
  }
}
