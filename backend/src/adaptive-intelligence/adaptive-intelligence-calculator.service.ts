import { Injectable } from '@nestjs/common';
import {
  AdaptiveCommunicationProfile,
  DietaryPatternType,
  EarlyChurnLevel,
  FoodQualityClass,
  NutritionTrendDirection,
  RecommendationPriority,
  RecommendationStatus,
} from '@prisma/client';

export interface EvidenceMealSignal {
  score: number;
  proteinScore: number;
  fiberScore: number;
  ultraProcessedScore: number;
  sugarScore: number;
  vegetableGrams: number;
  hydrationMl: number;
  foods: string[];
}

interface CommunicationScores {
  EXECUTIVE: number;
  TECHNICAL: number;
  DISCIPLINED: number;
  WARM: number;
  INSPIRATIONAL: number;
}

@Injectable()
export class AdaptiveIntelligenceCalculatorService {
  nutritionEvidence(meals: EvidenceMealSignal[]) {
    const vegetableScore = this.average(
      meals.map((meal) => this.ratio(meal.vegetableGrams, 150)),
    );
    const proteinScore = this.average(meals.map((meal) => meal.proteinScore));
    const ultraProcessedScore = this.average(
      meals.map((meal) => meal.ultraProcessedScore),
    );
    const sugarScore = this.average(meals.map((meal) => meal.sugarScore));
    const fiberScore = this.average(meals.map((meal) => meal.fiberScore));
    const hydrationScore = this.average(
      meals.map((meal) => this.ratio(meal.hydrationMl, 500)),
    );
    const score = this.clamp(
      Math.round(
        vegetableScore * 0.18 +
          proteinScore * 0.18 +
          ultraProcessedScore * 0.16 +
          sugarScore * 0.14 +
          fiberScore * 0.18 +
          hydrationScore * 0.16,
      ),
    );

    return {
      score,
      vegetableScore,
      proteinScore,
      ultraProcessedScore,
      sugarScore,
      fiberScore,
      hydrationScore,
      mealsAnalyzed: meals.length,
    };
  }

  foodQuality(meal: EvidenceMealSignal) {
    const qualityClass =
      meal.score >= 85
        ? FoodQualityClass.EXCELLENT
        : meal.score >= 70
          ? FoodQualityClass.GOOD
          : meal.score >= 50
            ? FoodQualityClass.REGULAR
            : FoodQualityClass.POOR;
    const factors = {
      proteína: meal.proteinScore,
      fibras: meal.fiberScore,
      vegetais: this.ratio(meal.vegetableGrams, 150),
      ultraprocessados: meal.ultraProcessedScore,
      açúcar: meal.sugarScore,
      hidratação: this.ratio(meal.hydrationMl, 500),
    };
    const ordered = Object.entries(factors).sort(
      (left, right) => right[1] - left[1],
    );
    const positiveFactors = ordered
      .filter(([, value]) => value >= 70)
      .slice(0, 3)
      .map(([factor]) => factor);
    const limitingFactors = [...ordered]
      .reverse()
      .filter(([, value]) => value < 65)
      .slice(0, 3)
      .map(([factor]) => factor);
    const explanation =
      limitingFactors.length === 0
        ? `Índice ${meal.score}/100 sustentado por ${positiveFactors.join(', ') || 'equilíbrio geral'}.`
        : `Índice ${meal.score}/100; pontos fortes: ${positiveFactors.join(', ') || 'base alimentar'}; principais oportunidades: ${limitingFactors.join(', ')}.`;

    return {
      qualityClass,
      score: meal.score,
      positiveFactors,
      limitingFactors,
      explanation,
    };
  }

