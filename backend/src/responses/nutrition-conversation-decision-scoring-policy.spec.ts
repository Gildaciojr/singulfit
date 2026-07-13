import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DecisionCandidate } from './conversation-decision.contract';
import type { NutritionConversationContext } from './nutrition-conversation-context.interface';
import { NutritionConversationDecisionEngine } from './nutrition-conversation-decision-engine';
import { NutritionConversationDecisionScoringPolicy } from './nutrition-conversation-decision-scoring-policy';

function context(): NutritionConversationContext {
  return {
    metadata: { mealAnalysisId: 'analysis-id' },
    facts: {
      mealCategory: 'LUNCH',
      foods: [{ name: 'Frango', estimatedGrams: 120 }],
      totalCalories: 520,
      totalProtein: 38,
      totalCarbs: 55,
      totalFat: 16,
      qualityScore: 82,
      confidence: 0.91,
    },
    policies: { requiresEstimateQualification: true },
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
          foods: ['Arroz'],
        },
      ],
      insight: { title: 'Proteína', summary: 'Melhora recente.' },
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
        action: 'Inclua proteína.',
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
      prefersShortMessages: false,
      preferredMessageLength: 600,
      idealEmojiCount: 1,
      fatigue: {
        score: 20,
        repeatedThemeScore: 10,
        repeatedPhraseScore: 10,
      },
      stageOfChange: 'PREPARATION',
      preferredTopics: ['protein'],
      ignoredTopics: [],
      shouldAskQuestion: true,
    },
  };
}

function candidate(
  id: string,
  overrides: Partial<DecisionCandidate> = {},
): DecisionCandidate {
  return {
    id,
    code: 'TEST_ORIGIN',
    category: 'EDUCATION',
    intrinsicPriority: 'P3',
    required: false,
    prohibited: false,
    factIds: ['facts.mealCategory'],
    dependencyIds: [],
    complementaryIds: [],
    conflictingIds: [],
    objectiveCode: `RATIONALE_${id}`,
    ...overrides,
  };
}

function selectedIds(
  plan: ReturnType<NutritionConversationDecisionScoringPolicy['select']>,
) {
  return plan.selectedDecisions.map((decision) => decision.candidateId);
}

function suppression(
  plan: ReturnType<NutritionConversationDecisionScoringPolicy['select']>,
  id: string,
) {
  return plan.suppressedDecisions.find(
    (decision) => decision.candidateId === id,
  );
}

