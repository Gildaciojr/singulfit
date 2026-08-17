import {
  ChurnRiskLevel,
  CoachCommunicationStyle,
  CoachCoachingStyle,
  CoachMotivationStyle,
  CoachTone,
  FitnessGoal,
  MealCategory,
  Prisma,
  UserGoalType,
} from '@prisma/client';
import { NutritionResponseFormatter } from './nutrition-response.formatter';

describe('NutritionResponseFormatter', () => {
  it('formats meal items and nutritional totals for WhatsApp', () => {
    const formatter = new NutritionResponseFormatter();

    const analysis: Parameters<NutritionResponseFormatter['format']>[0] = {
      items: [
        {
          foodName: 'Arroz Branco',
          estimatedGrams: new Prisma.Decimal('180'),
        },
        {
          foodName: 'Feijão Carioca',
          estimatedGrams: new Prisma.Decimal('120'),
        },
        {
          foodName: 'Peito de Frango',
          estimatedGrams: new Prisma.Decimal('150'),
        },
      ],
      totalCalories: new Prisma.Decimal('523'),
      totalProtein: new Prisma.Decimal('41'),
      totalCarbs: new Prisma.Decimal('52'),
      totalFat: new Prisma.Decimal('11'),
      mealCategory: MealCategory.LUNCH,
      qualityScore: {
        score: 82,
        proteinScore: 90,
        fiberScore: 65,
        goalAdherenceScore: 84,
      },
    };
    const responseContext: Parameters<NutritionResponseFormatter['format']>[1] =
      {
        context: {
          userId: 'user-id',
          goal: FitnessGoal.MUSCLE_GAIN,
          activityLevel: 'MODERATE',
          restrictions: [],
          allergies: [],
          preferences: null,
          latestSnapshot: null,
          memories: [
            { summary: 'Proteína baixa em dias corridos', content: {} },
          ],
          statistics: {
            nutritionAnalysesCount: 4,
            adherenceScore: 80,
            messagesLast7Days: 2,
            messagesLast30Days: 8,
          },
          recentMeals: [],
          activeInsights: [
            {
              id: 'insight-id',
              type: 'LOW_PROTEIN',
              title: 'Proteína oscilando',
              summary: 'O histórico recente mostra variação.',
              occurrences: 2,
            },
          ],
          trends: [],
        },
        recommendations: [
          {
            title: 'Distribua melhor a proteína',
            rationale: 'Contexto persistido',
            action: 'Inclua uma fonte de proteína no almoço.',
          },
        ],
        coach: {
          goal: UserGoalType.HYPERTROPHY,
          communicationStyle: CoachCommunicationStyle.FRIENDLY,
          coachingStyle: CoachCoachingStyle.MOTIVATIONAL,
          tone: CoachTone.MODERATE,
          motivationStyle: CoachMotivationStyle.ACHIEVEMENT,
          consistencyScore: 72,
          engagementScore: 68,
          churnRisk: ChurnRiskLevel.LOW,
          activeDays: 8,
          consecutiveDays: 3,
          motivation: 'Cada repetição aproxima você da sua meta.',
          experience: {
            communication: {
              dominantStyle: 'TECHNICAL',
              confidence: 0.9,
              scores: {
                DIRECT: 10,
                TECHNICAL: 55,
                MOTIVATIONAL: 10,
                DISCIPLINARIAN: 5,
                WARM: 5,
                BALANCED: 15,
              },
            },
            motivation: {
              dominantTrigger: 'PERFORMANCE',
              confidence: 0.88,
              scores: {
                VISUAL_RESULT: 10,
                HEALTH: 10,
                SELF_ESTEEM: 5,
                PERFORMANCE: 50,
                DISCIPLINE: 10,
                LONGEVITY: 5,
                ROUTINE: 10,
              },
            },
            fatigue: {
              score: 20,
              recommendedFrequencyHours: 24,
              repeatedThemeScore: 10,
              repeatedPhraseScore: 0,
              interactionResponseScore: 85,
            },
            reengagement: null,
            momentum: { score: 82 },
            retention: { score: 76 },
            whatsapp: {
              idealMessageLength: 900,
              idealEmojiCount: 0,
              idealFrequencyHours: 24,
              preferredHourUtc: 8,
            },
            canSendCoachMessage: true,
            nextCoachMessageAt: null,
          },
          adaptive: {
            nutritionEvidence: {
              score: 84,
              vegetableScore: 78,
              proteinScore: 90,
              ultraProcessedScore: 86,
              sugarScore: 82,
              fiberScore: 74,
              hydrationScore: 70,
              mealsAnalyzed: 12,
            },
            foodQuality: {
              qualityClass: 'GOOD',
              score: 82,
              positiveFactors: ['proteína', 'ultraprocessados'],
              limitingFactors: ['fibras'],
              explanation:
                'Índice 82/100; ponto forte proteína e oportunidade em fibras.',
            },
            dietaryPatterns: [{ pattern: 'BALANCED', confidence: 0.86 }],
            learning: {
              acceptedCount: 4,
              ignoredCount: 1,
              rejectedCount: 0,
              shortChallengeScore: 78,
              preferredTopics: ['protein'],
              ignoredTopics: [],
              topicScores: { protein: 82 },
              confidence: 0.8,
            },
            communication: {
              profile: 'TECHNICAL',
              confidence: 0.9,
              idealLength: 900,
              structurePreference: 'DATA_ACTION',
            },
            earlyChurn: {
              score: 18,
              level: 'LOW',
              reasons: [],
            },
            recommendationRanking: [],
            evolution: [
              {
                windowDays: 7,
                score: 84,
                previousScore: 78,
                direction: 'IMPROVING',
              },
            ],
            coachMemory: [
              {
                kind: 'VICTORY',
                title: 'Proteína consistente',
                summary: 'A presença de proteína melhorou.',
              },
            ],
          },
        },
        behavior: {
          communicationStyle: 'ANALYTICAL',
          motivationStyle: 'PERFORMANCE',
          adherenceStyle: 'STRUCTURED',
          personalityPattern: 'DATA_ORIENTED',
          stage: 'ACTION',
          adherenceScore: 78,
          engagementScore: 70,
          preferredEngagementHour: 8,
          confidenceScore: 0.86,
          motivations: [{ type: 'PERFORMANCE', weight: 62 }],
          triggers: [{ type: 'PROGRESS', weight: 90 }],
          insights: ['DATA_RESPONSIVE'],
          useShortMessages: false,
          motivationLine:
            'Use a próxima escolha como suporte concreto para seu desempenho.',
        },
        longitudinal: {
          profile: {
            historySize: 12,
            adherenceScore: 82,
            consistencyScore: 78,
          },
          preferences: [
            {
              foodName: 'Peito de frango',
              kind: 'FREQUENT',
              confidence: 0.92,
            },
          ],
          evolution: {
            overallDirection: 'IMPROVING',
            scores: {
              quality: 80,
              hydration: 70,
              vegetables: 65,
              ultraProcessed: 85,
              sugar: 82,
              protein: 90,
            },
          },
          relapse: null,
          goalProgression: {
            goal: UserGoalType.HYPERTROPHY,
            state: 'IMPROVING',
            score: 84,
          },
          coachAdaptation: {
            mode: 'PERFORMANCE',
            reason: 'Alta consistência.',
          },
          memories: [],
          monthlyReview: null,
        },
      };
    const content = formatter.format(analysis, responseContext);

    expect(content).toContain('🍚 Arroz Branco, ~180 g');
    expect(content).toContain('🫘 Feijão Carioca, ~120 g');
    expect(content).toContain('🥩 Peito de Frango, ~150 g');
    expect(content).toContain(
      'Estimativa: 523 kcal — 41 g de proteína, 52 g de carboidratos e 11 g de gorduras.',
    );
    expect(content).not.toMatch(/(?:score|índice|momentum|retenção|\/100)/iu);
    expect(content).toContain('objetivo de ganho de massa');
    expect(content).toContain('Inclua uma fonte de proteína no almoço.');
    expect(content).toContain('Valores estimados pela imagem e podem variar.');
    expect(content).not.toMatch(
      /Você vem mantendo continuidade|preserve o básico|Quer que eu te ajude|\?/iu,
    );
    expect(content.length).toBeLessThanOrEqual(520);

    const withoutRecommendation = formatter.format(analysis, {
      ...responseContext,
      recommendations: [],
    });
    expect(withoutRecommendation).not.toContain(
      'Inclua uma fonte de proteína no almoço.',
    );
    expect(withoutRecommendation).not.toMatch(/\?/u);

    const hydration = formatter.format(analysis, {
      ...responseContext,
      recommendations: [
        {
          title: 'Hidratação',
          rationale: 'Recomendação autorizada',
          action: 'Lembre-se de manter uma boa hidratação ao longo do dia.',
        },
      ],
    });
    expect(hydration).toContain(
      'Lembre-se de manter uma boa hidratação ao longo do dia.',
    );

    const drink = formatter.format(
      {
        ...analysis,
        mealCategory: MealCategory.SNACK,
        items: [
          {
            foodName: 'Água',
            estimatedGrams: new Prisma.Decimal('300'),
          },
        ],
      },
      { ...responseContext, recommendations: [] },
    );
    const fruit = formatter.format(
      {
        ...analysis,
        mealCategory: MealCategory.SNACK,
        items: [
          {
            foodName: 'Banana',
            estimatedGrams: new Prisma.Decimal('90'),
          },
        ],
      },
      { ...responseContext, recommendations: [] },
    );
    expect(drink).toContain('🥤 Água, ~300 g');
    expect(fruit).toContain('🍽️ Banana, ~90 g');
  });
});
