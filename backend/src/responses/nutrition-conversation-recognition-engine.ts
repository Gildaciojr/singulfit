import type { NutritionConversationTrendDirection } from './nutrition-conversation-context.interface';
import type {
  NutritionRecognitionContext,
  NutritionRecognitionKind,
  NutritionRecognitionOrigin,
  NutritionRecognitionSignal,
} from './nutrition-conversation-recognition.contract';

export interface NutritionRecognitionEngineInput {
  readonly positiveFactors: readonly string[];
  readonly recentMealCount: number;
  readonly currentQualityScore: number | null;
  readonly recentQualityScores: readonly number[];
  readonly trendDirection?: NutritionConversationTrendDirection;
  readonly longitudinalDirection?: NutritionConversationTrendDirection;
  readonly relapsePresent: boolean;
  readonly returnAfterAbsence: boolean;
  readonly activeDays: number;
  readonly consecutiveDays: number;
  readonly consistencyScore: number;
  readonly adherenceScore: number;
  readonly momentumScore: number;
  readonly strategyWorked?: string;
  readonly strategyFailed?: string;
  readonly goalRelation?: string;
}

export class NutritionConversationRecognitionEngine {
  recognize(
    input: NutritionRecognitionEngineInput,
  ): NutritionRecognitionContext {
    const signals: NutritionRecognitionSignal[] = [];
    const improving = this.hasDirection(input, 'IMPROVING');
    const declining = this.hasDirection(input, 'DECLINING');
    const stable = this.hasDirection(input, 'STABLE');
    const betterThanRecent = this.betterThanRecent(input);

    if ((input.relapsePresent && improving) || input.returnAfterAbsence) {
      signals.push(
        this.signal(
          'RECOVERY',
          input.returnAfterAbsence ? 'COACH' : 'LONGITUDINAL',
          'HIGH',
          input.returnAfterAbsence
            ? 'o registro foi retomado após um período de afastamento'
            : 'retomada observada após uma oscilação anterior',
          input.goalRelation,
        ),
      );
    }
    if (betterThanRecent || (improving && input.positiveFactors.length > 0)) {
      signals.push(
        this.signal(
          'SMALL_WIN',
          'LONGITUDINAL',
          betterThanRecent ? 'HIGH' : 'MEDIUM',
          betterThanRecent
            ? 'a refeição atual melhorou em relação às referências recentes'
            : 'uma melhora existente foi acompanhada por uma escolha favorável',
          input.goalRelation,
        ),
      );
    }
    if (improving) {
      signals.push(
        this.signal(
          'IMPROVEMENT',
          'LONGITUDINAL',
          input.trendDirection === 'IMPROVING' &&
            input.longitudinalDirection === 'IMPROVING'
            ? 'HIGH'
            : 'MEDIUM',
          'o acompanhamento disponível indica melhora',
          input.goalRelation,
        ),
      );
    }
    if (
      input.trendDirection === 'IMPROVING' &&
      input.longitudinalDirection === 'IMPROVING' &&
      input.consistencyScore >= 75
    ) {
      signals.push(
        this.signal(
          'BIG_WIN',
          'LONGITUDINAL',
          'HIGH',
          'a melhora aparece em mais de uma janela e com continuidade',
          input.goalRelation,
        ),
      );
    }
    if (input.consecutiveDays >= 2 && input.positiveFactors.length > 0) {
      signals.push(
        this.signal(
          'EFFORT',
          'COACH',
          'MEDIUM',
          'uma escolha favorável foi registrada em uma sequência ativa',
          input.goalRelation,
        ),
      );
    }
    if (input.consistencyScore >= 70 && input.consecutiveDays >= 3) {
      signals.push(
        this.signal(
          'CONSISTENCY',
          'COACH',
          'HIGH',
          'o padrão recente apresenta continuidade',
          input.goalRelation,
        ),
      );
    }
    if (input.consecutiveDays >= 7 && input.consistencyScore >= 75) {
      signals.push(
        this.signal(
          'DISCIPLINE',
          'COACH',
          'HIGH',
          'uma ação útil foi repetida ao longo de vários dias',
          input.goalRelation,
        ),
      );
    }
    if (input.positiveFactors.length > 0) {
      signals.push(
        this.signal(
          'GOOD_DECISION',
          'COACH',
          'HIGH',
          input.positiveFactors[0],
          input.goalRelation,
        ),
      );
    }
    if (input.strategyWorked) {
      signals.push(
        this.signal(
          'GOOD_STRATEGY',
          'LONGITUDINAL',
          'HIGH',
          input.strategyWorked,
          input.goalRelation,
        ),
      );
    }
    if (input.strategyFailed) {
      signals.push(
        this.signal(
          'BAD_STRATEGY',
          'LONGITUDINAL',
          'HIGH',
          input.strategyFailed,
          input.goalRelation,
        ),
      );
    }
    if (declining) {
      signals.push(
        this.signal(
          input.relapsePresent ? 'RECURRENCE' : 'SETBACK',
          'LONGITUDINAL',
          'MEDIUM',
          input.relapsePresent
            ? 'uma dificuldade anterior voltou a aparecer no período'
            : 'o acompanhamento indica uma oscilação recente',
          input.goalRelation,
        ),
      );
    }
    if (input.adherenceScore >= 70) {
      signals.push(
        this.signal(
          'ADHERENCE',
          'BEHAVIOR',
          'HIGH',
          'as ações recentes permanecem alinhadas ao acompanhamento',
          input.goalRelation,
        ),
      );
    }
    if (input.momentumScore >= 70 && input.activeDays >= 3) {
      signals.push(
        this.signal(
          'MOMENTUM',
          'COACH',
          'HIGH',
          'o ritmo recente sustenta continuidade',
          input.goalRelation,
        ),
      );
    }
    if (stable && input.recentMealCount >= 3 && !improving && !declining) {
      signals.push(
        this.signal(
          'PLATEAU',
          'LONGITUDINAL',
          'MEDIUM',
          'o padrão permaneceu estável na janela observada',
          input.goalRelation,
        ),
      );
    }
    return Object.freeze({ signals: Object.freeze(signals) });
  }

  private hasDirection(
    input: NutritionRecognitionEngineInput,
    direction: NutritionConversationTrendDirection,
  ): boolean {
    return (
      input.trendDirection === direction ||
      input.longitudinalDirection === direction
    );
  }

  private betterThanRecent(input: NutritionRecognitionEngineInput): boolean {
    if (
      input.currentQualityScore === null ||
      input.recentQualityScores.length === 0
    )
      return false;
    const average =
      input.recentQualityScores.reduce((sum, score) => sum + score, 0) /
      input.recentQualityScores.length;
    return input.currentQualityScore >= average + 5;
  }

  private signal(
    kind: NutritionRecognitionKind,
    origin: NutritionRecognitionOrigin,
    confidence: NutritionRecognitionSignal['confidence'],
    evidence: string,
    goalRelation?: string,
  ): NutritionRecognitionSignal {
    return Object.freeze({
      kind,
      origin,
      confidence,
      evidence: Object.freeze([evidence]),
      ...(goalRelation ? { goalRelation } : {}),
    });
  }
}
