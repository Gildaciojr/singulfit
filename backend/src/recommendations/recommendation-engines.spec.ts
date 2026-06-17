import {
  BehavioralMotivationStyle,
  MotivationTriggerType,
  NutritionInsightType,
  NutritionTrendDirection,
  RecommendationCategory,
  RecommendationPriority,
  StageOfChange,
  UserGoalType,
} from '@prisma/client';
import { BehavioralRecommendationEngineService } from './behavioral-recommendation-engine.service';
import { NutritionRecommendationEngineService } from './nutrition-recommendation-engine.service';
import { RecommendationScoringService } from './recommendation-scoring.service';
import { RetentionRecommendationEngineService } from './retention-recommendation-engine.service';

describe('Recommendation engines', () => {
  it('calculates a deterministic confidence score from context and recurrence', () => {
    const scoring = new RecommendationScoringService();

    expect(
      scoring.calculate({
        contextSources: 4,
        historyDepth: 8,
        recurrence: 3,
        signalStrength: 90,
      }),
    ).toBe(75);
  });

  it('generates contextual nutrition recommendations', () => {
    const engine = new NutritionRecommendationEngineService();
    const recommendations = engine.generate({
      goal: UserGoalType.HYPERTROPHY,
      restrictionsCount: 1,
      insights: [
        {
          type: NutritionInsightType.LOW_PROTEIN,
          title: 'Proteína baixa recorrente',
          occurrences: 4,
        },
      ],
      trends: [
        {
          windowDays: 7,
          mealsAnalyzed: 10,
          direction: NutritionTrendDirection.DECLINING,
          consistencyScore: 42,
          goalAdherenceScore: 48,
        },
      ],
      patterns: [],
    });

    expect(recommendations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: RecommendationCategory.NUTRITION,
          priority: RecommendationPriority.HIGH,
          signalKey: 'NUTRITION:LOW_PROTEIN',
          description: expect.stringContaining('restrições cadastradas'),
        }),
        expect.objectContaining({
          signalKey: 'NUTRITION:TREND_CONSISTENCY',
        }),
      ]),
    );
  });

  it('adapts behavioral recommendations to adherence and stage', () => {
    const engine = new BehavioralRecommendationEngineService();
    const recommendations = engine.generate({
      profile: {
        communicationStyle: 'DIRECT',
        motivationStyle: BehavioralMotivationStyle.PERFORMANCE,
        adherenceStyle: 'STRUCTURED',
        confidenceScore: 0.85,
      },
      motivations: [
        {
          type: BehavioralMotivationStyle.PERFORMANCE,
          weight: 80,
        },
      ],
      adherence: {
        score: 45,
        consistencyScore: 40,
        responseScore: 55,
      },
      stage: StageOfChange.PREPARATION,
      triggers: [
        {
          type: MotivationTriggerType.PERFORMANCE,
          weight: 90,
        },
      ],
    });

    expect(recommendations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          signalKey: 'BEHAVIOR:LOW_ADHERENCE',
        }),
        expect.objectContaining({
          signalKey: 'BEHAVIOR:STAGE:PREPARATION',
        }),
      ]),
    );
  });

  it('generates a critical recovery recommendation only for material churn', () => {
    const engine = new RetentionRecommendationEngineService();
    const recommendations = engine.generate({
      engagement: {
        score: 25,
        messagesLast7Days: 0,
        analysesLast7Days: 0,
      },
      consistency: {
        score: 30,
        continuityScore: 20,
      },
      churn: {
        level: 'HIGH',
        daysInactive: 9,
        activityDrop: 80,
      },
    });

    expect(recommendations[0]).toEqual(
      expect.objectContaining({
        category: RecommendationCategory.RETENTION,
        priority: RecommendationPriority.CRITICAL,
        signalKey: 'RETENTION:CHURN_RECOVERY',
      }),
    );
  });
});