  dietaryPatterns(meals: EvidenceMealSignal[]) {
    const evidence = this.nutritionEvidence(meals);
    const normalizedFoods = new Set(
      meals.flatMap((meal) =>
        meal.foods.map((food) => this.normalize(food)).filter(Boolean),
      ),
    );
    const varietyScore = this.clamp(
      Math.round(
        (normalizedFoods.size / Math.max(8, meals.length * 1.5)) * 100,
      ),
    );
    const patterns: Array<{
      pattern: DietaryPatternType;
      confidence: number;
      evidence: Record<string, number>;
    }> = [];
    const add = (
      pattern: DietaryPatternType,
      confidence: number,
      metric: string,
      value: number,
    ) =>
      patterns.push({
        pattern,
        confidence: this.clamp(confidence) / 100,
        evidence: { [metric]: value, sampleSize: meals.length },
      });

    if (evidence.proteinScore >= 78) {
      add(
        DietaryPatternType.HIGH_PROTEIN,
        evidence.proteinScore,
        'proteinScore',
        evidence.proteinScore,
      );
    }

    if (evidence.proteinScore < 55) {
      add(
        DietaryPatternType.LOW_PROTEIN,
        100 - evidence.proteinScore,
        'proteinScore',
        evidence.proteinScore,
      );
    }

    if (evidence.sugarScore < 55) {
      add(
        DietaryPatternType.EXCESS_SUGAR,
        100 - evidence.sugarScore,
        'sugarScore',
        evidence.sugarScore,
      );
    }

    if (evidence.ultraProcessedScore < 55) {
      add(
        DietaryPatternType.HIGH_ULTRA_PROCESSED,
        100 - evidence.ultraProcessedScore,
        'ultraProcessedScore',
        evidence.ultraProcessedScore,
      );
    }

    if (evidence.hydrationScore < 50) {
      add(
        DietaryPatternType.LOW_HYDRATION,
        100 - evidence.hydrationScore,
        'hydrationScore',
        evidence.hydrationScore,
      );
    }

    if (varietyScore < 50) {
      add(
        DietaryPatternType.LOW_VARIETY,
        100 - varietyScore,
        'varietyScore',
        varietyScore,
      );
    }

    if (
      evidence.score >= 72 &&
      Math.min(
        evidence.vegetableScore,
        evidence.proteinScore,
        evidence.fiberScore,
        evidence.ultraProcessedScore,
        evidence.sugarScore,
      ) >= 60
    ) {
      add(
        DietaryPatternType.BALANCED,
        evidence.score,
        'evidenceScore',
        evidence.score,
      );
    }

    return patterns.sort(
      (left, right) =>
        right.confidence - left.confidence ||
        left.pattern.localeCompare(right.pattern),
    );
  }

