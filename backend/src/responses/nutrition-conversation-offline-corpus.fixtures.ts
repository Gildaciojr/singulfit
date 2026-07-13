import type { ConversationCorpusScenario } from './conversation-offline-corpus.contract';
import type { LanguageRealizationResult } from './conversation-language-realization.contract';
import type { SanitizedConversationPayload } from './sanitized-conversation-payload.contract';

const payload: SanitizedConversationPayload = {
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
        type: 'DIRECT_ANSWER',
        decisions: ['RESPOND_TO_MEAL', 'PROVIDE_RECOMMENDATION'],
        facts: ['MEAL_TOTAL_CALORIES'],
        order: 0,
        paragraph: 0,
        presentation: 'PROSE',
        required: true,
        maximumLength: 180,
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
    coaching: 'MOTIVATIONAL',
    tone: 'MODERATE',
    motivationFocus: 'HEALTH',
    stageOfChange: 'ACTION',
  },
  limits: {
    maximumLength: 180,
    maximumEmojiCount: 0,
    maximumQuestions: 0,
    maximumActions: 1,
  },
  policies: { estimateQualificationRequired: true, emojiAllowed: false },
};

const deepPayload: SanitizedConversationPayload = {
  ...payload,
  structure: { ...payload.structure, depth: 'DEEP', density: 'HIGH' },
};

function candidate(
  overrides: Partial<LanguageRealizationResult> = {},
): LanguageRealizationResult {
  return {
    id: 'synthetic-candidate',
    sanitizedPayloadReference: 'sanitized-payload:synthetic',
    status: 'COMPLETED',
    candidateText:
      'A refeição sintética tem cerca de 420 calorias. Mantenha a próxima escolha equilibrada.',
    candidateTextSource: 'VALIDATED_UNITS',
    realizedUnits: [
      {
        blockKey: 'response',
        unitType: 'FACTUAL',
        decisionCodes: ['RESPOND_TO_MEAL', 'PROVIDE_RECOMMENDATION'],
        factKeys: ['MEAL_TOTAL_CALORIES'],
        text: 'A refeição sintética tem cerca de 420 calorias. Mantenha a próxima escolha equilibrada.',
        claims: {
          numbers: [420],
          foods: ['alimento-sintetico'],
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
    producedLength: 86,
    producedQuestionCount: 0,
    warningCodes: [],
    ...overrides,
  } as LanguageRealizationResult;
}

function scenario(
  id: string,
  tags: readonly string[],
  overrides: Partial<ConversationCorpusScenario> = {},
): ConversationCorpusScenario {
  return Object.freeze({
    id,
    tags: Object.freeze([...tags]),
    golden: false,
    userMessage: 'Mensagem sintética sobre refeição.',
    nutritionContext: Object.freeze({ calories: 420, itemCount: 1 }),
    behavioralContext: Object.freeze({
      fatigue: 'LOW',
      preference: 'BALANCED',
    }),
    memory: Object.freeze({ available: false }),
    recommendations: Object.freeze({ action: 'Mantenha equilíbrio.' }),
    longitudinalContext: Object.freeze({ trend: 'STABLE' }),
    expectedLegacyResponse: 'Resposta legada sintética.',
    candidate: candidate(),
    payload,
    expectedFoods: Object.freeze(['alimento-sintetico']),
    expectedRecommendations: Object.freeze(['Mantenha equilíbrio.']),
    incrementalLatencyMs: 10,
    usage: Object.freeze({
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
    }),
    ...overrides,
  });
}

export const NUTRITION_CONVERSATION_OFFLINE_CORPUS: readonly ConversationCorpusScenario[] =
  Object.freeze([
    scenario('adequate-meal', ['ADEQUATE_MEAL']),
    scenario('incomplete-meal', ['INCOMPLETE_MEAL']),
    scenario('excess-meal', ['EXCESS_MEAL']),
    scenario('simple-recommendation', ['SIMPLE_RECOMMENDATION']),
    scenario('limiting-factor', ['LIMITING_FACTOR']),
    scenario('complete-macros', ['COMPLETE_MACROS']),
    scenario('partial-macros', ['PARTIAL_MACROS']),
    scenario('low-confidence', ['LOW_CONFIDENCE']),
    scenario('relevant-memory', ['RELEVANT_MEMORY'], {
      memory: Object.freeze({ available: true, subject: 'synthetic habit' }),
      candidate: candidate({
        realizedUnits: [
          {
            ...candidate().realizedUnits[0],
            claims: {
              ...candidate().realizedUnits[0].claims,
              usesMemory: true,
            },
          },
        ],
      }),
    }),
    scenario('no-memory', ['NO_MEMORY']),
    scenario('longitudinal-improvement', ['LONGITUDINAL_IMPROVEMENT'], {
      longitudinalContext: Object.freeze({ trend: 'IMPROVING' }),
    }),
    scenario('longitudinal-worsening', ['LONGITUDINAL_WORSENING'], {
      longitudinalContext: Object.freeze({ trend: 'WORSENING' }),
    }),
    scenario('high-fatigue', ['HIGH_FATIGUE'], {
      behavioralContext: Object.freeze({
        fatigue: 'HIGH',
        preference: 'SHORT',
      }),
    }),
    scenario('short-message-preference', ['SHORT_MESSAGE']),
    scenario('authorized-question', ['AUTHORIZED_QUESTION']),
    scenario('closing-without-question', ['CLOSING_WITHOUT_QUESTION']),
    scenario('dietary-restriction', ['DIETARY_RESTRICTION']),
    scenario('allergy', ['ALLERGY']),
    scenario('unidentified-food', ['UNIDENTIFIED_FOOD']),
    scenario('multiple-items', ['MULTIPLE_ITEMS'], {
      nutritionContext: Object.freeze({ calories: 420, itemCount: 4 }),
    }),
    scenario('minimal-response', ['MINIMAL_RESPONSE']),
    scenario('normal-response', ['NORMAL_RESPONSE']),
    scenario('deep-response', ['DEEP_RESPONSE'], {
      payload: Object.freeze(deepPayload),
    }),
    scenario('golden-exact-numbers', ['GOLDEN', 'EXACT_NUMBERS'], {
      golden: true,
    }),
    scenario('golden-disclaimer', ['GOLDEN', 'DISCLAIMER'], { golden: true }),
    scenario('golden-no-question', ['GOLDEN', 'NO_QUESTION'], { golden: true }),
    scenario('golden-memory', ['GOLDEN', 'MEMORY'], { golden: true }),
    scenario('golden-recommendation', ['GOLDEN', 'RECOMMENDATION'], {
      golden: true,
    }),
    scenario('golden-fatigue', ['GOLDEN', 'FATIGUE'], { golden: true }),
    scenario('golden-closing', ['GOLDEN', 'CLOSING'], { golden: true }),
    scenario('legacy-preferred-structure', ['STRUCTURAL_REGRESSION'], {
      candidate: candidate({
        candidateText: 'Relatório:\n# Conteúdo sintético.',
      }),
    }),
    scenario('fallback-required', ['FALLBACK'], {
      candidate: candidate({
        status: 'FALLBACK',
        candidateText: null,
        fallbackReason: 'VALIDATION_REJECTED',
        failureCode: 'VALIDATION_REJECTED',
      } as Partial<LanguageRealizationResult>),
    }),
    scenario('invalid-factual', ['INVALID_FACTUAL'], {
      candidate: candidate({ realizedFacts: [] }),
    }),
  ]);
