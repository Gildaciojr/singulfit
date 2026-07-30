import type { NutritionRecognitionSignal } from './nutrition-conversation-recognition.contract';
import type {
  NutritionEmotionalContext,
  NutritionEmotionalSignal,
  NutritionEmotionalSignalKind,
  NutritionEmotionalSignalOrigin,
} from './nutrition-conversation-emotional.contract';

export interface NutritionEmotionalEngineInput {
  readonly recognitionSignals: readonly NutritionRecognitionSignal[];
  readonly nutritionConfidence?: number;
  readonly identifiedFoodCount: number;
  readonly requiresEstimateQualification: boolean;
  readonly recommendationCount: number;
  readonly coachFatigueScore: number;
  readonly adherenceScore: number;
  readonly engagementScore: number;
  readonly behavioralInsights: readonly string[];
}

export class NutritionConversationEmotionalEngine {
  recognize(input: NutritionEmotionalEngineInput): NutritionEmotionalContext {
    const signals: NutritionEmotionalSignal[] = [];
    const frustrationEvidence = this.recognitionEvidence(input, [
      'BAD_STRATEGY',
      'RECURRENCE',
      ...(input.adherenceScore < 50 ? ['PLATEAU' as const] : []),
    ]);

    if (frustrationEvidence.length > 0) {
      signals.push(
        this.signal(
          'FRUSTRATION',
          'LONGITUDINAL',
          frustrationEvidence.length > 1 ? 'HIGH' : 'MEDIUM',
          frustrationEvidence,
        ),
      );
    }

    const confidenceSignals = this.recognitionSignals(input, [
      'CONSISTENCY',
      'RECOVERY',
      'BIG_WIN',
      'ADHERENCE',
    ]);
    if (confidenceSignals.length > 0) {
      signals.push(
        this.signal(
          'CONFIDENCE',
          this.origin(confidenceSignals[0]),
          confidenceSignals.some((signal) => signal.confidence === 'HIGH')
            ? 'HIGH'
            : 'MEDIUM',
          this.evidence(confidenceSignals),
        ),
      );
    }

    if (
      input.coachFatigueScore >= 70 &&
      input.adherenceScore < 50 &&
      input.recommendationCount >= 3
    ) {
      signals.push(
        this.signal('OVERWHELM', 'COACH', 'HIGH', [
          'fadiga conversacional elevada',
          'execução recente baixa',
          'múltiplas orientações disponíveis ao mesmo tempo',
        ]),
      );
    }

    const lowNutritionConfidence =
      input.nutritionConfidence !== undefined &&
      input.nutritionConfidence < 0.7;
    if (lowNutritionConfidence || input.identifiedFoodCount === 0) {
      signals.push(
        this.signal('UNCERTAINTY', 'MEAL_ANALYSIS', 'HIGH', [
          ...(lowNutritionConfidence
            ? ['a análise nutricional possui baixa confiança']
            : []),
          ...(input.identifiedFoodCount === 0
            ? ['nenhum alimento foi identificado com segurança']
            : []),
          ...(input.requiresEstimateQualification
            ? ['os valores nutricionais exigem qualificação como estimativas']
            : []),
        ]),
      );
    }

    if (input.adherenceScore >= 70 && input.engagementScore >= 60) {
      signals.push(
        this.signal('MOTIVATION', 'BEHAVIOR', 'HIGH', [
          'adesão e engajamento comportamental permanecem elevados',
        ]),
      );
    }

    const satisfactionSignals = this.recognitionSignals(input, [
      'BIG_WIN',
      'IMPROVEMENT',
      'SMALL_WIN',
    ]);
    if (
      satisfactionSignals.some((signal) => signal.kind === 'BIG_WIN') ||
      (satisfactionSignals.some((signal) => signal.kind === 'IMPROVEMENT') &&
        satisfactionSignals.some((signal) => signal.kind === 'SMALL_WIN'))
    ) {
      signals.push(
        this.signal(
          'SATISFACTION',
          'LONGITUDINAL',
          'HIGH',
          this.evidence(satisfactionSignals),
        ),
      );
    }

    const reengagementSignals = this.recognitionSignals(input, [
      'RECOVERY',
    ]).filter((signal) => signal.origin === 'COACH');
    if (reengagementSignals.length > 0) {
      signals.push(
        this.signal(
          'REENGAGEMENT',
          'COACH',
          'HIGH',
          this.evidence(reengagementSignals),
        ),
      );
    }

    if (input.coachFatigueScore >= 70) {
      signals.push(
        this.signal('FATIGUE', 'COACH', 'HIGH', [
          'o sinal objetivo de fadiga conversacional está elevado',
        ]),
      );
    }

    const resistanceSignals = this.recognitionSignals(input, [
      'BAD_STRATEGY',
      'RECURRENCE',
    ]);
    if (input.adherenceScore < 40 && resistanceSignals.length > 0) {
      signals.push(
        this.signal('RESISTANCE', 'LONGITUDINAL', 'HIGH', [
          ...this.evidence(resistanceSignals),
          'a execução recente permanece baixa',
        ]),
      );
    }

    if (input.behavioralInsights.includes('DATA_RESPONSIVE')) {
      signals.push(
        this.signal('CURIOSITY', 'BEHAVIOR', 'HIGH', [
          'há evidência comportamental de interesse por dados e progresso mensurável',
        ]),
      );
    }

    return Object.freeze({ signals: Object.freeze(signals) });
  }

  private recognitionSignals(
    input: NutritionEmotionalEngineInput,
    kinds: readonly NutritionRecognitionSignal['kind'][],
  ): readonly NutritionRecognitionSignal[] {
    return input.recognitionSignals.filter((signal) =>
      kinds.includes(signal.kind),
    );
  }

  private recognitionEvidence(
    input: NutritionEmotionalEngineInput,
    kinds: readonly NutritionRecognitionSignal['kind'][],
  ): readonly string[] {
    return this.evidence(this.recognitionSignals(input, kinds));
  }

  private evidence(
    signals: readonly NutritionRecognitionSignal[],
  ): readonly string[] {
    return Object.freeze([
      ...new Set(signals.flatMap((signal) => signal.evidence)),
    ]);
  }

  private origin(
    signal: NutritionRecognitionSignal,
  ): NutritionEmotionalSignalOrigin {
    return signal.origin;
  }

  private signal(
    kind: NutritionEmotionalSignalKind,
    origin: NutritionEmotionalSignalOrigin,
    confidence: NutritionEmotionalSignal['confidence'],
    evidence: readonly string[],
  ): NutritionEmotionalSignal {
    return Object.freeze({
      kind,
      origin,
      confidence,
      evidence: Object.freeze([...evidence]),
    });
  }
}
