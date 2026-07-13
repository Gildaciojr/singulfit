import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  DecisionPlan,
  SelectedDecision,
} from './conversation-decision.contract';
import { NutritionConversationComposer } from './nutrition-conversation-composer';
import { NutritionConversationDecisionEngine } from './nutrition-conversation-decision-engine';
import { NutritionConversationDecisionScoringPolicy } from './nutrition-conversation-decision-scoring-policy';
import type { NutritionConversationContext } from './nutrition-conversation-context.interface';

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
    policies: { requiresEstimateQualification: false },
    userContext: {
      goal: 'MUSCLE_GAIN',
      activityLevel: 'MODERATE',
      relevantRestrictions: [],
      relevantAllergies: [],
      preferredLanguage: 'pt-BR',
      timezone: 'America/Sao_Paulo',
      recentMeals: [],
    },
    direction: {
      supportingEvidence: { positiveFactors: [], limitingFactors: [] },
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
      preferredTopics: [],
      ignoredTopics: [],
      shouldAskQuestion: true,
    },
  };
}

function selected(candidateId: string, order: number): SelectedDecision {
  return {
    candidateId,
    code: 'TEST_ORIGIN',
    intrinsicPriority: 'P2',
    order,
    factIds: ['facts.mealCategory'],
    rationaleCodes: ['SELECTED_BY_POLICY'],
  };
}

function plan(
  ids: readonly string[],
  mandatoryDecisionIds: readonly string[] = [],
): DecisionPlan {
  return {
    id: 'nutrition-decision-plan:analysis-id',
    primaryDecisionId: ids[0],
    selectedDecisions: ids.map(selected),
    suppressedDecisions: [],
    mandatoryDecisionIds,
    prohibitedDecisionCodes: [],
    maximumCommunicativeDecisions: 3,
    maximumQuestions: 1,
    maximumActions: 1,
  };
}

