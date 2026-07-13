import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { NutritionConversationContext } from './nutrition-conversation-context.interface';
import { NutritionConversationDecisionEngine } from './nutrition-conversation-decision-engine';

function context(): NutritionConversationContext {
  return {
    metadata: {
      mealAnalysisId: 'analysis-id',
      recommendationId: 'recommendation-id',
    },
    facts: {
      mealCategory: 'LUNCH',
      foods: [
        { name: 'Arroz', estimatedGrams: 150 },
        { name: 'Frango', estimatedGrams: 120 },
      ],
      totalCalories: 520,
      totalProtein: 38,
      totalCarbs: 55,
      totalFat: 16,
      qualityScore: 82,
      confidence: 0.91,
    },
    policies: {
      requiresEstimateQualification: true,
    },
    userContext: {
      goal: 'MUSCLE_GAIN',
      activityLevel: 'MODERATE',
      relevantRestrictions: [],
      relevantAllergies: [],
      preferredLanguage: 'pt-BR',
      timezone: 'America/Sao_Paulo',
      memory: { summary: 'Proteína em refeições corridas' },
      recentMeals: [
        {
          occurredAt: '2026-07-09T12:00:00.000Z',
          category: 'LUNCH',
          score: 76,
          foods: ['Arroz', 'Ovos'],
        },
      ],
      insight: {
        title: 'Proteína recorrente',
        summary: 'A presença de proteína melhorou.',
      },
      trend: {
        windowDays: 7,
        averageQualityScore: 79,
        direction: 'IMPROVING',
        consistencyScore: 75,
        goalAdherenceScore: 80,
      },
      longitudinalSignal: {
        kind: 'NUTRITION_EVOLUTION',
        direction: 'IMPROVING',
      },
    },
    direction: {
      authorizedRecommendation: {
        title: 'Mantenha proteína',
        action: 'Inclua uma fonte de proteína.',
        rationale: 'Ajuda na saciedade.',
      },
      supportingEvidence: {
        positiveFactors: ['boa proteína'],
        limitingFactors: ['poucas fibras'],
      },
    },
    communication: {
      communicationStyle: 'FRIENDLY',
      coachingStyle: 'MOTIVATIONAL',
      tone: 'MODERATE',
      motivationFocus: 'PERFORMANCE',
      prefersShortMessages: true,
      preferredMessageLength: 420,
      idealEmojiCount: 1,
      fatigue: {
        score: 35,
        repeatedThemeScore: 20,
        repeatedPhraseScore: 15,
      },
      stageOfChange: 'PREPARATION',
      preferredTopics: ['protein'],
      ignoredTopics: [],
      shouldAskQuestion: true,
    },
  };
}

function candidateIds(
  result: ReturnType<NutritionConversationDecisionEngine['generate']>,
) {
  return result.map((candidate) => candidate.id);
}

