import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  ConversationAIErrorCode,
  ConversationAIResponse,
} from '../ai/conversation-ai.contract';
import type { ConversationAIService } from '../ai/conversation-ai.service';
import { NutritionConversationLanguageRealizer } from './nutrition-conversation-language-realizer';
import type { SanitizedConversationPayload } from './sanitized-conversation-payload.contract';

function payload(): SanitizedConversationPayload {
  return {
    facts: {
      allowed: [
        {
          key: 'facts.foods',
          source: 'MEAL_ANALYSIS',
          value: [{ name: 'Frango', estimatedGrams: 120 }],
          estimated: true,
        },
        {
          key: 'facts.totalProtein',
          source: 'MEAL_ANALYSIS',
          value: 30,
          estimated: true,
        },
      ],
      sensitive: [],
      disclaimerRequired: ['facts.foods', 'facts.totalProtein'],
    },
    selectedDecisions: [
      'QUALIFY_ESTIMATES',
      'RESPOND_TO_MEAL',
      'SHOW_PROTEIN',
      'ASK_QUESTION',
    ],
    structure: {
      blocks: [
        {
          key: 'block-1-uncertainty-qualification',
          type: 'UNCERTAINTY_QUALIFICATION',
          decisions: ['QUALIFY_ESTIMATES'],
          facts: ['facts.foods', 'facts.totalProtein'],
          order: 0,
          paragraph: 0,
          presentation: 'PROSE',
          required: true,
          maximumLength: 100,
        },
        {
          key: 'block-2-primary-observation',
          type: 'PRIMARY_OBSERVATION',
          decisions: ['RESPOND_TO_MEAL', 'SHOW_PROTEIN'],
          facts: ['facts.foods', 'facts.totalProtein'],
          order: 1,
          paragraph: 1,
          presentation: 'PROSE',
          required: true,
          maximumLength: 130,
        },
        {
          key: 'block-3-clarifying-question',
          type: 'CLARIFYING_QUESTION',
          decisions: ['ASK_QUESTION'],
          facts: [],
          order: 2,
          paragraph: 2,
          presentation: 'PROSE',
          required: false,
          maximumLength: 70,
        },
      ],
      depth: 'MODERATE',
      density: 'MEDIUM',
      rhythm: 'PROGRESSIVE',
      presentation: 'PROSE',
      paragraphCount: 3,
    },
    style: {
      communication: 'FRIENDLY',
      coaching: 'MOTIVATIONAL',
      tone: 'MODERATE',
      motivationFocus: 'PERFORMANCE',
      stageOfChange: 'PREPARATION',
    },
    limits: {
      maximumLength: 300,
      maximumEmojiCount: 0,
      maximumQuestions: 1,
      maximumActions: 1,
    },
    policies: {
      estimateQualificationRequired: true,
      emojiAllowed: false,
    },
  };
}

function completeOutput() {
  return {
    units: [
      {
        blockKey: 'block-1-uncertainty-qualification',
        unitType: 'DISCLAIMER',
        decisionCodes: ['QUALIFY_ESTIMATES'],
        factKeys: ['facts.foods', 'facts.totalProtein'],
        text: 'Os valores são estimativas visuais.',
        claims: {
          numbers: [],
          foods: [],
          usesMemory: false,
          usesRecommendation: false,
        },
      },
      {
        blockKey: 'block-2-primary-observation',
        unitType: 'FACTUAL',
        decisionCodes: ['RESPOND_TO_MEAL', 'SHOW_PROTEIN'],
        factKeys: ['facts.foods', 'facts.totalProtein'],
        text: 'O frango oferece cerca de 30 g de proteína.',
        claims: {
          numbers: [30],
          foods: ['Frango'],
          usesMemory: false,
          usesRecommendation: false,
        },
      },
      {
        blockKey: 'block-3-clarifying-question',
        unitType: 'QUESTION',
        decisionCodes: ['ASK_QUESTION'],
        factKeys: [],
        text: 'Quer ajustar essa refeição?',
        claims: {
          numbers: [],
          foods: [],
          usesMemory: false,
          usesRecommendation: false,
        },
      },
    ],
    omittedUnits: [],
  };
}

function success(structuredOutput: unknown): ConversationAIResponse {
  return {
    status: 'COMPLETED',
    structuredOutput: structuredOutput as never,
    rawText: JSON.stringify(structuredOutput),
    finishReason: 'UNKNOWN',
    usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
    provider: { responseReference: 'provider-ref', model: 'model' },
  };
}