  learning(
    recommendations: Array<{
      category: string;
      signalKey: string;
      status: RecommendationStatus;
      generatedAt: Date;
    }>,
    inboundMessages: string[],
    at: Date,
  ) {
    const topic = new Map<
      string,
      { accepted: number; ignored: number; rejected: number }
    >();
    let acceptedCount = 0;
    let ignoredCount = 0;
    let rejectedCount = 0;

    for (const recommendation of recommendations) {
      const key = this.topicKey(
        recommendation.signalKey,
        recommendation.category,
      );
      const state = topic.get(key) ?? {
        accepted: 0,
        ignored: 0,
        rejected: 0,
      };
      const ignored =
        recommendation.status === RecommendationStatus.EXPIRED ||
        (recommendation.status === RecommendationStatus.ACTIVE &&
          at.getTime() - recommendation.generatedAt.getTime() >=
            3 * 86_400_000);

      if (recommendation.status === RecommendationStatus.ACCEPTED) {
        state.accepted += 1;
        acceptedCount += 1;
      } else if (recommendation.status === RecommendationStatus.DISMISSED) {
        state.rejected += 1;
        rejectedCount += 1;
      } else if (ignored) {
        state.ignored += 1;
        ignoredCount += 1;
      }

      topic.set(key, state);
    }

    const topicScores = Object.fromEntries(
      [...topic.entries()].map(([key, value]) => [
        key,
        this.clamp(
          50 + value.accepted * 18 - value.rejected * 20 - value.ignored * 8,
        ),
      ]),
    );
    const ordered = Object.entries(topicScores).sort(
      (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
    );
    const shortResponses = inboundMessages.filter((message) =>
      /^(feito|fiz|sim|ok|bora|consegui|vou fazer|combinado)[!. ]*$/i.test(
        message.trim(),
      ),
    ).length;
    const shortChallengeScore = this.clamp(
      40 +
        shortResponses * 12 +
        (acceptedCount > rejectedCount + ignoredCount ? 15 : 0),
    );
    const sampleSize = acceptedCount + ignoredCount + rejectedCount;

    return {
      acceptedCount,
      ignoredCount,
      rejectedCount,
      shortChallengeScore,
      preferredTopics: ordered
        .filter(([, score]) => score >= 65)
        .slice(0, 5)
        .map(([key]) => key),
      ignoredTopics: [...ordered]
        .reverse()
        .filter(([, score]) => score <= 40)
        .slice(0, 5)
        .map(([key]) => key),
      topicScores,
      confidence: Math.min(1, sampleSize / 12),
      sampleSize,
    };
  }

  communication(input: {
    behavioralStyle: string | null;
    coachStyle: string | null;
    shortMessagePreference: boolean;
    shortChallengeScore: number;
    previous: {
      profile: AdaptiveCommunicationProfile;
      scores: CommunicationScores;
    } | null;
  }) {
    const scores: CommunicationScores = {
      EXECUTIVE: 40,
      TECHNICAL: 40,
      DISCIPLINED: 40,
      WARM: 40,
      INSPIRATIONAL: 40,
    };
    const boost = (profile: keyof CommunicationScores, value: number) => {
      scores[profile] += value;
    };

    if (input.behavioralStyle === 'DIRECT') boost('EXECUTIVE', 35);
    if (input.behavioralStyle === 'ANALYTICAL') boost('TECHNICAL', 40);
    if (input.behavioralStyle === 'COACH') boost('DISCIPLINED', 30);
    if (input.behavioralStyle === 'FRIENDLY') boost('WARM', 35);
    if (input.behavioralStyle === 'MOTIVATIONAL') boost('INSPIRATIONAL', 35);
    if (input.coachStyle === 'TECHNICAL') boost('TECHNICAL', 25);
    if (input.coachStyle === 'DISCIPLINARIAN') boost('DISCIPLINED', 25);
    if (input.coachStyle === 'WARM') boost('WARM', 25);
    if (input.coachStyle === 'MOTIVATIONAL') boost('INSPIRATIONAL', 25);
    if (input.coachStyle === 'DIRECT') boost('EXECUTIVE', 25);
    if (input.shortMessagePreference) boost('EXECUTIVE', 20);
    if (input.shortChallengeScore >= 70) boost('DISCIPLINED', 15);

    for (const profile of Object.keys(scores) as Array<
      keyof CommunicationScores
    >) {
      const previous = input.previous?.scores[profile];
      scores[profile] = this.clamp(
        Math.round(
          previous === undefined
            ? scores[profile]
            : previous * 0.65 + scores[profile] * 0.35,
        ),
      );
    }

    const ordered = Object.entries(scores).sort(
      (left, right) => right[1] - left[1],
    ) as Array<[AdaptiveCommunicationProfile, number]>;
    let profile = ordered[0][0];

    if (
      input.previous &&
      profile !== input.previous.profile &&
      ordered[0][1] - ordered[1][1] < 10
    ) {
      profile = input.previous.profile;
    }

    const idealLength =
      profile === AdaptiveCommunicationProfile.EXECUTIVE
        ? 420
        : profile === AdaptiveCommunicationProfile.TECHNICAL
          ? 900
          : profile === AdaptiveCommunicationProfile.DISCIPLINED
            ? 520
            : profile === AdaptiveCommunicationProfile.WARM
              ? 650
              : 600;
    const structurePreference =
      profile === AdaptiveCommunicationProfile.TECHNICAL
        ? 'DATA_ACTION'
        : profile === AdaptiveCommunicationProfile.EXECUTIVE
          ? 'SUMMARY_ACTION'
          : profile === AdaptiveCommunicationProfile.DISCIPLINED
            ? 'GOAL_CHALLENGE'
            : profile === AdaptiveCommunicationProfile.WARM
              ? 'CONTEXT_SUPPORT_ACTION'
              : 'PROGRESS_PURPOSE_ACTION';

    return {
      profile,
      previousProfile: input.previous?.profile ?? null,
      scores,
      idealLength,
      structurePreference,
      confidence: Math.min(1, (ordered[0][1] - ordered[1][1] + 35) / 100),
    };
  }

  earlyChurn(input: {
    engagementScore: number;
    consistencyScore: number;
    responseScore: number;
    usageScore: number;
    analysisScore: number;
    coachScore: number;
    daysInactive: number;
    activationRisk: string | null;
  }) {
    const score = this.clamp(
      Math.round(
        (100 - input.engagementScore) * 0.22 +
          (100 - input.consistencyScore) * 0.2 +
          (100 - input.responseScore) * 0.16 +
          (100 - input.usageScore) * 0.14 +
          (100 - input.analysisScore) * 0.13 +
          (100 - input.coachScore) * 0.1 +
          Math.min(100, input.daysInactive * 12) * 0.05,
      ) + (input.activationRisk === 'HIGH' ? 12 : 0),
    );
    const level =
      score >= 75
        ? EarlyChurnLevel.CRITICAL
        : score >= 55
          ? EarlyChurnLevel.HIGH
          : score >= 30
            ? EarlyChurnLevel.MEDIUM
            : EarlyChurnLevel.LOW;
    const reasons = Object.entries({
      baixo_engajamento: input.engagementScore,
      baixa_consistencia: input.consistencyScore,
      baixa_resposta: input.responseScore,
      pouco_uso: input.usageScore,
      poucas_analises: input.analysisScore,
      baixa_interacao_com_coach: input.coachScore,
    })
      .filter(([, value]) => value < 50)
      .sort((left, right) => left[1] - right[1])
      .slice(0, 3)
      .map(([reason]) => reason);

    if (input.daysInactive >= 3) reasons.unshift('inatividade_recente');
    if (input.activationRisk === 'HIGH') reasons.unshift('ativacao_em_risco');

    return { score, level, reasons: [...new Set(reasons)].slice(0, 4) };
  }

  rankRecommendations(
    recommendations: Array<{
      id: string;
      category: string;
      signalKey: string;
      priority: RecommendationPriority;
      confidenceScore: number;
    }>,
    input: {
      topicScores: Record<string, number>;
      ignoredTopics: string[];
      churnLevel: EarlyChurnLevel;
      recentRecommendationIds: string[];
    },
  ) {
    const priorityScores: Record<RecommendationPriority, number> = {
      [RecommendationPriority.LOW]: 35,
      [RecommendationPriority.MEDIUM]: 55,
      [RecommendationPriority.HIGH]: 75,
      [RecommendationPriority.CRITICAL]: 95,
    };
    const ranked = recommendations.map((recommendation) => {
      const topic = this.topicKey(
        recommendation.signalKey,
        recommendation.category,
      );
      const baseScore = this.clamp(
        Math.round(
          priorityScores[recommendation.priority] * 0.55 +
            recommendation.confidenceScore * 0.45,
        ),
      );
      const learningModifier = Math.round(
        ((input.topicScores[topic] ?? 50) - 50) * 0.4 -
          (input.ignoredTopics.includes(topic) ? 12 : 0),
      );
      const contextModifier =
        (input.churnLevel === EarlyChurnLevel.HIGH ||
          input.churnLevel === EarlyChurnLevel.CRITICAL) &&
        ['RETENTION', 'ENGAGEMENT', 'COACHING'].includes(
          recommendation.category,
        )
          ? 14
          : 0;
      const noveltyModifier = input.recentRecommendationIds.includes(
        recommendation.id,
      )
        ? -15
        : 8;

      return {
        recommendationId: recommendation.id,
        adaptiveScore: this.clamp(
          baseScore + learningModifier + contextModifier + noveltyModifier,
        ),
        baseScore,
        learningModifier,
        contextModifier,
        noveltyModifier,
        topic,
      };
    });

    return ranked
      .sort(
        (left, right) =>
          right.adaptiveScore - left.adaptiveScore ||
          left.recommendationId.localeCompare(right.recommendationId),
      )
      .map((item, index) => ({ ...item, rank: index + 1 }));
  }

  evolution(
    currentMeals: EvidenceMealSignal[],
    previousMeals: EvidenceMealSignal[],
  ) {
    const current = this.nutritionEvidence(currentMeals);
    const previous =
      previousMeals.length > 0 ? this.nutritionEvidence(previousMeals) : null;
    const direction =
      !previous || Math.abs(current.score - previous.score) < 4
        ? NutritionTrendDirection.STABLE
        : current.score > previous.score
          ? NutritionTrendDirection.IMPROVING
          : NutritionTrendDirection.DECLINING;

    return {
      ...current,
      previousScore: previous?.score ?? null,
      direction,
    };
  }

  private topicKey(signalKey: string, category: string): string {
    const signal = this.normalize(signalKey).replace(/\s+/g, '_');
    const categoryKey = this.normalize(category).replace(/\s+/g, '_');
    const meaningful = signal
      .split(/[:_]/)
      .find(
        (part) =>
          part.length >= 4 &&
          !['user', 'daily', 'recommendation', 'context'].includes(part),
      );

    return meaningful || categoryKey || 'geral';
  }

  private ratio(value: number, target: number): number {
    return this.clamp(Math.round((Math.max(0, value) / target) * 100));
  }

  private average(values: number[]): number {
    if (values.length === 0) return 0;
    return this.clamp(
      Math.round(values.reduce((sum, value) => sum + value, 0) / values.length),
    );
  }

  private normalize(value: string): string {
    return value
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLocaleLowerCase('pt-BR')
      .trim();
  }

  private clamp(value: number): number {
    return Math.max(0, Math.min(100, Math.round(value)));
  }
}