describe('NutritionConversationDecisionScoringPolicy', () => {
  const policy = new NutritionConversationDecisionScoringPolicy();

  it('is deterministic, deeply immutable and does not mutate candidates', () => {
    const source = context();
    const candidates = new NutritionConversationDecisionEngine().generate(
      source,
    );
    const snapshot = JSON.stringify(candidates);
    const first = policy.select(source, candidates);
    const second = policy.select(source, candidates);

    expect(second).toEqual(first);
    expect(JSON.stringify(candidates)).toBe(snapshot);
    const assertFrozen = (value: unknown): void => {
      if (typeof value !== 'object' || value === null) return;
      expect(Object.isFrozen(value)).toBe(true);
      for (const nested of Object.values(value)) assertFrozen(nested);
    };
    assertFrozen(first);
  });

  it('selects every eligible required decision and allows it to exceed budget', () => {
    const source = {
      ...context(),
      communication: {
        ...context().communication,
        prefersShortMessages: true,
      },
    };
    const candidates = [
      candidate('required-a', { required: true, intrinsicPriority: 'P0' }),
      candidate('required-b', { required: true, intrinsicPriority: 'P1' }),
      candidate('required-c', { required: true, intrinsicPriority: 'P2' }),
    ];
    const plan = policy.select(source, candidates);

    expect(plan.maximumCommunicativeDecisions).toBe(2);
    expect(selectedIds(plan)).toEqual([
      'required-a',
      'required-b',
      'required-c',
    ]);
    expect(plan.mandatoryDecisionIds).toEqual([
      'required-a',
      'required-b',
      'required-c',
    ]);
  });

  it('suppresses prohibited candidates explicitly', () => {
    const plan = policy.select(context(), [
      candidate('intent', { required: true, category: 'INTENT' }),
      candidate('prohibited', { prohibited: true }),
    ]);

    expect(selectedIds(plan)).not.toContain('prohibited');
    expect(suppression(plan, 'prohibited')).toEqual(
      expect.objectContaining({ reason: 'PROHIBITED' }),
    );
    expect(plan.prohibitedDecisionCodes).toEqual(['TEST_ORIGIN']);
  });

  it.each([
    [
      'required and prohibited',
      candidate('invalid', { required: true, prohibited: true }),
    ],
    [
      'required without facts',
      candidate('invalid', { required: true, factIds: ['facts.unknown'] }),
    ],
  ])('fails explicitly for %s', (_label, invalid) => {
    expect(() => policy.select(context(), [invalid])).toThrow();
  });

  it('selects a satisfied dependency before its dependent candidate', () => {
    const dependency = candidate('dependency', {
      required: true,
      category: 'INTENT',
      intrinsicPriority: 'P1',
    });
    const dependent = candidate('dependent', {
      intrinsicPriority: 'P2',
      dependencyIds: ['dependency'],
    });
    const plan = policy.select(context(), [dependent, dependency]);

    expect(selectedIds(plan)).toEqual(['dependency', 'dependent']);
  });

  it('suppresses a candidate with an absent dependency', () => {
    const plan = policy.select(context(), [
      candidate('intent', { required: true, category: 'INTENT' }),
      candidate('dependent', { dependencyIds: ['missing'] }),
    ]);

    expect(suppression(plan, 'dependent')).toEqual(
      expect.objectContaining({ reason: 'MISSING_DEPENDENCY' }),
    );
  });

  it('does not require a complementary candidate to select an option', () => {
    const plan = policy.select(context(), [
      candidate('intent', { required: true, category: 'INTENT' }),
      candidate('standalone', { complementaryIds: ['absent-complement'] }),
    ]);

    expect(selectedIds(plan)).toContain('standalone');
  });

  it('uses available complementarity as a deterministic utility advantage', () => {
    const plan = policy.select(
      {
        ...context(),
        communication: {
          ...context().communication,
          preferredMessageLength: 320,
        },
      },
      [
        candidate('base', { required: true, category: 'INTENT' }),
        candidate('option-a', { complementaryIds: ['base'] }),
        candidate('option-b'),
      ],
    );

    expect(selectedIds(plan)).toContain('option-a');
    expect(selectedIds(plan)).not.toContain('option-b');
  });

  it('selects question and suppresses closure when continuation is authorized', () => {
    const plan = policy.select(context(), [
      candidate('nutrition.respond-to-meal', {
        required: true,
        category: 'INTENT',
      }),
      candidate('nutrition.ask-question', {
        category: 'CURIOSITY',
        intrinsicPriority: 'P2',
        factIds: ['communication.shouldAskQuestion'],
        conflictingIds: ['nutrition.close-without-question'],
      }),
      candidate('nutrition.close-without-question', {
        category: 'CLOSURE',
        intrinsicPriority: 'P2',
        factIds: ['communication.shouldAskQuestion'],
        conflictingIds: ['nutrition.ask-question'],
      }),
    ]);

    expect(selectedIds(plan)).toContain('nutrition.ask-question');
    expect(suppression(plan, 'nutrition.close-without-question')).toEqual(
      expect.objectContaining({ reason: 'CONFLICT' }),
    );
  });

  it('gives required decisions precedence in conflicts', () => {
    const required = candidate('required', {
      required: true,
      category: 'INTENT',
      conflictingIds: ['optional'],
    });
    const optional = candidate('optional', {
      intrinsicPriority: 'P0',
      conflictingIds: ['required'],
    });
    const plan = policy.select(context(), [optional, required]);

    expect(selectedIds(plan)).toContain('required');
    expect(suppression(plan, 'optional')).toEqual(
      expect.objectContaining({ reason: 'CONFLICT' }),
    );
  });

  it('fails explicitly when two required decisions conflict', () => {
    expect(() =>
      policy.select(context(), [
        candidate('a', { required: true, conflictingIds: ['b'] }),
        candidate('b', { required: true, conflictingIds: ['a'] }),
      ]),
    ).toThrow('Decisões obrigatórias incompatíveis');
  });

  it('uses intrinsic priority as input and preserves it without producing a score', () => {
    const plan = policy.select(
      {
        ...context(),
        communication: {
          ...context().communication,
          preferredMessageLength: 320,
        },
      },
      [
        candidate('intent', { required: true, category: 'INTENT' }),
        candidate('p3', { intrinsicPriority: 'P3' }),
        candidate('p2', { intrinsicPriority: 'P2' }),
      ],
    );

    expect(selectedIds(plan)).toContain('p2');
    expect(selectedIds(plan)).not.toContain('p3');
    expect(
      plan.selectedDecisions.find((item) => item.candidateId === 'p2'),
    ).toEqual(expect.objectContaining({ intrinsicPriority: 'P2' }));
    expect(JSON.stringify(plan)).not.toMatch(/"score"|effectivePriority/);
  });

  it('chooses required safety as central, then required intent', () => {
    const withSafety = policy.select(context(), [
      candidate('intent', { required: true, category: 'INTENT' }),
      candidate('safety', {
        required: true,
        category: 'SAFETY',
        intrinsicPriority: 'P0',
      }),
    ]);
    const withoutSafety = policy.select(context(), [
      candidate('intent', { required: true, category: 'INTENT' }),
      candidate('emoji', { category: 'PRESENTATION', intrinsicPriority: 'P0' }),
    ]);

    expect(withSafety.primaryDecisionId).toBe('safety');
    expect(withoutSafety.primaryDecisionId).toBe('intent');
    expect(withoutSafety.primaryDecisionId).not.toBe('emoji');
  });

  it.each([
    ['minimal', { fatigue: 20, short: false, length: 300 }, 2],
    ['standard', { fatigue: 20, short: false, length: 600 }, 4],
    ['fatigued', { fatigue: 70, short: false, length: 600 }, 2],
    ['short preference', { fatigue: 20, short: true, length: 600 }, 2],
    ['deep allowed', { fatigue: 20, short: false, length: 900 }, 5],
  ])('calculates %s budget deterministically', (_label, values, expected) => {
    const source = context();
    const adjusted: NutritionConversationContext = {
      ...source,
      communication: {
        ...source.communication,
        fatigue: { ...source.communication.fatigue, score: values.fatigue },
        prefersShortMessages: values.short,
        preferredMessageLength: values.length,
      },
    };
    const candidates = new NutritionConversationDecisionEngine().generate(
      adjusted,
    );
    const plan = policy.select(adjusted, candidates);

    expect(plan.maximumCommunicativeDecisions).toBe(expected);
    expect(plan.maximumCommunicativeDecisions).toBeLessThanOrEqual(6);
  });

  it('suppresses demonstrable redundancy and does not select every macro', () => {
    const source: NutritionConversationContext = {
      ...context(),
      communication: {
        ...context().communication,
        preferredMessageLength: 600,
      },
    };
    const plan = policy.select(source, [
      candidate('nutrition.respond-to-meal', {
        required: true,
        category: 'INTENT',
        intrinsicPriority: 'P1',
      }),
      candidate('nutrition.show-calories', {
        factIds: ['facts.totalCalories'],
      }),
      candidate('nutrition.show-protein', {
        factIds: ['facts.totalProtein'],
      }),
      candidate('nutrition.show-carbohydrates', {
        factIds: ['facts.totalCarbs'],
      }),
      candidate('nutrition.show-fat', { factIds: ['facts.totalFat'] }),
      candidate('nutrition.show-quality', {
        factIds: ['facts.qualityScore'],
      }),
    ]);
    const numericIds = selectedIds(plan).filter((id) =>
      id.startsWith('nutrition.show-'),
    );

    expect(numericIds).toEqual(['nutrition.show-protein']);
    expect(suppression(plan, 'nutrition.show-calories')?.reason).toBe(
      'REDUNDANT',
    );
  });
  it('selects at most one encouragement and one guidance decision', () => {
    const source: NutritionConversationContext = {
      ...context(),
      communication: {
        ...context().communication,
        preferredMessageLength: 900,
      },
    };
    const plan = policy.select(source, [
      candidate('nutrition.respond-to-meal', {
        required: true,
        category: 'INTENT',
        intrinsicPriority: 'P1',
      }),
      candidate('nutrition.provide-recommendation', {
        category: 'CORRECTION',
        intrinsicPriority: 'P2',
        factIds: ['direction.authorizedRecommendation'],
      }),
      candidate('nutrition.correct-limiting-factor', {
        category: 'CORRECTION',
        intrinsicPriority: 'P2',
        factIds: ['direction.supportingEvidence.limitingFactors'],
      }),
      candidate('nutrition.celebrate-improvement', {
        category: 'CELEBRATION',
        factIds: ['userContext.trend'],
      }),
      candidate('nutrition.motivate-with-evidence', {
        category: 'MOTIVATION',
        intrinsicPriority: 'P4',
        factIds: ['direction.supportingEvidence.positiveFactors'],
      }),
    ]);
    const ids = selectedIds(plan);

    expect(
      ids.filter((id) =>
        [
          'nutrition.celebrate-improvement',
          'nutrition.motivate-with-evidence',
        ].includes(id),
      ),
    ).toHaveLength(1);
    expect(
      ids.filter((id) =>
        [
          'nutrition.provide-recommendation',
          'nutrition.correct-limiting-factor',
        ].includes(id),
      ),
    ).toHaveLength(1);
  });
  it('suppresses candidates whose facts are unavailable', () => {
    const plan = policy.select(context(), [
      candidate('intent', { required: true, category: 'INTENT' }),
      candidate('missing-fact', { factIds: ['facts.unknown'] }),
    ]);

    expect(suppression(plan, 'missing-fact')).toEqual(
      expect.objectContaining({ reason: 'CONTEXT_MISMATCH' }),
    );
  });

  it('penalizes memory and question and favors closure under fatigue', () => {
    const base = context();
    const fatigued: NutritionConversationContext = {
      ...base,
      communication: {
        ...base.communication,
        fatigue: {
          score: 80,
          repeatedThemeScore: 80,
          repeatedPhraseScore: 80,
        },
        shouldAskQuestion: false,
      },
    };
    const plan = policy.select(
      fatigued,
      new NutritionConversationDecisionEngine().generate(fatigued),
    );

    expect(selectedIds(plan)).toContain('nutrition.close-without-question');
    expect(selectedIds(plan)).not.toContain('nutrition.ask-question');
    expect(selectedIds(plan)).not.toContain('nutrition.use-memory');
    expect(suppression(plan, 'nutrition.use-memory')?.reason).toBe('FATIGUE');
  });

  it('keeps mandatory estimate qualification despite fatigue and budget', () => {
    const base = context();
    const fatigued: NutritionConversationContext = {
      ...base,
      communication: {
        ...base.communication,
        fatigue: { ...base.communication.fatigue, score: 90 },
        prefersShortMessages: true,
      },
    };
    const plan = policy.select(
      fatigued,
      new NutritionConversationDecisionEngine().generate(fatigued),
    );

    expect(selectedIds(plan)).toEqual(
      expect.arrayContaining([
        'nutrition.respond-to-meal',
        'nutrition.qualify-estimates',
      ]),
    );
  });

  it('handles a safe minimal context without optional signals', () => {
    const base = context();
    const minimal: NutritionConversationContext = {
      ...base,
      policies: { requiresEstimateQualification: false },
      facts: {
        ...base.facts,
        foods: [],
        totalCalories: null,
        totalProtein: null,
        totalCarbs: null,
        totalFat: null,
        qualityScore: null,
      },
      userContext: {
        ...base.userContext,
        goal: null,
        memory: undefined,
        recentMeals: [],
        insight: undefined,
        trend: undefined,
        longitudinalSignal: undefined,
      },
      direction: {
        supportingEvidence: { positiveFactors: [], limitingFactors: [] },
      },
    };
    const plan = policy.select(
      minimal,
      new NutritionConversationDecisionEngine().generate(minimal),
    );

    expect(plan.primaryDecisionId).toBe('nutrition.respond-to-meal');
    expect(plan.selectedDecisions.length).toBeGreaterThanOrEqual(2);
  });

  it('keeps DecisionPlan referentially complete with rationale for every outcome', () => {
    const candidates = new NutritionConversationDecisionEngine().generate(
      context(),
    );
    const plan = policy.select(context(), candidates);
    const outcomes = new Set([
      ...plan.selectedDecisions.map((item) => item.candidateId),
      ...plan.suppressedDecisions.map((item) => item.candidateId),
    ]);

    expect(outcomes).toEqual(new Set(candidates.map((item) => item.id)));
    expect(
      plan.selectedDecisions.every((item) => item.rationaleCodes.length > 0),
    ).toBe(true);
    expect(
      plan.suppressedDecisions.every((item) => item.rationaleCodes.length > 0),
    ).toBe(true);
    expect(selectedIds(plan)).toContain(plan.primaryDecisionId);
  });

  it('uses stable identifier order as the final tie-breaker', () => {
    const plan = policy.select(
      {
        ...context(),
        communication: {
          ...context().communication,
          preferredMessageLength: 320,
        },
      },
      [
        candidate('intent', { required: true, category: 'INTENT' }),
        candidate('z-option'),
        candidate('a-option'),
      ],
    );

    expect(selectedIds(plan)).toContain('a-option');
    expect(selectedIds(plan)).not.toContain('z-option');
  });

  it('rejects duplicate ids and circular required dependencies explicitly', () => {
    expect(() =>
      policy.select(context(), [candidate('same'), candidate('same')]),
    ).toThrow('duplicado');
    expect(() =>
      policy.select(context(), [
        candidate('a', { required: true, dependencyIds: ['b'] }),
        candidate('b', { required: true, dependencyIds: ['a'] }),
      ]),
    ).toThrow('circular');
  });

  it('contains no user-facing text and remains isolated from future and production layers', () => {
    const candidates = new NutritionConversationDecisionEngine().generate(
      context(),
    );
    const plan = policy.select(context(), candidates);
    const serialized = JSON.stringify(plan);
    const source = readFileSync(
      join(__dirname, 'nutrition-conversation-decision-scoring-policy.ts'),
      'utf8',
    );
    const moduleSource = readFileSync(
      join(__dirname, 'response.module.ts'),
      'utf8',
    );
    const responseBuilder = readFileSync(
      join(__dirname, 'response-builder.service.ts'),
      'utf8',
    );

    expect(serialized).not.toMatch(/candidateText|finalContent|messageText/);
    expect(source).not.toMatch(
      /PrismaService|OpenAIGateway|ConfigService|EventBus|Evolution|PromptService|ResponseBuilderService|NutritionResponseFormatter|fetch\(|axios|Date\.now|new Date|Math\.random|console\.log|constructor\s*\(/,
    );
    expect(source).not.toMatch(
      /CompositionPlan|LanguageRealization|Shadow|Comparator|Metric/,
    );
    expect(moduleSource).toContain(
      'NutritionConversationDecisionScoringPolicy',
    );
    expect(responseBuilder).not.toContain(
      'NutritionConversationDecisionScoringPolicy',
    );
  });
});
