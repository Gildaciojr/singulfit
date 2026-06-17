import {
  AdaptiveCommunicationProfile,
  DietaryPatternType,
  EarlyChurnLevel,
  FoodQualityClass,
  NutritionTrendDirection,
  RecommendationPriority,
  RecommendationStatus,
} from '@prisma/client';
import { AdaptiveIntelligenceCalculatorService } from './adaptive-intelligence-calculator.service';

describe('AdaptiveIntelligenceCalculatorService', () => {
  const calculator = new AdaptiveIntelligenceCalculatorService();
  const meal = {
    score: 82,
    proteinScore: 88,
    fiberScore: 76,
    ultraProcessedScore: 90,
    sugarScore: 85,
    vegetableGrams: 140,
    hydrationMl: 450,
    foods: ['frango', 'arroz', 'brócolis'],
  };

  it('calculates deterministic evidence and explains food quality', () => {
    const evidence = calculator.nutritionEvidence([meal, meal]);
    const quality = calculator.foodQuality(meal);

    expect(evidence).toEqual(
      expect.objectContaining({
        score: expect.any(Number),
        mealsAnalyzed: 2,
        proteinScore: 88,
        fiberScore: 76,
      }),
    );
    expect(evidence.score).toBeGreaterThanOrEqual(80);
    expect(quality.qualityClass).toBe(FoodQualityClass.GOOD);
    expect(quality.positiveFactors).toContain('ultraprocessados');
    expect(quality.explanation).toContain('82/100');
  });

  it('detects balanced and risk dietary patterns with confidence', () => {
    const balanced = calculator.dietaryPatterns([meal, meal]);
    const risky = calculator.dietaryPatterns([
      {
        ...meal,
        score: 35,
        proteinScore: 25,
        fiberScore: 30,
        ultraProcessedScore: 20,
        sugarScore: 25,
        vegetableGrams: 10,
        hydrationMl: 40,
        foods: ['biscoito'],
      },
    ]);

    expect(balanced.map((item) => item.pattern)).toContain(
      DietaryPatternType.BALANCED,
    );
    expect(risky.map((item) => item.pattern)).toEqual(
      expect.arrayContaining([
        DietaryPatternType.LOW_PROTEIN,
        DietaryPatternType.EXCESS_SUGAR,
        DietaryPatternType.HIGH_ULTRA_PROCESSED,
        DietaryPatternType.LOW_HYDRATION,
        DietaryPatternType.LOW_VARIETY,
      ]),
    );
  });

  it('learns accepted and ignored topics and ranks novel recommendations', () => {
    const at = new Date('2026-06-15T12:00:00.000Z');
    const learning = calculator.learning(
      [
        {
          category: 'NUTRITION',
          signalKey: 'protein:breakfast',
          status: RecommendationStatus.ACCEPTED,
          generatedAt: at,
        },
        {
          category: 'HYDRATION',
          signalKey: 'hydration:routine',
          status: RecommendationStatus.ACTIVE,
          generatedAt: new Date(at.getTime() - 4 * 86_400_000),
        },
      ],
      ['feito', 'vou fazer'],
      at,
    );
    const ranking = calculator.rankRecommendations(
      [
        {
          id: 'protein',
          category: 'NUTRITION',
          signalKey: 'protein:breakfast',
          priority: RecommendationPriority.HIGH,
          confidenceScore: 80,
        },
        {
          id: 'hydration',
          category: 'HYDRATION',
          signalKey: 'hydration:routine',
          priority: RecommendationPriority.HIGH,
          confidenceScore: 80,
        },
      ],
      {
        topicScores: learning.topicScores,
        ignoredTopics: learning.ignoredTopics,
        churnLevel: EarlyChurnLevel.LOW,
        recentRecommendationIds: ['hydration'],
      },
    );

    expect(learning.acceptedCount).toBe(1);
    expect(learning.ignoredCount).toBe(1);
    expect(learning.shortChallengeScore).toBeGreaterThan(60);
    expect(ranking[0].recommendationId).toBe('protein');
    expect(ranking[0].adaptiveScore).toBeGreaterThan(ranking[1].adaptiveScore);
  });

  it('stabilizes communication changes and adapts message structure', () => {
    const result = calculator.communication({
      behavioralStyle: 'ANALYTICAL',
      coachStyle: 'TECHNICAL',
      shortMessagePreference: false,
      shortChallengeScore: 45,
      previous: {
        profile: AdaptiveCommunicationProfile.WARM,
        scores: {
          EXECUTIVE: 35,
          TECHNICAL: 45,
          DISCIPLINED: 35,
          WARM: 70,
          INSPIRATIONAL: 40,
        },
      },
    });

    expect(result.scores.TECHNICAL).toBeGreaterThan(45);
    expect(result.idealLength).toBeGreaterThanOrEqual(650);
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('predicts churn early and compares longitudinal windows', () => {
    const churn = calculator.earlyChurn({
      engagementScore: 15,
      consistencyScore: 20,
      responseScore: 10,
      usageScore: 15,
      analysisScore: 10,
      coachScore: 20,
      daysInactive: 8,
      activationRisk: 'HIGH',
    });
    const evolution = calculator.evolution(
      [meal],
      [{ ...meal, score: 55, proteinScore: 50, fiberScore: 45 }],
    );

    expect(churn.level).toBe(EarlyChurnLevel.CRITICAL);
    expect(churn.reasons).toContain('inatividade_recente');
    expect(evolution.direction).toBe(NutritionTrendDirection.IMPROVING);
  });
});