function failure(errorCode: ConversationAIErrorCode): ConversationAIResponse {
  return {
    status: 'FAILED',
    structuredOutput: null,
    rawText: null,
    finishReason: 'UNKNOWN',
    usage: null,
    provider: null,
    errorCode,
  };
}

function realizer(response: ConversationAIResponse) {
  const execute = jest.fn().mockResolvedValue(response);
  return {
    execute,
    service: new NutritionConversationLanguageRealizer({
      execute,
    } as unknown as ConversationAIService),
  };
}

function assertDeepFrozen(value: unknown): void {
  if (typeof value !== 'object' || value === null) return;
  expect(Object.isFrozen(value)).toBe(true);
  Object.values(value).forEach(assertDeepFrozen);
}

describe('NutritionConversationLanguageRealizer', () => {
  it('realizes validated units and composes candidateText locally in block order', async () => {
    const target = realizer(success(completeOutput()));
    const result = await target.service.realize(payload());

    expect(result.status).toBe('COMPLETED');
    expect(result.candidateText).toBe(
      'Os valores são estimativas visuais.\n\nO frango oferece cerca de 30 g de proteína.\n\nQuer ajustar essa refeição?',
    );
    expect(result.candidateTextSource).toBe('VALIDATED_UNITS');
    expect(result.disclaimerRealized).toBe(true);
    expect(result.questionRealized).toBe(true);
    expect(result.producedQuestionCount).toBe(1);
    expect(result.sanitizedPayloadReference).toMatch(
      /^sanitized-payload:[a-f0-9]{64}$/,
    );
  });

  it('sends only instructions, schema and the sanitized payload through ConversationAIService', async () => {
    const source = payload();
    const target = realizer(success(completeOutput()));
    await target.service.realize(source);
    const request = target.execute.mock.calls[0][0];

    expect(request.payload).toBe(source);
    expect(request.instructions).toContain('somente unidades estruturadas');
    expect(request.schema.name).toBe('nutrition_conversation_language_units');
    expect(JSON.stringify(request)).not.toMatch(
      /mealAnalysisId|conversationId|messageId|userId|compositionPlanId/,
    );
  });

  it('returns partial only when optional blocks are explicitly omitted', async () => {
    const output = completeOutput();
    output.units = output.units.slice(0, 2);
    output.omittedUnits = [
      {
        blockKey: 'block-3-clarifying-question',
        decisionCodes: ['ASK_QUESTION'],
        factKeys: [],
        reason: 'COMMUNICATIVE_BUDGET',
      },
    ];
    const result = await realizer(success(output)).service.realize(payload());

    expect(result.status).toBe('PARTIALLY_COMPLETED');
    expect(result.questionRealized).toBe(false);
    expect(result.omittedDecisions).toEqual([
      { decision: 'ASK_QUESTION', reason: 'COMMUNICATIVE_BUDGET' },
    ]);
  });

  it.each([
    ['TIMEOUT', 'TIMED_OUT', 'TIMEOUT'],
    ['PROVIDER_FAILURE', 'FALLBACK', 'PROVIDER_FAILURE'],
    ['INVALID_RESPONSE', 'INVALID_STRUCTURE', 'INVALID_STRUCTURE'],
    ['INVALID_SCHEMA', 'INVALID_STRUCTURE', 'INVALID_STRUCTURE'],
    ['EMPTY_RESPONSE', 'EMPTY', 'EMPTY_RESPONSE'],
    ['UNKNOWN_FAILURE', 'FAILED', undefined],
  ] as const)(
    'maps %s infrastructure failure to %s',
    async (errorCode, status, fallbackReason) => {
      const result = await realizer(failure(errorCode)).service.realize(
        payload(),
      );
      expect(result.status).toBe(status);
      expect(result.fallbackReason).toBe(fallbackReason);
      expect(result.candidateText).toBeNull();
    },
  );

  it.each([
    ['invalid output schema', { units: 'invalid', omittedUnits: [] }],
    [
      'unknown block',
      {
        ...completeOutput(),
        units: [
          {
            ...completeOutput().units[0],
            blockKey: 'block-99-unknown',
          },
          ...completeOutput().units.slice(1),
        ],
      },
    ],
    [
      'unauthorized number',
      {
        ...completeOutput(),
        units: completeOutput().units.map((unit, index) =>
          index === 1
            ? { ...unit, claims: { ...unit.claims, numbers: [31] } }
            : unit,
        ),
      },
    ],
    [
      'missing disclaimer',
      {
        units: completeOutput().units.slice(1),
        omittedUnits: [
          {
            blockKey: 'block-1-uncertainty-qualification',
            decisionCodes: ['QUALIFY_ESTIMATES'],
            factKeys: ['facts.foods', 'facts.totalProtein'],
            reason: 'REALIZATION_FAILURE',
          },
        ],
      },
    ],
  ])('rejects %s as invalid structure', async (_label, output) => {
    const result = await realizer(success(output)).service.realize(payload());
    expect(result.status).toBe('INVALID_STRUCTURE');
    expect(result.candidateText).toBeNull();
  });

  it('rejects an undeclared number present in unit text', async () => {
    const output = completeOutput();
    output.units[1] = {
      ...output.units[1],
      text: 'O frango oferece 31 g de proteína.',
      claims: { ...output.units[1].claims, numbers: [] },
    };
    const result = await realizer(success(output)).service.realize(payload());
    expect(result.status).toBe('INVALID_STRUCTURE');
  });

  it('rejects unauthorized questions, emoji, lists and excess length', async () => {
    const base = payload();
    const withoutQuestion: SanitizedConversationPayload = {
      ...base,
      selectedDecisions: base.selectedDecisions.filter(
        (decision) => decision !== 'ASK_QUESTION',
      ),
      structure: {
        ...base.structure,
        blocks: base.structure.blocks.slice(0, 2),
        paragraphCount: 2,
      },
      limits: { ...base.limits, maximumQuestions: 0, maximumLength: 40 },
    };
    const output = completeOutput();
    output.units = output.units.slice(0, 2);
    output.units[0] = { ...output.units[0], text: '- Estimativa visual 🙂' };
    const result = await realizer(success(output)).service.realize(
      withoutQuestion,
    );

    expect(result.status).toBe('INVALID_STRUCTURE');
  });

  it('realizes an authorized closing as the final locally composed unit', async () => {
    const base = payload();
    const closingPayload: SanitizedConversationPayload = {
      ...base,
      selectedDecisions: base.selectedDecisions
        .filter((decision) => decision !== 'ASK_QUESTION')
        .concat('CLOSE_WITHOUT_QUESTION'),
      structure: {
        ...base.structure,
        blocks: [
          ...base.structure.blocks.slice(0, 2),
          {
            ...base.structure.blocks[2],
            key: 'block-3-minimal-closure',
            type: 'MINIMAL_CLOSURE',
            decisions: ['CLOSE_WITHOUT_QUESTION'],
          },
        ],
      },
      limits: { ...base.limits, maximumQuestions: 0 },
    };
    const output = completeOutput();
    output.units[2] = {
      ...output.units[2],
      blockKey: 'block-3-minimal-closure',
      unitType: 'CLOSING',
      decisionCodes: ['CLOSE_WITHOUT_QUESTION'],
      text: 'Seguimos juntos.',
    };
    const result = await realizer(success(output)).service.realize(
      closingPayload,
    );

    expect(result.status).toBe('COMPLETED');
    expect(result.closingRealized).toBe(true);
    expect(result.candidateText?.endsWith('Seguimos juntos.')).toBe(true);
  });

  it('deep-freezes results, is deterministic and does not mutate payload', async () => {
    const source = payload();
    const snapshot = JSON.stringify(source);
    const first = await realizer(success(completeOutput())).service.realize(
      source,
    );
    const second = await realizer(success(completeOutput())).service.realize(
      source,
    );

    expect(second).toEqual(first);
    expect(JSON.stringify(source)).toBe(snapshot);
    assertDeepFrozen(first);
  });

  it('remains isolated from production and forbidden infrastructure', () => {
    const source = readFileSync(
      join(__dirname, 'nutrition-conversation-language-realizer.ts'),
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
      /OpenAIGateway|(?<!Conversation)AIService|PromptService|PrismaService|Evolution|Worker|EventBus|Outbox|MediaService|NutritionResponseFormatter|ResponseBuilderService|fetch\(|HttpService|axios|Date\.now|Math\.random|console\.log/,
    );
    expect(moduleSource).toContain('NutritionConversationLanguageRealizer');
    expect(responseBuilder).not.toContain(
      'NutritionConversationLanguageRealizer',
    );
  });
});
