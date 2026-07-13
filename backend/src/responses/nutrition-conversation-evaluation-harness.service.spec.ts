import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ConversationEvaluationScenario } from './conversation-evaluation-harness.contract';
import type { LanguageRealizationResult } from './conversation-language-realization.contract';
import { NutritionConversationEvaluationHarnessService } from './nutrition-conversation-evaluation-harness.service';
import type { SanitizedConversationPayload } from './sanitized-conversation-payload.contract';

const payload = {
  facts: {
    allowed: [
      {
        key: 'MEAL_TOTAL_CALORIES',
        source: 'MEAL_ANALYSIS',
        value: 420,
        estimated: true,
      },
    ],
    sensitive: [],
    disclaimerRequired: ['MEAL_TOTAL_CALORIES'],
  },
  selectedDecisions: ['RESPOND_TO_MEAL', 'PROVIDE_RECOMMENDATION'],
  structure: {
    blocks: [
      {
        key: 'response',
        type: 'DIRECT_RESPONSE',
        decisions: ['RESPOND_TO_MEAL', 'PROVIDE_RECOMMENDATION'],
        facts: ['MEAL_TOTAL_CALORIES'],
        order: 0,
        paragraph: 0,
        presentation: 'PROSE',
        required: true,
        maximumLength: 160,
      },
    ],
    depth: 'BRIEF',
    density: 'LOW',
    rhythm: 'FAST',
    presentation: 'PROSE',
    paragraphCount: 1,
  },
  style: {
    communication: 'BALANCED',
    coaching: 'SUPPORTIVE',
    tone: 'MODERATE',
    motivationFocus: 'HEALTH',
    stageOfChange: 'ACTION',
  },
  limits: {
    maximumLength: 160,
    maximumEmojiCount: 0,
    maximumQuestions: 0,
    maximumActions: 1,
  },
  policies: { estimateQualificationRequired: true, emojiAllowed: false },
} as SanitizedConversationPayload;

function candidate(
  overrides: Partial<LanguageRealizationResult> = {},
): LanguageRealizationResult {
  return {
    id: 'candidate',
    sanitizedPayloadReference: 'sanitized-payload:evaluation',
    status: 'COMPLETED',
    candidateText:
      'Seu prato com frango tem cerca de 420 calorias. Inclua salada.',
    candidateTextSource: 'VALIDATED_UNITS',
    realizedUnits: [
      {
        blockKey: 'response',
        unitType: 'FACTUAL',
        decisionCodes: ['RESPOND_TO_MEAL', 'PROVIDE_RECOMMENDATION'],
        factKeys: ['MEAL_TOTAL_CALORIES'],
        text: 'Seu prato com frango tem cerca de 420 calorias. Inclua salada.',
        claims: {
          numbers: [420],
          foods: ['frango'],
          usesMemory: false,
          usesRecommendation: true,
        },
      },
    ],
    omittedUnits: [],
    realizedFacts: ['MEAL_TOTAL_CALORIES'],
    omittedFacts: [],
    realizedDecisions: ['RESPOND_TO_MEAL', 'PROVIDE_RECOMMENDATION'],
    omittedDecisions: [],
    disclaimerRealized: true,
    questionRealized: false,
    closingRealized: false,
    producedLength: 62,
    producedQuestionCount: 0,
    warningCodes: [],
    ...overrides,
  } as LanguageRealizationResult;
}

function scenario(
  overrides: Partial<ConversationEvaluationScenario> = {},
): ConversationEvaluationScenario {
  return {
    id: 'meal-equivalent',
    userMessage: 'Almocei agora',
    nutritionContext: { meal: 'frango', calories: 420 },
    behavioralContext: { stage: 'ACTION' },
    memory: { preference: 'salada' },
    recommendations: { nextAction: 'Inclua salada.' },
    longitudinalContext: { trend: 'STABLE' },
    expectedLegacyResponse: 'Análise oficial preservada.',
    candidate: candidate(),
    payload,
    expectedFoods: ['frango'],
    expectedRecommendations: ['Inclua salada.'],
    incrementalLatencyMs: 12,
    usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120 },
    ...overrides,
  };
}