describe('NutritionConversationDecisionEngine', () => {
  it('generates the same immutable candidates for the same context', () => {
    const engine = new NutritionConversationDecisionEngine();
    const source = context();
    const first = engine.generate(source);
    const second = engine.generate(source);

    expect(second).toEqual(first);
    expect(Object.isFrozen(first)).toBe(true);
    for (const candidate of first) {
      expect(Object.isFrozen(candidate)).toBe(true);
      expect(Object.isFrozen(candidate.factIds)).toBe(true);
      expect(Object.isFrozen(candidate.dependencyIds)).toBe(true);
      expect(Object.isFrozen(candidate.complementaryIds)).toBe(true);
      expect(Object.isFrozen(candidate.conflictingIds)).toBe(true);
    }
  });

  it('always emits the meal intent and required estimate qualification when policy requires it', () => {
    const result = new NutritionConversationDecisionEngine().generate(
      context(),
    );
    const required = result.filter((candidate) => candidate.required);

    expect(required).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'nutrition.respond-to-meal',
          category: 'INTENT',
          intrinsicPriority: 'P1',
        }),
        expect.objectContaining({
          id: 'nutrition.qualify-estimates',
          category: 'SAFETY',
          intrinsicPriority: 'P0',
        }),
      ]),
    );
  });

  it('omits estimate qualification when its policy is disabled', () => {
    const source = context();
    const result = new NutritionConversationDecisionEngine().generate({
      ...source,
      policies: { requiresEstimateQualification: false },
    });

    expect(candidateIds(result)).not.toContain('nutrition.qualify-estimates');
    expect(candidateIds(result)).toContain('nutrition.respond-to-meal');
  });

  it('emits optional candidates only when their supporting context exists', () => {
    const result = new NutritionConversationDecisionEngine().generate(
      context(),
    );

    expect(candidateIds(result)).toEqual(
      expect.arrayContaining([
        'nutrition.acknowledge-meal',
        'nutrition.show-calories',
        'nutrition.show-protein',
        'nutrition.mention-goal',
        'nutrition.use-memory',
        'nutrition.compare-history',
        'nutrition.mention-insight',
        'nutrition.mention-trend',
        'nutrition.mention-longitudinal',
        'nutrition.provide-recommendation',
        'nutrition.acknowledge-positive',
        'nutrition.correct-limiting-factor',
        'nutrition.celebrate-improvement',
        'nutrition.motivate-with-evidence',
        'nutrition.ask-question',
        'nutrition.respond-briefly',
        'nutrition.use-emoji',
      ]),
    );
  });

  it('does not invent candidates for absent optional facts', () => {
    const source = context();
    const result = new NutritionConversationDecisionEngine().generate({
      ...source,
      facts: {
        ...source.facts,
        foods: [],
        totalCalories: null,
        totalProtein: null,
        totalCarbs: null,
        totalFat: null,
        qualityScore: null,
      },
      userContext: {
        ...source.userContext,
        goal: null,
        memory: undefined,
        recentMeals: [],
        insight: undefined,
        trend: undefined,
        longitudinalSignal: undefined,
      },
      direction: {
        supportingEvidence: {
          positiveFactors: [],
          limitingFactors: [],
        },
      },
      communication: {
        ...source.communication,
        prefersShortMessages: false,
        idealEmojiCount: 0,
      },
    });

    const absentCandidates = [
      'nutrition.acknowledge-meal',
      'nutrition.show-calories',
      'nutrition.show-protein',
      'nutrition.mention-goal',
      'nutrition.use-memory',
      'nutrition.compare-history',
      'nutrition.mention-insight',
      'nutrition.mention-trend',
      'nutrition.mention-longitudinal',
      'nutrition.provide-recommendation',
      'nutrition.acknowledge-positive',
      'nutrition.correct-limiting-factor',
      'nutrition.celebrate-improvement',
      'nutrition.motivate-with-evidence',
      'nutrition.respond-briefly',
      'nutrition.use-emoji',
    ];

    for (const candidateId of absentCandidates) {
      expect(candidateIds(result)).not.toContain(candidateId);
    }
  });

  it('declares dependencies without resolving or removing candidates', () => {
    const result = new NutritionConversationDecisionEngine().generate(
      context(),
    );
    const recommendation = result.find(
      (candidate) => candidate.id === 'nutrition.provide-recommendation',
    );
    const motivation = result.find(
      (candidate) => candidate.id === 'nutrition.motivate-with-evidence',
    );

    expect(recommendation?.dependencyIds).toEqual([
      'nutrition.respond-to-meal',
    ]);
    expect(motivation?.dependencyIds).toEqual([]);
    expect(motivation?.complementaryIds).toEqual([
      'nutrition.acknowledge-positive',
      'nutrition.celebrate-improvement',
    ]);
    expect(motivation?.factIds).toEqual([
      'direction.supportingEvidence.positiveFactors',
      'userContext.trend',
      'userContext.longitudinalSignal',
    ]);
    expect(candidateIds(result)).toContain('nutrition.acknowledge-positive');
  });

  it('emits question and closure together and only declares their conflict', () => {
    const result = new NutritionConversationDecisionEngine().generate(
      context(),
    );
    const ask = result.find(
      (candidate) => candidate.id === 'nutrition.ask-question',
    );
    const close = result.find(
      (candidate) => candidate.id === 'nutrition.close-without-question',
    );

    expect(ask?.conflictingIds).toEqual(['nutrition.close-without-question']);
    expect(close?.conflictingIds).toEqual(['nutrition.ask-question']);
  });
  it('emits load reduction deterministically for high fatigue', () => {
    const source = context();
    const result = new NutritionConversationDecisionEngine().generate({
      ...source,
      communication: {
        ...source.communication,
        fatigue: {
          ...source.communication.fatigue,
          score: 70,
        },
        shouldAskQuestion: false,
      },
    });

    expect(candidateIds(result)).toEqual(
      expect.arrayContaining([
        'nutrition.close-without-question',
        'nutrition.reduce-conversational-load',
      ]),
    );
  });

  it('keeps every dependency, complement and conflict referentially valid', () => {
    const result = new NutritionConversationDecisionEngine().generate(
      context(),
    );
    const ids = new Set(candidateIds(result));

    for (const candidate of result) {
      for (const reference of [
        ...candidate.dependencyIds,
        ...candidate.complementaryIds,
        ...candidate.conflictingIds,
      ]) {
        expect(ids.has(reference)).toBe(true);
      }
    }
  });
  it('does not create an orphan complement when positive factors exist without foods', () => {
    const source = context();
    const edgeContext: NutritionConversationContext = {
      ...source,
      facts: {
        ...source.facts,
        foods: [],
      },
    };
    const engine = new NutritionConversationDecisionEngine();
    const first = engine.generate(edgeContext);
    const second = engine.generate(edgeContext);
    const ids = new Set(candidateIds(first));
    const positive = first.find(
      (candidate) => candidate.id === 'nutrition.acknowledge-positive',
    );

    expect(positive).toBeDefined();
    expect(ids.has('nutrition.acknowledge-meal')).toBe(false);
    expect(positive?.complementaryIds).toEqual([]);
    expect(second).toEqual(first);
    expect(Object.isFrozen(first)).toBe(true);

    for (const candidate of first) {
      expect(Object.isFrozen(candidate)).toBe(true);
      expect(Object.isFrozen(candidate.dependencyIds)).toBe(true);
      expect(Object.isFrozen(candidate.complementaryIds)).toBe(true);
      expect(Object.isFrozen(candidate.conflictingIds)).toBe(true);
      for (const reference of [
        ...candidate.dependencyIds,
        ...candidate.complementaryIds,
        ...candidate.conflictingIds,
      ]) {
        expect(ids.has(reference)).toBe(true);
      }
    }
  });
  it('contains only machine-readable identifiers and no user-facing text field', () => {
    const result = new NutritionConversationDecisionEngine().generate(
      context(),
    );
    const serialized = JSON.stringify(result);

    expect(serialized).not.toMatch(
      /candidateText|finalContent|messageText|content|title|summary|action/,
    );
    for (const candidate of result) {
      expect(Object.keys(candidate).sort()).toEqual(
        [
          'category',
          'code',
          'complementaryIds',
          'conflictingIds',
          'dependencyIds',
          'factIds',
          'id',
          'objectiveCode',
          'intrinsicPriority',
          'prohibited',
          'required',
        ].sort(),
      );
    }
  });

  it('has no database, OpenAI, service, clock, random or logging dependency', () => {
    const source = readFileSync(
      join(__dirname, 'nutrition-conversation-decision-engine.ts'),
      'utf8',
    );

    expect(source).not.toMatch(
      /PrismaService|@prisma\/client|OpenAI|PromptService|Evolution|Worker|EventBus|fetch\(|axios|Date\.now|new Date|Math\.random|console\.log|constructor\s*\(/,
    );
  });

  it('is not registered or consumed by the production response flow', () => {
    const moduleSource = readFileSync(
      join(__dirname, 'response.module.ts'),
      'utf8',
    );
    const builderSource = readFileSync(
      join(__dirname, 'response-builder.service.ts'),
      'utf8',
    );

    expect(moduleSource).toContain('NutritionConversationDecisionEngine');
    expect(builderSource).not.toContain('NutritionConversationDecisionEngine');
  });
});
