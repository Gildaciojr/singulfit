import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LanguageRealizationResult } from './conversation-language-realization.contract';
import { NutritionConversationAuthorizedFactsBuilder } from './nutrition-conversation-authorized-facts.builder';
import { NutritionConversationComposer } from './nutrition-conversation-composer';
import type { NutritionConversationContext } from './nutrition-conversation-context.interface';
import { NutritionConversationDecisionEngine } from './nutrition-conversation-decision-engine';
import { NutritionConversationDecisionScoringPolicy } from './nutrition-conversation-decision-scoring-policy';
import { SanitizedConversationPayloadBuilder } from './sanitized-conversation-payload.builder';

function context(): NutritionConversationContext {
  return {
    metadata: {
      mealAnalysisId: 'internal-analysis-123',
      recommendationId: 'internal-recommendation-456',
    },
    facts: {
      mealCategory: 'LUNCH',
      foods: [{ name: 'Frango', estimatedGrams: 120 }],
      totalCalories: 520,
      totalProtein: null,
      totalCarbs: 55,
      totalFat: null,
      qualityScore: 82,
      confidence: 0.61,
    },
    policies: { requiresEstimateQualification: true },
    userContext: {
      goal: 'MUSCLE_GAIN',
      activityLevel: 'MODERATE',
      relevantRestrictions: [{ description: 'Restrição relevante' }],
      relevantAllergies: [{ description: 'Alergia relevante' }],
      preferredLanguage: 'pt-BR',
      timezone: 'America/Sao_Paulo',
      memory: { summary: 'Prefere refeições simples' },
      recentMeals: [
        {
          occurredAt: '2026-07-10T12:00:00.000Z',
          category: 'LUNCH',
          score: 75,
          foods: ['Arroz'],
        },
      ],
      insight: { title: 'Consistência', summary: 'Evolução recente' },
      trend: {
        windowDays: 7,
        averageQualityScore: 78,
        direction: 'IMPROVING',
        consistencyScore: 80,
        goalAdherenceScore: 76,
      },
      longitudinalSignal: {
        kind: 'NUTRITION_EVOLUTION',
        direction: 'IMPROVING',
      },
    },
    direction: {
      authorizedRecommendation: {
        title: 'Ajuste autorizado',
        action: 'Adicionar fibras',
      },
      supportingEvidence: {
        positiveFactors: ['Proteína adequada'],
        limitingFactors: ['Poucas fibras'],
      },
    },
    communication: {
      communicationStyle: 'FRIENDLY',
      coachingStyle: 'MOTIVATIONAL',
      tone: 'MODERATE',
      motivationFocus: 'PERFORMANCE',
      prefersShortMessages: false,
      preferredMessageLength: 900,
      idealEmojiCount: 1,
      fatigue: {
        score: 20,
        repeatedThemeScore: 10,
        repeatedPhraseScore: 10,
      },
      stageOfChange: 'PREPARATION',
      preferredTopics: ['proteína'],
      ignoredTopics: [],
      shouldAskQuestion: true,
    },
  };
}

function assertDeepFrozen(value: unknown): void {
  if (typeof value !== 'object' || value === null) return;
  expect(Object.isFrozen(value)).toBe(true);
  Object.values(value).forEach(assertDeepFrozen);
}