describe('NutritionConversationComposer', () => {
  const composer = new NutritionConversationComposer();

  it('orders and groups compatible decisions without empty blocks', () => {
    const result = composer.compose(
      context(),
      plan([
        'nutrition.respond-to-meal',
        'nutrition.show-protein',
        'nutrition.show-carbohydrates',
        'nutrition.acknowledge-meal',
        'nutrition.ask-question',
      ]),
    );

    expect(result.blocks.map((block) => block.type)).toEqual([
      'FACTUAL_ACKNOWLEDGEMENT',
      'PRIMARY_OBSERVATION',
      'CLARIFYING_QUESTION',
    ]);
    expect(result.blocks[1].decisionIds).toEqual([
      'nutrition.respond-to-meal',
      'nutrition.show-protein',
      'nutrition.show-carbohydrates',
    ]);
    expect(result.blocks.every((block) => block.decisionIds.length > 0)).toBe(
      true,
    );
  });

  it('creates the required disclaimer structurally and never in isolation', () => {
    const source = {
      ...context(),
      policies: { requiresEstimateQualification: true },
    };
    const result = composer.compose(
      source,
      plan(
        ['nutrition.respond-to-meal', 'nutrition.qualify-estimates'],
        ['nutrition.respond-to-meal', 'nutrition.qualify-estimates'],
      ),
    );

    expect(result.blocks[0].type).toBe('UNCERTAINTY_QUALIFICATION');
    expect(result.blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'PRIMARY_OBSERVATION' }),
      ]),
    );
    expect(() =>
      composer.compose(source, plan(['nutrition.respond-to-meal'])),
    ).toThrow('qualificação obrigatória');
  });

  it('only creates a selected question and requires preceding content', () => {
    const withoutQuestion = composer.compose(
      context(),
      plan(['nutrition.respond-to-meal']),
    );
    const withQuestion = composer.compose(
      context(),
      plan(['nutrition.respond-to-meal', 'nutrition.ask-question']),
    );

    expect(withoutQuestion.questionBlockId).toBeUndefined();
    expect(withQuestion.questionBlockId).toBe(withQuestion.blocks[1].id);
    expect(() =>
      composer.compose(context(), plan(['nutrition.ask-question'])),
    ).toThrow('Pergunta sem bloco');
  });

  it('places one closing block in the final position', () => {
    const result = composer.compose(
      context(),
      plan([
        'nutrition.respond-to-meal',
        'nutrition.acknowledge-meal',
        'nutrition.close-without-question',
      ]),
    );
    const closings = result.blocks.filter((block) =>
      block.decisionIds.includes('nutrition.close-without-question'),
    );

    expect(closings).toHaveLength(1);
    expect(result.blocks.at(-1)?.id).toBe(result.closingBlockId);
  });

  it('attaches motivation to support instead of making it dominant', () => {
    const result = composer.compose(
      context(),
      plan([
        'nutrition.respond-to-meal',
        'nutrition.acknowledge-positive',
        'nutrition.motivate-with-evidence',
      ]),
    );
    const recognition = result.blocks.find(
      (block) => block.type === 'FACTUAL_ACKNOWLEDGEMENT',
    );

    expect(recognition?.decisionIds).toContain(
      'nutrition.motivate-with-evidence',
    );
    expect(result.blocks.at(-1)?.type).not.toBe('EVIDENCE_BASED_MOTIVATION');
    expect(() =>
      composer.compose(
        context(),
        plan(['nutrition.respond-to-meal', 'nutrition.motivate-with-evidence']),
      ),
    ).toThrow('Motivação sem decisão estrutural de apoio');
  });

  it.each([
    ['minimal', 80, 600, 2, 'FAST', 'MINIMAL'],
    ['standard', 20, 600, 3, 'PROGRESSIVE', 'MODERATE'],
    ['deep', 20, 900, 5, 'PROGRESSIVE', 'DEEP'],
  ])(
    'models %s rhythm and depth deterministically',
    (_label, fatigue, length, budget, rhythm, depth) => {
      const base = context();
      const source: NutritionConversationContext = {
        ...base,
        communication: {
          ...base.communication,
          fatigue: { ...base.communication.fatigue, score: fatigue },
          preferredMessageLength: length,
        },
      };
      const input = {
        ...plan(['nutrition.respond-to-meal']),
        maximumCommunicativeDecisions: budget,
      };

      expect(composer.compose(source, input)).toEqual(
        expect.objectContaining({ rhythm, depth }),
      );
    },
  );

  it.each([
    [['nutrition.respond-to-meal'], 'LOW'],
    [
      [
        'nutrition.respond-to-meal',
        'nutrition.acknowledge-meal',
        'nutrition.mention-insight',
      ],
      'MEDIUM',
    ],
    [
      [
        'nutrition.respond-to-meal',
        'nutrition.acknowledge-meal',
        'nutrition.mention-insight',
        'nutrition.use-memory',
        'nutrition.mention-trend',
      ],
      'HIGH',
    ],
  ])('models density from decisions and facts', (ids, expected) => {
    expect(composer.compose(context(), plan(ids)).density).toBe(expected);
  });

  it('is deterministic, deeply immutable and contains no realized text', () => {
    const input = plan([
      'nutrition.respond-to-meal',
      'nutrition.acknowledge-meal',
      'nutrition.use-emoji',
    ]);
    const first = composer.compose(context(), input);
    const second = composer.compose(context(), input);
    const assertFrozen = (value: unknown): void => {
      if (typeof value !== 'object' || value === null) return;
      expect(Object.isFrozen(value)).toBe(true);
      Object.values(value).forEach(assertFrozen);
    };

    expect(second).toEqual(first);
    assertFrozen(first);
    expect(JSON.stringify(first)).not.toMatch(
      /candidateText|finalContent|messageText/,
    );
  });

  it('accepts the real immutable DecisionPlan produced by Engine and Policy', () => {
    const source = context();
    const candidates = new NutritionConversationDecisionEngine().generate(
      source,
    );
    const decisionPlan =
      new NutritionConversationDecisionScoringPolicy().select(
        source,
        candidates,
      );

    const result = composer.compose(source, decisionPlan);

    expect(result.decisionPlanId).toBe(decisionPlan.id);
    expect(result.blocks.length).toBeGreaterThan(0);
    expect(result.blocks.flatMap((block) => block.decisionIds)).toEqual(
      expect.arrayContaining(
        decisionPlan.selectedDecisions
          .map((decision) => decision.candidateId)
          .filter(
            (id) =>
              ![
                'nutrition.respond-briefly',
                'nutrition.reduce-conversational-load',
                'nutrition.use-emoji',
              ].includes(id),
          ),
      ),
    );
  });
  it('remains isolated from production and future stages', () => {
    const source = readFileSync(
      join(__dirname, 'nutrition-conversation-composer.ts'),
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

    expect(source).not.toMatch(
      /PrismaService|OpenAIGateway|ConfigService|EventBus|Evolution|PromptService|ResponseBuilderService|NutritionResponseFormatter|fetch\(|axios|Date\.now|new Date|Math\.random|console\.log|constructor\s*\(/,
    );
    expect(source).not.toMatch(
      /LanguageRealization|Shadow|Comparator|Metric|candidateText|finalContent/,
    );
    expect(moduleSource).toContain('NutritionConversationComposer');
    expect(responseBuilder).not.toContain('NutritionConversationComposer');
  });
});
