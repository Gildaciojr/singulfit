import type { LanguageRealizationResult } from './conversation-language-realization.contract';
import { NutritionConversationComparator } from './nutrition-conversation-comparator';
import { NutritionConversationLegacyCandidateAdapter } from './nutrition-conversation-legacy-candidate.adapter';
import type { SanitizedConversationPayload } from './sanitized-conversation-payload.contract';

const payload = {
  facts: {
    allowed: [
      {
        key: 'MEAL_TOTAL_CALORIES',
        source: 'NUTRITION_ANALYSIS',
        value: 420,
        estimated: true,
      },
    ],
    sensitive: [],
    disclaimerRequired: ['MEAL_TOTAL_CALORIES'],
  },
  selectedDecisions: ['RESPOND_TO_MEAL'],
  structure: {
    blocks: [
      {
        key: 'response',
        type: 'DIRECT_RESPONSE',
        decisions: ['RESPOND_TO_MEAL'],
        facts: ['MEAL_TOTAL_CALORIES'],
        order: 0,
        paragraph: 0,
        presentation: 'PROSE',
        required: true,
        maximumLength: 120,
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
    maximumLength: 120,
    maximumEmojiCount: 0,
    maximumQuestions: 0,
    maximumActions: 1,
  },
  policies: { estimateQualificationRequired: true, emojiAllowed: false },
} as SanitizedConversationPayload;

function realization(
  overrides: Partial<LanguageRealizationResult> = {},
): LanguageRealizationResult {
  return {
    id: 'realization',
    sanitizedPayloadReference: 'reference',
    status: 'COMPLETED',
    candidateText: 'A refeição tem cerca de 420 calorias.',
    candidateTextSource: 'VALIDATED_UNITS',
    realizedUnits: [],
    omittedUnits: [],
    realizedFacts: ['MEAL_TOTAL_CALORIES'],
    omittedFacts: [],
    realizedDecisions: ['RESPOND_TO_MEAL'],
    omittedDecisions: [],
    disclaimerRealized: true,
    questionRealized: false,
    closingRealized: false,
    producedLength: 38,
    producedQuestionCount: 0,
    warningCodes: [],
    ...overrides,
  } as LanguageRealizationResult;
}

describe('Nutrition conversation comparison', () => {
  const adapter = new NutritionConversationLegacyCandidateAdapter();
  const comparator = new NutritionConversationComparator();

  it('preserves legacy byte for byte and always selects it', () => {
    const legacy = 'Linha 1\r\nAção com acento  ';
    const envelope = adapter.adapt(legacy, realization());

    expect(envelope.legacy.content).toBe(legacy);
    expect(envelope.selectedOrigin).toBe('LEGACY');
    expect(Object.isFrozen(envelope)).toBe(true);
    expect(Object.isFrozen(envelope.legacy)).toBe(true);
    expect(Object.isFrozen(envelope.candidate)).toBe(true);
  });

  it('reports objective divergences deterministically and freezes result', () => {
    const candidate = realization({
      candidateText: 'Relatório: 999 calorias? 🙂',
      realizedFacts: [],
      disclaimerRealized: false,
      producedQuestionCount: 1,
    });
    const envelope = adapter.adapt('Legado estável.', candidate);
    const input = { envelope, candidate, payload, incrementalLatencyMs: 12 };
    const first = comparator.compare(input);
    const second = comparator.compare(input);

    expect(first).toEqual(second);
    expect(first.selectedOrigin).toBe('LEGACY');
    expect(first.failedChecks).toEqual(
      expect.arrayContaining([
        'AUTHORIZED_FACTS_PRESERVED',
        'AUTHORIZED_NUMBERS_PRESERVED',
        'DISCLAIMER_PRESERVED',
        'QUESTION_AUTHORIZED',
        'NO_TECHNICAL_TITLE',
      ]),
    );
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.checks)).toBe(true);
    expect(Object.isFrozen(first.metrics)).toBe(true);
  });

  it('distinguishes absence, partial, fallback, timeout and invalid structure', () => {
    expect(
      comparator.compare({
        envelope: adapter.adapt('legacy', null),
        candidate: null,
        payload,
        incrementalLatencyMs: 0,
      }).candidateState,
    ).toBe('NOT_EXECUTED');

    for (const [status, expected] of [
      ['PARTIALLY_COMPLETED', 'PARTIAL'],
      ['FALLBACK', 'FALLBACK'],
      ['TIMED_OUT', 'TIMEOUT'],
      ['INVALID_STRUCTURE', 'INVALID_STRUCTURE'],
    ] as const) {
      const candidate = realization({
        status,
        ...(status === 'FALLBACK'
          ? { fallbackReason: 'VALIDATION_REJECTED' }
          : {}),
        ...(status === 'TIMED_OUT'
          ? { failureCode: 'TIMEOUT', fallbackReason: 'TIMEOUT' }
          : {}),
        ...(status === 'INVALID_STRUCTURE'
          ? {
              candidateText: null,
              fallbackReason: 'INVALID_STRUCTURE',
              failureCode: 'INVALID_STRUCTURE',
            }
          : {}),
      } as Partial<LanguageRealizationResult>);
      expect(
        comparator.compare({
          envelope: adapter.adapt('legacy', candidate),
          candidate,
          payload,
          incrementalLatencyMs: 0,
        }).candidateState,
      ).toBe(expected);
    }
  });
});