describe('Conversation Layer stage 6.1', () => {
  it('materializes deterministic AuthorizedFacts with separated classifications', () => {
    const source = context();
    const builder = new NutritionConversationAuthorizedFactsBuilder();
    const first = builder.build(source);
    const second = builder.build(source);

    expect(second).toEqual(first);
    expect(first.allowed.map((fact) => fact.id)).toEqual(
      expect.arrayContaining([
        'facts.totalCalories',
        'facts.totalCarbs',
        'facts.confidence',
        'direction.authorizedRecommendation',
      ]),
    );
    expect(first.allowed.map((fact) => fact.id)).not.toContain(
      'facts.totalProtein',
    );
    expect(first.allowed.map((fact) => fact.id)).not.toContain(
      'facts.totalFat',
    );
    expect(first.restricted).toEqual([
      'metadata.mealAnalysisId',
      'metadata.recommendationId',
    ]);
    expect(first.sensitive.map((fact) => fact.id)).toEqual(
      expect.arrayContaining([
        'userContext.goal',
        'userContext.relevantRestrictions',
        'userContext.relevantAllergies',
        'userContext.memory',
        'userContext.recentMeals',
        'userContext.longitudinalSignal',
      ]),
    );
    expect(first.disclaimerRequired).toEqual([
      'facts.foods',
      'facts.totalCalories',
      'facts.totalCarbs',
    ]);
    assertDeepFrozen(first);
  });

  it('keeps estimate qualification eligible with partially available macros', () => {
    const source = context();
    const candidates = new NutritionConversationDecisionEngine().generate(
      source,
    );
    const qualification = candidates.find(
      (candidate) => candidate.id === 'nutrition.qualify-estimates',
    );

    expect(qualification?.required).toBe(true);
    expect(qualification?.factIds).toEqual([
      'facts.foods',
      'facts.totalCalories',
      'facts.totalCarbs',
    ]);
    expect(() =>
      new NutritionConversationDecisionScoringPolicy().select(
        source,
        candidates,
      ),
    ).not.toThrow();
  });

  it('keeps qualification valid when every nutritional total is absent', () => {
    const base = context();
    const source: NutritionConversationContext = {
      ...base,
      facts: {
        ...base.facts,
        totalCalories: null,
        totalProtein: null,
        totalCarbs: null,
        totalFat: null,
      },
    };
    const candidates = new NutritionConversationDecisionEngine().generate(
      source,
    );
    const qualification = candidates.find(
      (candidate) => candidate.id === 'nutrition.qualify-estimates',
    );

    expect(qualification?.factIds).toEqual(['facts.foods']);
    expect(() =>
      new NutritionConversationDecisionScoringPolicy().select(
        source,
        candidates,
      ),
    ).not.toThrow();
  });
  it('builds a deterministic deeply frozen payload without operational metadata or technical ids', () => {
    const source = context();
    const authorizedFacts =
      new NutritionConversationAuthorizedFactsBuilder().build(source);
    const candidates = new NutritionConversationDecisionEngine().generate(
      source,
    );
    const decisionPlan =
      new NutritionConversationDecisionScoringPolicy().select(
        source,
        candidates,
      );
    const compositionPlan = new NutritionConversationComposer().compose(
      source,
      decisionPlan,
    );
    const builder = new SanitizedConversationPayloadBuilder();
    const first = builder.build({
      context: source,
      authorizedFacts,
      decisionPlan,
      compositionPlan,
    });
    const second = builder.build({
      context: source,
      authorizedFacts,
      decisionPlan,
      compositionPlan,
    });
    const serialized = JSON.stringify(first);

    expect(second).toEqual(first);
    expect(first.selectedDecisions).toContain('RESPOND_TO_MEAL');
    expect(first.structure.blocks.length).toBeGreaterThan(0);
    expect(serialized).not.toMatch(
      /internal-analysis-123|internal-recommendation-456|mealAnalysisId|recommendationId|conversationId|providerId|userId|blockId|decisionId|nutrition\./,
    );
    expect(serialized).not.toContain('restricted');
    assertDeepFrozen(first);
  });

  it('rejects a composition that references a non-authorized fact', () => {
    const source = context();
    const authorizedFacts =
      new NutritionConversationAuthorizedFactsBuilder().build(source);
    const candidates = new NutritionConversationDecisionEngine().generate(
      source,
    );
    const decisionPlan =
      new NutritionConversationDecisionScoringPolicy().select(
        source,
        candidates,
      );
    const compositionPlan = new NutritionConversationComposer().compose(
      source,
      decisionPlan,
    );
    const invalidComposition = {
      ...compositionPlan,
      blocks: [
        {
          ...compositionPlan.blocks[0],
          factIds: ['metadata.mealAnalysisId'],
        },
      ],
    };

    expect(() =>
      new SanitizedConversationPayloadBuilder().build({
        context: source,
        authorizedFacts,
        decisionPlan,
        compositionPlan: invalidComposition,
      }),
    ).toThrow('Fato não autorizado');
  });

  it('supports completed, partial, fallback and invalid structure audit states', () => {
    const common = {
      id: 'realization-reference',
      sanitizedPayloadReference: 'sanitized-payload:reference',
      candidateText: null,
      candidateTextSource: 'VALIDATED_UNITS',
      realizedUnits: [],
      omittedUnits: [],
      realizedFacts: [],
      omittedFacts: [],
      realizedDecisions: [],
      omittedDecisions: [],
      disclaimerRealized: false,
      questionRealized: false,
      closingRealized: false,
      producedLength: 0,
      producedQuestionCount: 0,
      warningCodes: [],
    } as const;
    const completed: LanguageRealizationResult = {
      ...common,
      status: 'COMPLETED',
    };
    const partial: LanguageRealizationResult = {
      ...common,
      status: 'PARTIALLY_COMPLETED',
      omittedUnits: [
        {
          blockKey: 'block-2-question',
          decisionCodes: ['ASK_QUESTION'],
          factKeys: [],
          reason: 'COMMUNICATIVE_BUDGET',
        },
      ],
    };
    const fallback: LanguageRealizationResult = {
      ...common,
      status: 'FALLBACK',
      fallbackReason: 'VALIDATION_REJECTED',
    };
    const invalid: LanguageRealizationResult = {
      ...common,
      status: 'INVALID_STRUCTURE',
      fallbackReason: 'INVALID_STRUCTURE',
      failureCode: 'MISSING_REQUIRED_BLOCK',
    };

    expect([
      completed.status,
      partial.status,
      fallback.status,
      invalid.status,
    ]).toEqual([
      'COMPLETED',
      'PARTIALLY_COMPLETED',
      'FALLBACK',
      'INVALID_STRUCTURE',
    ]);
  });

  it('keeps both runtime builders isolated from services and probabilistic execution', () => {
    const files = [
      'nutrition-conversation-authorized-facts.builder.ts',
      'sanitized-conversation-payload.builder.ts',
    ];
    for (const file of files) {
      const source = readFileSync(join(__dirname, file), 'utf8');
      expect(source).not.toMatch(
        /PrismaService|OpenAI|PromptService|Evolution|EventBus|ConfigService|fetch\(|axios|Date\.now|new Date|Math\.random|console\.log|constructor\s*\(/,
      );
    }
    const moduleSource = readFileSync(
      join(__dirname, 'response.module.ts'),
      'utf8',
    );
    const responseBuilder = readFileSync(
      join(__dirname, 'response-builder.service.ts'),
      'utf8',
    );
    expect(moduleSource).toMatch(
      /NutritionConversationAuthorizedFactsBuilder|SanitizedConversationPayloadBuilder/,
    );
    expect(responseBuilder).not.toMatch(
      /NutritionConversationAuthorizedFactsBuilder|SanitizedConversationPayloadBuilder/,
    );
  });
});
