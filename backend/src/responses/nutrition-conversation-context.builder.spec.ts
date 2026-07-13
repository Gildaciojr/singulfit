import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BehavioralCommunicationStyle,
  BehavioralMotivationStyle,
  CoachCoachingStyle,
  CoachCommunicationStyle,
  CoachCommunicationProfileType,
  CoachMotivationStyle,
  CoachMotivationalTrigger,
  CoachTone,
  FitnessGoal,
  GoalProgressionState,
  LongitudinalDirection,
  MealCategory,
  StageOfChange,
  UserGoalType,
} from '@prisma/client';
import {
  BuildNutritionConversationContextInput,
  NutritionConversationContextBuilder,
} from './nutrition-conversation-context.builder';

describe('NutritionConversationContextBuilder', () => {
  const decimal = (value: number) => ({ toNumber: () => value });

  function input(): BuildNutritionConversationContextInput {
    return {
      analysis: {
        id: 'analysis-id',
        mealCategory: MealCategory.LUNCH,
        confidence: decimal(0.87),
        totalCalories: decimal(523.45),
        totalProtein: decimal(41.2),
        totalCarbs: decimal(52.1),
        totalFat: decimal(11.3),
        qualityScore: { score: 82 },
        items: [
          { foodName: 'Arroz', estimatedGrams: decimal(180) },
          { foodName: 'Frango', estimatedGrams: decimal(150) },
        ],
      },
      context: {
        userId: 'user-id',
        goal: FitnessGoal.MUSCLE_GAIN,
        activityLevel: 'MODERATE',
        restrictions: [
          { type: 'INTOLERANCE', description: 'Lactose' },
          'Sem amendoim',
          { ignored: true },
        ],
        allergies: [{ description: 'Camarão' }],
        preferences: {
          preferredMealTimes: [],
          preferredLanguage: 'pt-BR',
          timezone: 'America/Sao_Paulo',
        },
        latestSnapshot: null,
        memories: [
          { summary: 'Proteína baixa em dias corridos', content: {} },
          { summary: 'Prefere café sem açúcar', content: {} },
        ],
        statistics: {
          nutritionAnalysesCount: 8,
          adherenceScore: 74,
          messagesLast7Days: 4,
          messagesLast30Days: 18,
        },
        recentMeals: [
          {
            id: 'meal-1',
            createdAt: new Date('2026-07-10T12:00:00.000Z'),
            category: MealCategory.LUNCH,
            score: 80,
            foods: ['Arroz', 'Feijão'],
          },
          {
            id: 'meal-2',
            createdAt: new Date('2026-07-09T12:00:00.000Z'),
            category: MealCategory.LUNCH,
            score: 75,
            foods: ['Frango'],
          },
          {
            id: 'meal-3',
            createdAt: new Date('2026-07-08T12:00:00.000Z'),
            category: MealCategory.DINNER,
            score: 70,
            foods: ['Ovos'],
          },
        ],
        activeInsights: [
          {
            id: 'insight-1',
            type: 'LOW_PROTEIN',
            title: 'Proteína recorrente',
            summary: 'A proteína melhorou nesta semana.',
            occurrences: 3,
          },
          {
            id: 'insight-2',
            type: 'LOW_FIBER',
            title: 'Fibras',
            summary: 'Inclua mais fibras.',
            occurrences: 2,
          },
        ],
        trends: [
          {
            windowDays: 30,
            averageQualityScore: 72,
            direction: 'STABLE',
            consistencyScore: 70,
            goalAdherenceScore: 71,
          },
          {
            windowDays: 7,
            averageQualityScore: 79,
            direction: 'IMPROVING',
            consistencyScore: 76,
            goalAdherenceScore: 80,
          },
        ],
      },
      recommendations: [
        {
          recommendationId: 'recommendation-1',
          title: 'Priorize proteína',
          action: 'Mantenha uma fonte de proteína no almoço.',
          rationale: 'Proteína baixa recorrente.',
        },
        {
          recommendationId: 'recommendation-2',
          title: 'Inclua fibras',
          action: 'Acrescente vegetais.',
        },
      ],
      coach: {
        goal: UserGoalType.HYPERTROPHY,
        communicationStyle: CoachCommunicationStyle.FORMAL,
        coachingStyle: CoachCoachingStyle.MOTIVATIONAL,
        tone: CoachTone.MODERATE,
        motivationStyle: CoachMotivationStyle.ACHIEVEMENT,
        consistencyScore: 72,
        engagementScore: 68,
        churnRisk: 'LOW',
        activeDays: 8,
        consecutiveDays: 3,
        motivation: 'Continue avançando.',
        experience: {
          communication: {
            dominantStyle: CoachCommunicationProfileType.TECHNICAL,
            confidence: 0.8,
            scores: {
              DIRECT: 20,
              TECHNICAL: 80,
              MOTIVATIONAL: 20,
              DISCIPLINARIAN: 10,
              WARM: 30,
              BALANCED: 40,
            },
          },
          motivation: {
            dominantTrigger: CoachMotivationalTrigger.PERFORMANCE,
            confidence: 0.8,
            scores: {
              VISUAL_RESULT: 10,
              HEALTH: 20,
              SELF_ESTEEM: 10,
              PERFORMANCE: 80,
              DISCIPLINE: 20,
              LONGEVITY: 10,
              ROUTINE: 30,
            },
          },
          fatigue: {
            score: 35,
            recommendedFrequencyHours: 24,
            repeatedThemeScore: 22,
            repeatedPhraseScore: 18,
            interactionResponseScore: 80,
          },
          reengagement: null,
          momentum: { score: 70 },
          retention: { score: 72 },
          whatsapp: {
            idealMessageLength: 420,
            idealEmojiCount: 1,
            idealFrequencyHours: 24,
            preferredHourUtc: 9,
          },
          canSendCoachMessage: true,
          nextCoachMessageAt: null,
        },
        adaptive: {
          nutritionEvidence: {
            score: 78,
            vegetableScore: 70,
            proteinScore: 82,
            ultraProcessedScore: 85,
            sugarScore: 80,
            fiberScore: 72,
            hydrationScore: 65,
            mealsAnalyzed: 8,
          },
          foodQuality: {
            qualityClass: 'GOOD',
            score: 82,
            positiveFactors: ['boa proteína'],
            limitingFactors: ['poucas fibras'],
            explanation: 'Boa base.',
          },
          dietaryPatterns: [],
          learning: {
            acceptedCount: 1,
            ignoredCount: 0,
            rejectedCount: 0,
            shortChallengeScore: 70,
            preferredTopics: ['protein'],
            ignoredTopics: ['hydration'],
            topicScores: { protein: 80 },
            confidence: 0.8,
          },
          communication: {
            profile: 'TECHNICAL',
            confidence: 0.85,
            idealLength: 900,
            structurePreference: 'DATA_ACTION',
          },
          earlyChurn: { score: 20, level: 'LOW', reasons: [] },
          recommendationRanking: [],
          evolution: [],
          coachMemory: [],
        },
      },
      behavior: {
        communicationStyle: BehavioralCommunicationStyle.FRIENDLY,
        motivationStyle: BehavioralMotivationStyle.HEALTH,
        adherenceStyle: 'FLEXIBLE',
        personalityPattern: 'BALANCED',
        stage: StageOfChange.PREPARATION,
        adherenceScore: 74,
        engagementScore: 68,
        preferredEngagementHour: 9,
        confidenceScore: 0.84,
        motivations: [{ type: BehavioralMotivationStyle.HEALTH, weight: 60 }],
        triggers: [{ type: 'HEALTH', weight: 70 }],
        insights: [],
        useShortMessages: true,
        motivationLine: 'Priorize energia e saúde.',
      },
      longitudinal: {
        profile: { historySize: 8, adherenceScore: 74, consistencyScore: 72 },
        preferences: [],
        evolution: null,
        relapse: null,
        goalProgression: null,
        coachAdaptation: null,
        memories: [],
        monthlyReview: null,
      },
    };
  }

  it('builds the specialized nutrition context with metadata, canonical foods and policy separated', () => {
    const result = new NutritionConversationContextBuilder().build(input());

    expect(result.metadata).toEqual({
      mealAnalysisId: 'analysis-id',
      recommendationId: 'recommendation-1',
    });
    expect(result.facts).toEqual({
      mealCategory: MealCategory.LUNCH,
      foods: [
        { name: 'Arroz', estimatedGrams: 180 },
        { name: 'Frango', estimatedGrams: 150 },
      ],
      totalCalories: 523.45,
      totalProtein: 41.2,
      totalCarbs: 52.1,
      totalFat: 11.3,
      qualityScore: 82,
      confidence: 0.87,
    });
    expect(result.policies).toEqual({
      requiresEstimateQualification: true,
    });
    expect(result.facts).not.toHaveProperty('mealAnalysisId');
    expect(result.facts).not.toHaveProperty('identifiedFoods');
    expect(result.facts).not.toHaveProperty('estimatedPortions');
    expect(result.facts).not.toHaveProperty('estimatedDataDisclaimer');
  });

  it('keeps the first ranked recommendation separate from supporting evidence', () => {
    const result = new NutritionConversationContextBuilder().build(input());

    expect(result.direction.authorizedRecommendation).toEqual({
      title: 'Priorize proteína',
      action: 'Mantenha uma fonte de proteína no almoço.',
      rationale: 'Proteína baixa recorrente.',
    });
    expect(result.direction.supportingEvidence).toEqual({
      positiveFactors: ['boa proteína'],
      limitingFactors: ['poucas fibras'],
    });
    expect(result.direction.authorizedRecommendation).not.toHaveProperty(
      'recommendationId',
    );
  });

  it('normalizes Behavior communication and motivation vocabularies', () => {
    const result = new NutritionConversationContextBuilder().build(input());

    expect(result.communication.communicationStyle).toBe('FRIENDLY');
    expect(result.communication.motivationFocus).toBe('HEALTH');
    expect(result.communication).not.toHaveProperty('motivationStyle');
    expect(result.communication).not.toHaveProperty('dominantMotivation');
  });

  it('maps every Behavior communication style explicitly', () => {
    const expected = new Map([
      [BehavioralCommunicationStyle.DIRECT, 'DIRECT'],
      [BehavioralCommunicationStyle.FRIENDLY, 'FRIENDLY'],
      [BehavioralCommunicationStyle.ANALYTICAL, 'ANALYTICAL'],
      [BehavioralCommunicationStyle.COACH, 'COACHING'],
      [BehavioralCommunicationStyle.MOTIVATIONAL, 'MOTIVATIONAL'],
    ]);

    for (const [source, target] of expected) {
      const base = input();
      const result = new NutritionConversationContextBuilder().build({
        ...base,
        behavior: { ...base.behavior, communicationStyle: source },
      });
      expect(result.communication.communicationStyle).toBe(target);
    }
  });

  it('falls back to the explicitly normalized Coach vocabularies', () => {
    const base = input();
    const result = new NutritionConversationContextBuilder().build({
      ...base,
      behavior: {
        ...base.behavior,
        communicationStyle: undefined,
        motivationStyle: undefined,
      },
      coach: {
        ...base.coach,
        communicationStyle: CoachCommunicationStyle.FORMAL,
        motivationStyle: CoachMotivationStyle.DATA_DRIVEN,
      },
    });

    expect(result.communication.communicationStyle).toBe('ANALYTICAL');
    expect(result.communication.motivationFocus).toBe('DATA');
  });

  it('does not expose source communication or motivation enum unions in the output contract', () => {
    const contract = readFileSync(
      join(__dirname, 'nutrition-conversation-context.interface.ts'),
      'utf8',
    );

    expect(contract).not.toMatch(
      /BehavioralCommunicationStyle|CoachCommunicationStyle|BehavioralMotivationStyle|CoachMotivationStyle/,
    );
  });

  it('projects one compact longitudinal evolution signal', () => {
    const base = input();
    const result = new NutritionConversationContextBuilder().build({
      ...base,
      longitudinal: {
        ...base.longitudinal,
        evolution: {
          overallDirection: LongitudinalDirection.IMPROVING,
          scores: {
            quality: 80,
            hydration: 70,
            vegetables: 75,
            ultraProcessed: 85,
            sugar: 82,
            protein: 88,
          },
        },
        goalProgression: {
          goal: UserGoalType.HYPERTROPHY,
          state: GoalProgressionState.STABLE,
          score: 72,
        },
      },
    });

    expect(result.userContext.longitudinalSignal).toEqual({
      kind: 'NUTRITION_EVOLUTION',
      direction: 'IMPROVING',
    });
  });

  it('falls back to goal progression and safely omits absent longitudinal data', () => {
    const base = input();
    const progression = new NutritionConversationContextBuilder().build({
      ...base,
      longitudinal: {
        ...base.longitudinal,
        evolution: null,
        goalProgression: {
          goal: UserGoalType.HYPERTROPHY,
          state: GoalProgressionState.DECLINING,
          score: 61,
        },
      },
    });
    const absent = new NutritionConversationContextBuilder().build({
      ...base,
      longitudinal: undefined,
    });

    expect(progression.userContext.longitudinalSignal).toEqual({
      kind: 'GOAL_PROGRESSION',
      direction: 'DECLINING',
      score: 61,
    });
    expect(absent.userContext).not.toHaveProperty('longitudinalSignal');
  });

  it('orders recent meals locally, preserves time and selects at most two', () => {
    const base = input();
    const result = new NutritionConversationContextBuilder().build({
      ...base,
      context: {
        ...base.context,
        recentMeals: [
          base.context.recentMeals[2],
          base.context.recentMeals[0],
          base.context.recentMeals[1],
        ],
      },
    });

    expect(result.userContext.recentMeals).toEqual([
      expect.objectContaining({ occurredAt: '2026-07-10T12:00:00.000Z' }),
      expect.objectContaining({ occurredAt: '2026-07-09T12:00:00.000Z' }),
    ]);
    expect(result.userContext.recentMeals).toHaveLength(2);
    expect(result.userContext.recentMeals[0]).not.toHaveProperty('id');
  });

  it('selects insight and trend deterministically without changing recommendation precedence', () => {
    const base = input();
    const result = new NutritionConversationContextBuilder().build({
      ...base,
      context: {
        ...base.context,
        activeInsights: [...base.context.activeInsights].reverse(),
        trends: [...base.context.trends].reverse(),
      },
      recommendations: [...base.recommendations].reverse(),
    });

    expect(result.userContext.insight?.title).toBe('Proteína recorrente');
    expect(result.userContext.trend?.windowDays).toBe(7);
    expect(result.direction.authorizedRecommendation?.title).toBe(
      'Inclua fibras',
    );
  });

  it('limits adaptive lists while preserving all current foods, allergies and restrictions', () => {
    const base = input();
    const foodQuality = base.coach.adaptive?.foodQuality;

    if (!foodQuality) {
      throw new Error('Fixture sem qualidade alimentar');
    }
    const restrictions = Array.from(
      { length: 5 },
      (_, index) => `Restrição ${index + 1}`,
    );
    const allergies = Array.from({ length: 5 }, (_, index) => ({
      description: `Alergia ${index + 1}`,
    }));
    const result = new NutritionConversationContextBuilder().build({
      ...base,
      context: { ...base.context, restrictions, allergies },
      coach: {
        ...base.coach,
        adaptive: {
          ...base.coach.adaptive,
          foodQuality: {
            ...foodQuality,
            positiveFactors: ['p1', 'p2', 'p3', 'p4'],
            limitingFactors: ['l1', 'l2', 'l3', 'l4'],
          },
          learning: {
            ...base.coach.adaptive.learning,
            preferredTopics: ['p1', 'p2', 'p3', 'p4'],
            ignoredTopics: ['i1', 'i2', 'i3', 'i4'],
          },
        },
      },
    });

    expect(result.facts.foods).toHaveLength(base.analysis.items.length);
    expect(result.userContext.relevantRestrictions).toHaveLength(5);
    expect(result.userContext.relevantAllergies).toHaveLength(5);
    expect(result.direction.supportingEvidence.positiveFactors).toEqual([
      'p1',
      'p2',
      'p3',
    ]);
    expect(result.direction.supportingEvidence.limitingFactors).toEqual([
      'l1',
      'l2',
      'l3',
    ]);
    expect(result.communication.preferredTopics).toEqual(['p1', 'p2', 'p3']);
    expect(result.communication.ignoredTopics).toEqual(['i1', 'i2', 'i3']);
  });

  it('models message length as a preference and does not invent a hard limit', () => {
    const result = new NutritionConversationContextBuilder().build(input());

    expect(result.communication.preferredMessageLength).toBe(420);
    expect(result.communication).not.toHaveProperty('maximumMessageLength');
    expect(result.communication).not.toHaveProperty('hardMessageLengthLimit');
  });

  it('omits optional values safely and supports empty collections', () => {
    const base = input();
    const result = new NutritionConversationContextBuilder().build({
      ...base,
      analysis: {
        ...base.analysis,
        confidence: null,
        totalCalories: null,
        totalProtein: null,
        totalCarbs: null,
        totalFat: null,
        qualityScore: null,
        items: [],
      },
      context: {
        ...base.context,
        restrictions: [],
        allergies: [],
        preferences: null,
        memories: [],
        recentMeals: [],
        activeInsights: [],
        trends: [],
      },
      recommendations: [],
      coach: { ...base.coach, adaptive: undefined },
      longitudinal: undefined,
    });

    expect(result.facts).toEqual(
      expect.objectContaining({
        foods: [],
        totalCalories: null,
        totalProtein: null,
        totalCarbs: null,
        totalFat: null,
        qualityScore: null,
      }),
    );
    expect(result.facts).not.toHaveProperty('confidence');
    expect(result.metadata).not.toHaveProperty('recommendationId');
    expect(result.userContext).not.toHaveProperty('memory');
    expect(result.userContext).not.toHaveProperty('insight');
    expect(result.userContext).not.toHaveProperty('trend');
    expect(result.userContext).not.toHaveProperty('longitudinalSignal');
    expect(result.direction).not.toHaveProperty('authorizedRecommendation');
    expect(result.direction.supportingEvidence.positiveFactors).toEqual([]);
  });

  it('does not expose sensitive or operational data as linguistic facts', () => {
    const result = new NutritionConversationContextBuilder().build(input());
    const serialized = JSON.stringify(result);

    expect(serialized).not.toMatch(
      /user-id|conversationId|messageId|churnRisk|retention|engagementScore|earlyChurn|aiJob|token|estimatedCost|promptVersion|phone|email/i,
    );
    expect(result.facts).not.toHaveProperty('mealAnalysisId');
    expect(result.direction.authorizedRecommendation).not.toHaveProperty(
      'recommendationId',
    );
  });

  it('deep-freezes the complete result', () => {
    const result = new NutritionConversationContextBuilder().build(input());
    const assertDeepFrozen = (value: unknown): void => {
      if (typeof value !== 'object' || value === null) {
        return;
      }

      expect(Object.isFrozen(value)).toBe(true);
      for (const nested of Object.values(value)) {
        assertDeepFrozen(nested);
      }
    };

    assertDeepFrozen(result);
  });

  it('does not mutate inputs and is deterministic', () => {
    const source = input();
    const originalRecentMeals = source.context.recentMeals.map((meal) => ({
      ...meal,
      foods: [...meal.foods],
    }));
    const builder = new NutritionConversationContextBuilder();
    const first = builder.build(source);
    const second = builder.build(source);

    expect(second).toEqual(first);
    expect(source.context.recentMeals).toEqual(originalRecentMeals);
  });

  it('selects memory deterministically by relevance without exposing its content', () => {
    const base = input();
    const result = new NutritionConversationContextBuilder().build({
      ...base,
      context: {
        ...base.context,
        memories: [
          { summary: 'Proteína no almoço', content: { private: 'secret-1' } },
          {
            summary: 'Almoço com proteína em dias corridos',
            content: { private: 'secret-2' },
          },
        ],
      },
    });

    expect(result.userContext.memory).toEqual({
      summary: 'Almoço com proteína em dias corridos',
    });
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('asks a question only in contemplation or preparation when fatigue is below 70', () => {
    const base = input();
    const preparation = new NutritionConversationContextBuilder().build(base);
    const action = new NutritionConversationContextBuilder().build({
      ...base,
      behavior: { ...base.behavior, stage: StageOfChange.ACTION },
    });
    const fatigued = new NutritionConversationContextBuilder().build({
      ...base,
      coach: {
        ...base.coach,
        experience: {
          ...base.coach.experience,
          fatigue: { ...base.coach.experience.fatigue, score: 70 },
        },
      },
    });

    expect(preparation.communication.shouldAskQuestion).toBe(true);
    expect(action.communication.shouldAskQuestion).toBe(false);
    expect(fatigued.communication.shouldAskQuestion).toBe(false);
  });

  it('has no service, network, database, clock or random dependency', () => {
    const builderSource = readFileSync(
      join(__dirname, 'nutrition-conversation-context.builder.ts'),
      'utf8',
    );

    expect(builderSource).not.toMatch(
      /PrismaService|OpenAI|fetch\(|axios|Date\.now|new Date|Math\.random|console\.log/,
    );
    expect(builderSource).not.toMatch(/constructor\s*\(/);
  });
});