describe('NutritionConversationEvaluationHarnessService', () => {
  const harness = new NutritionConversationEvaluationHarnessService();

  it('produces an equivalent deterministic offline report', () => {
    const input = scenario();
    const before = JSON.stringify(input);
    const first = harness.evaluate(input);
    const second = harness.evaluate(input);

    expect(first).toEqual(second);
    expect(first.scores.final).toBeGreaterThan(0);
    expect(first.metrics.foodsPreserved).toBe(true);
    expect(first.metrics.recommendationsPreserved).toBe(true);
    expect(first.metrics.totalTokens).toBe(120);
    expect(first.metrics.density).toBe('LOW');
    expect(first.metrics.depth).toBe('BRIEF');
    expect(JSON.stringify(input)).toBe(before);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.summary)).toBe(true);
    expect(Object.isFrozen(first.metrics)).toBe(true);
    expect(Object.isFrozen(first.scores)).toBe(true);
  });

  it('measures a structurally compliant candidate without subjective selection', () => {
    const report = harness.evaluate(scenario());

    expect(report.comparison.selectedOrigin).toBe('LEGACY');
    expect(report.failedChecks).not.toContain('NO_REPORT_STRUCTURE');
    expect(report.scores.structural).toBeGreaterThan(0);
  });

  it.each([
    ['PARTIALLY_COMPLETED', 'PARTIAL'],
    ['FALLBACK', 'FALLBACK'],
    ['TIMED_OUT', 'TIMEOUT'],
    ['EMPTY', 'INELIGIBLE'],
    ['INVALID_STRUCTURE', 'INVALID_STRUCTURE'],
  ] as const)('reports %s objectively', (status, expectedState) => {
    const result = candidate({
      status,
      ...(status === 'FALLBACK'
        ? { fallbackReason: 'VALIDATION_REJECTED' }
        : {}),
      ...(status === 'TIMED_OUT'
        ? { failureCode: 'TIMEOUT', fallbackReason: 'TIMEOUT' }
        : {}),
      ...(status === 'EMPTY' ? { failureCode: 'EMPTY_RESPONSE' } : {}),
      ...(status === 'INVALID_STRUCTURE'
        ? {
            candidateText: null,
            failureCode: 'INVALID_STRUCTURE',
            fallbackReason: 'INVALID_STRUCTURE',
          }
        : {}),
    } as Partial<LanguageRealizationResult>);
    const report = harness.evaluate(scenario({ candidate: result }));

    expect(report.summary.candidateState).toBe(expectedState);
    expect(report.comparison.selectedOrigin).toBe('LEGACY');
  });

  it('detects factual, numeric, food and recommendation divergences', () => {
    const divergent = candidate({
      candidateText: 'Relatório: 999 calorias.',
      realizedFacts: [],
      realizedUnits: [
        {
          ...candidate().realizedUnits[0],
          claims: {
            ...candidate().realizedUnits[0].claims,
            foods: ['massa'],
            usesRecommendation: false,
          },
        },
      ],
    });
    const report = harness.evaluate(scenario({ candidate: divergent }));

    expect(report.failedChecks).toEqual(
      expect.arrayContaining([
        'AUTHORIZED_FACTS_PRESERVED',
        'AUTHORIZED_NUMBERS_PRESERVED',
        'NO_TECHNICAL_TITLE',
      ]),
    );
    expect(report.metrics.foodsPreserved).toBe(false);
    expect(report.metrics.recommendationsPreserved).toBe(false);
    expect(report.objectiveReasons).toEqual(
      expect.arrayContaining([
        'FAILED:FOODS_PRESERVED',
        'FAILED:RECOMMENDATIONS_PRESERVED',
      ]),
    );
  });

  it('has no production, provider or infrastructure dependency', () => {
    const source = readFileSync(
      join(__dirname, 'nutrition-conversation-evaluation-harness.service.ts'),
      'utf8',
    );

    expect(source).not.toMatch(
      /Prisma|Evolution|Worker|Outbox|EventBus|OpenAI|AIService|persist|publish|console\.log|TODO|FIXME/,
    );
    expect(source).not.toMatch(/\bany\b|Date\.now|Math\.random/);
  });
});
