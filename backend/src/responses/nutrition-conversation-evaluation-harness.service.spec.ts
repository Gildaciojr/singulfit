import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ConversationEvaluationScenario } from './conversation-evaluation-harness.contract';
import type { LanguageRealizationResult } from './conversation-language-realization.contract';
import { NutritionConversationEvaluationHarnessService } from './nutrition-conversation-evaluation-harness.service';
import type { SanitizedConversationPayload } from './sanitized-conversation-payload.contract';
import { DEFAULT_NUTRITION_CONVERSATION_COACH_STYLE } from './nutrition-conversation-coach-style.engine';

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
    dialogueProfile: 'ACKNOWLEDGE_AND_ADJUST',
    centralIntent: 'ADJUST',
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
    coach: DEFAULT_NUTRITION_CONVERSATION_COACH_STYLE,
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
    maximumFacts: 7,
    maximumBlocks: 4,
    maximumParagraphs: 3,
  },
  policies: {
    estimateQualificationRequired: true,
    emojiAllowed: false,
    closingRequirement: 'OPTIONAL',
  },
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
    expect(first.metrics.emotionalEvidencePreserved).toBe(true);
    expect(first.metrics.unsafeEmotionalLanguageAbsent).toBe(true);
    expect(first.metrics.profileRespected).toBe(true);
    expect(first.metrics.centralIntentPreserved).toBe(true);
    expect(first.metrics.paragraphBudgetRespected).toBe(true);
    expect(first.metrics.questionBudgetRespected).toBe(true);
    expect(first.metrics.actionBudgetRespected).toBe(true);
    expect(first.metrics.structuralDiversity).toBe(true);
    expect(first.metrics.naturalness).toBeGreaterThanOrEqual(80);
    expect(first.metrics.coachIdentity).toBe(100);
    expect(first.metrics.toneConsistency).toBe(100);
    expect(first.metrics.empathyQuality).toBeGreaterThanOrEqual(80);
    expect(first.metrics.lexicalDiversity).toBeGreaterThan(0);
    expect(first.metrics.openingDiversity).toBe(100);
    expect(first.metrics.closingDiversity).toBe(100);
    expect(first.metrics.transitionQuality).toBe(100);
    expect(first.metrics.humanPerception).toBeGreaterThanOrEqual(80);
    expect(first.metrics.motivationQuality).toBeGreaterThanOrEqual(80);
    expect(first.metrics.warmth).toBeGreaterThanOrEqual(80);
    expect(first.metrics.professionalism).toBeGreaterThanOrEqual(90);
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

  it('detects emotional adaptation without evidence and unsafe inferred emotion', () => {
    const unsafe = candidate({
      candidateText: 'Você está triste.',
      realizedUnits: [
        {
          ...candidate().realizedUnits[0],
          decisionCodes: ['VALIDATE_FRUSTRATION'],
          factKeys: [],
          text: 'Você está triste.',
          claims: {
            numbers: [],
            foods: [],
            usesMemory: false,
            usesRecommendation: false,
          },
        },
      ],
    });
    const report = harness.evaluate(scenario({ candidate: unsafe }));

    expect(report.metrics.emotionalEvidencePreserved).toBe(false);
    expect(report.metrics.unsafeEmotionalLanguageAbsent).toBe(false);
    expect(report.objectiveReasons).toEqual(
      expect.arrayContaining([
        'FAILED:EMOTIONAL_EVIDENCE_PRESERVED',
        'FAILED:UNSAFE_EMOTIONAL_LANGUAGE_PRESENT',
      ]),
    );
  });

  it('detects deterministic profile violations without an LLM judge', () => {
    const celebrate = harness.evaluate(
      scenario({
        payload: {
          ...payload,
          structure: {
            ...payload.structure,
            dialogueProfile: 'CELEBRATE',
            centralIntent: 'CELEBRATE',
          },
        },
      }),
    );
    const clarify = harness.evaluate(
      scenario({
        payload: {
          ...payload,
          structure: {
            ...payload.structure,
            dialogueProfile: 'CLARIFY_BEFORE_ANALYSIS',
            centralIntent: 'CLARIFY',
          },
        },
      }),
    );
    const detailedOutsideProfile = harness.evaluate(
      scenario({
        candidate: candidate({
          realizedDecisions: [
            'RESPOND_TO_MEAL',
            'PROVIDE_RECOMMENDATION',
            'DETAIL_ANALYSIS',
          ],
        }),
      }),
    );

    expect(celebrate.metrics.celebrationStayedFocused).toBe(false);
    expect(clarify.metrics.clarificationAvoidedSpeculation).toBe(false);
    expect(
      detailedOutsideProfile.metrics.detailedAnalysisUsedOnlyWhenEligible,
    ).toBe(false);
    expect(celebrate.objectiveReasons).toContain(
      'FAILED:CELEBRATION_STAYED_FOCUSED',
    );
    expect(clarify.objectiveReasons).toContain(
      'FAILED:CLARIFICATION_AVOIDED_SPECULATION',
    );
  });

  it('audits episodic recall, relevance, invention and lifecycle sanitization deterministically', () => {
    const episodicPayload: SanitizedConversationPayload = {
      ...payload,
      facts: {
        ...payload.facts,
        allowed: [
          ...payload.facts.allowed,
          {
            key: 'episodicMemory.COMMITMENT',
            source: 'MEMORY',
            value: {
              category: 'COMMITMENT',
              fact: { action: 'incluir vegetais' },
              relationToContext: 'follow-up atual',
              recallReason: 'FOLLOW_UP_DUE',
            },
            estimated: false,
          },
        ],
      },
      selectedDecisions: [...payload.selectedDecisions, 'CHECK_COMMITMENT'],
      structure: {
        ...payload.structure,
        blocks: payload.structure.blocks.map((block) => ({
          ...block,
          decisions: [...block.decisions, 'CHECK_COMMITMENT'],
          facts: [...block.facts, 'episodicMemory.COMMITMENT'],
        })),
      },
    };
    const authorized = candidate({
      realizedUnits: [
        {
          ...candidate().realizedUnits[0],
          decisionCodes: [
            ...candidate().realizedUnits[0].decisionCodes,
            'CHECK_COMMITMENT',
          ],
          factKeys: [
            ...candidate().realizedUnits[0].factKeys,
            'episodicMemory.COMMITMENT',
          ],
          claims: {
            ...candidate().realizedUnits[0].claims,
            usesMemory: true,
          },
        },
      ],
      realizedFacts: ['MEAL_TOTAL_CALORIES', 'episodicMemory.COMMITMENT'],
      realizedDecisions: [
        'RESPOND_TO_MEAL',
        'PROVIDE_RECOMMENDATION',
        'CHECK_COMMITMENT',
      ],
    });
    const valid = harness.evaluate(
      scenario({ payload: episodicPayload, candidate: authorized }),
    );
    const invented = harness.evaluate(
      scenario({
        payload: episodicPayload,
        candidate: {
          ...authorized,
          realizedUnits: authorized.realizedUnits.map((unit) => ({
            ...unit,
            factKeys: ['episodicMemory.UNKNOWN'],
          })),
        },
      }),
    );

    expect(valid.metrics.memoryRecallCorrect).toBe(true);
    expect(valid.metrics.memoryRecallNecessary).toBe(true);
    expect(valid.metrics.memoryNotInvented).toBe(true);
    expect(valid.metrics.continuityNatural).toBe(true);
    expect(valid.metrics.episodeRelevance).toBe(true);
    expect(valid.metrics.episodeReuse).toBe(true);
    expect(valid.metrics.episodeExpiration).toBe(true);
    expect(invented.metrics.memoryRecallCorrect).toBe(false);
    expect(invented.metrics.memoryNotInvented).toBe(false);
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
