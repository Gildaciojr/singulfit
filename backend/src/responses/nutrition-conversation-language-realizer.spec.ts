import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  ConversationAIErrorCode,
  ConversationAIResponse,
} from '../ai/conversation-ai.contract';
import type { ConversationAIService } from '../ai/conversation-ai.service';
import { NutritionConversationLanguageRealizer } from './nutrition-conversation-language-realizer';
import type { SanitizedConversationPayload } from './sanitized-conversation-payload.contract';
import { DEFAULT_NUTRITION_CONVERSATION_COACH_STYLE } from './nutrition-conversation-coach-style.engine';
import { NUTRITION_CONVERSATION_REALIZATION_PROMPT } from './nutrition-conversation-realization-prompt.definition';
import { ProviderRealizationViewBuilder } from './provider-realization-view.builder';
import type { ConversationReasoningEvidence } from './reasoning-bridge/conversation-reasoning-bridge.contract';

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
      dialogueProfile: 'DETAILED_ANALYSIS',
      centralIntent: 'ANALYZE',
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
      coach: DEFAULT_NUTRITION_CONVERSATION_COACH_STYLE,
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
      maximumFacts: 8,
      maximumBlocks: 5,
      maximumParagraphs: 5,
    },
    policies: {
      estimateQualificationRequired: true,
      emojiAllowed: false,
      closingRequirement: 'OPTIONAL',
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

function reasoningEvidence(): ConversationReasoningEvidence {
  return {
    summary: {
      goal: 'criar um plano alimentar',
      decision: 'apoiar desempenho',
      expectedBenefit: 'alinhar a orientação ao treino',
    },
    priorities: [
      {
        topic: 'segurança',
        importance: 'essencial',
        explanation: 'Os limites informados precisam prevalecer.',
      },
    ],
    strategies: [
      {
        name: 'suporte à hidratação',
        purpose: 'preservar regularidade hídrica',
      },
    ],
    restrictions: [],
    tradeoffs: [],
    explanations: [],
    teachingOpportunities: [],
    suggestedQuestions: [],
    safety: {
      requiresCaution: true,
      professionalGuidanceRecommended: false,
      guidance: ['Mantenha a orientação conservadora.'],
    },
    longitudinal: {
      continuity: null,
      progress: null,
      adherence: null,
      repetitionRisk: false,
    },
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

  it('rejects bureaucratic language even when the structured units are otherwise valid', async () => {
    const output = completeOutput();
    output.units[1].text =
      'Com base nos dados, o frango oferece cerca de 30 g de proteína.';
    const target = realizer(success(output));

    const result = await target.service.realize(payload());

    expect(result.status).toBe('INVALID_STRUCTURE');
    expect(result.failureCode).toBe('ROBOTIC_LANGUAGE_PATTERN');
    expect(result.candidateText).toBeNull();
  });

  it('sends only instructions, schema and the sanitized payload through ConversationAIService', async () => {
    const source = payload();
    const providerView = new ProviderRealizationViewBuilder().build(source);
    const target = realizer(success(completeOutput()));
    await target.service.realize(source);
    const request = target.execute.mock.calls[0][0];

    expect(request.payload).toEqual(providerView);
    expect(request.payload).not.toHaveProperty('facts.allowed');
    expect(request.instructions).toContain('somente unidades estruturadas');
    expect(request.instructions).toContain(
      'descreva o fato observado, nunca atribua emoção ao usuário',
    );
    expect(request.schema.name).toBe('nutrition_conversation_language_units');
    expect(JSON.stringify(request)).not.toMatch(
      /mealAnalysisId|conversationId|messageId|userId|compositionPlanId/,
    );
  });

  it('gives every provider block only its canonical local facts', () => {
    const source = payload();
    const view = new ProviderRealizationViewBuilder().build(source);

    expect(view).not.toHaveProperty('facts.allowed');
    expect(
      view.structure.blocks.map((block) => block.facts.map((fact) => fact.key)),
    ).toEqual(source.structure.blocks.map((block) => block.facts));
  });

  it('does not expose a sensitive fact outside its authorized block', () => {
    const source = payload();
    const sensitiveKey = 'userContext.memory';
    const scoped: SanitizedConversationPayload = {
      ...source,
      facts: {
        ...source.facts,
        sensitive: [
          {
            key: sensitiveKey,
            source: 'MEMORY',
            value: { summary: 'Preferência autorizada' },
            estimated: false,
          },
        ],
      },
      structure: {
        ...source.structure,
        blocks: source.structure.blocks.map((block, index) => ({
          ...block,
          facts: index === 2 ? [...block.facts, sensitiveKey] : block.facts,
        })),
      },
    };

    const view = new ProviderRealizationViewBuilder().build(scoped);

    expect(view.structure.blocks[0].facts).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ key: sensitiveKey })]),
    );
    expect(view.structure.blocks[2].facts).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: sensitiveKey })]),
    );
  });

  it('receives semantic reasoning without exposing internal reasoning identifiers', async () => {
    const source = payload();
    const providerView = new ProviderRealizationViewBuilder().build(source);
    const evidence = reasoningEvidence();
    const target = realizer(success(completeOutput()));

    await target.service.realize(
      source,
      { prompt: NUTRITION_CONVERSATION_REALIZATION_PROMPT },
      evidence,
    );
    const request = target.execute.mock.calls[0][0];

    expect(request.payload).toEqual({
      ...providerView,
      reasoning: evidence,
    });
    expect(JSON.stringify(request.payload)).not.toMatch(
      /PackageId|StrategyId|ReasonCode|ConflictCode|PriorityCode|SAFETY_MANDATORY/u,
    );
  });

  it('uses the official execution definition and returns provider metadata outside the payload', async () => {
    const source = payload();
    const providerView = new ProviderRealizationViewBuilder().build(source);
    const target = realizer(success(completeOutput()));
    const result = await target.service.realize(source, {
      prompt: NUTRITION_CONVERSATION_REALIZATION_PROMPT,
      operation: {
        aiJobId: 'conversation-job-id',
        promptVersionId: 'conversation-prompt-version-id',
      },
    });

    expect(target.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'TEXT',
        instructions: NUTRITION_CONVERSATION_REALIZATION_PROMPT.instructions,
        schema: NUTRITION_CONVERSATION_REALIZATION_PROMPT.schema,
        payload: providerView,
      }),
    );
    expect(result.operationalMetadata).toEqual({
      aiJobId: 'conversation-job-id',
      promptVersionId: 'conversation-prompt-version-id',
      providerResponseId: 'provider-ref',
      model: 'model',
      usage: {
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30,
        estimatedCostUsd: null,
      },
      executionStatus: 'PROCESSING',
    });
    expect(JSON.stringify(source)).not.toMatch(
      /conversation-job-id|conversation-prompt-version-id|provider-ref/,
    );
    expect(result.candidateText).not.toMatch(
      /conversation-job-id|conversation-prompt-version-id|provider-ref/,
    );
    assertDeepFrozen(result.operationalMetadata);
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

  it('rejects a cross-block fact and returns only sanitized relationship details', async () => {
    const source = payload();
    const scoped: SanitizedConversationPayload = {
      ...source,
      facts: {
        ...source.facts,
        allowed: [
          ...source.facts.allowed,
          {
            key: 'facts.totalFat',
            source: 'MEAL_ANALYSIS',
            value: 10,
            estimated: true,
          },
        ],
      },
      structure: {
        ...source.structure,
        blocks: source.structure.blocks.map((block, index) => ({
          ...block,
          facts: index === 1 ? [...block.facts, 'facts.totalFat'] : block.facts,
        })),
      },
    };
    const output = completeOutput();
    output.units[0].factKeys = ['facts.totalFat'];

    const result = await realizer(success(output)).service.realize(scoped);

    expect(result.status).toBe('INVALID_STRUCTURE');
    expect(result.failureCode).toBe('UNIT_VALIDATION:FACT_NOT_LINKED_TO_BLOCK');
    expect(result.violationDetails).toEqual([
      {
        code: 'FACT_NOT_LINKED_TO_BLOCK',
        blockKey: 'block-1-uncertainty-qualification',
        factKey: 'facts.totalFat',
      },
    ]);
    expect(result.candidateText).toBeNull();
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

  it('realizes an emotional adaptation only with authorized evidence', async () => {
    const base = payload();
    const emotionalPayload: SanitizedConversationPayload = {
      ...base,
      facts: {
        ...base.facts,
        allowed: [
          ...base.facts.allowed,
          {
            key: 'emotional.FRUSTRATION',
            source: 'LONGITUDINAL',
            value: {
              kind: 'FRUSTRATION',
              evidence: ['essa estratégia ainda não mostrou resultado'],
            },
            estimated: false,
          },
        ],
      },
      selectedDecisions: [...base.selectedDecisions, 'VALIDATE_FRUSTRATION'],
      structure: {
        ...base.structure,
        blocks: base.structure.blocks.map((block, index) =>
          index === 1
            ? {
                ...block,
                decisions: [...block.decisions, 'VALIDATE_FRUSTRATION'],
                facts: [...block.facts, 'emotional.FRUSTRATION'],
              }
            : block,
        ),
      },
    };
    const output = completeOutput();
    output.units[1] = {
      ...output.units[1],
      decisionCodes: [...output.units[1].decisionCodes, 'VALIDATE_FRUSTRATION'],
      factKeys: [...output.units[1].factKeys, 'emotional.FRUSTRATION'],
      text: 'Essa estratégia ainda não mostrou resultado; o frango oferece cerca de 30 g de proteína.',
    };

    const result = await realizer(success(output)).service.realize(
      emotionalPayload,
    );
    expect(result.status).toBe('COMPLETED');
    expect(result.realizedFacts).toContain('emotional.FRUSTRATION');
  });

  it('realizes only an authorized episodic memory and rejects an invented date', async () => {
    const base = payload();
    const episodicPayload: SanitizedConversationPayload = {
      ...base,
      facts: {
        ...base.facts,
        allowed: [
          ...base.facts.allowed,
          {
            key: 'episodicMemory.COMMITMENT',
            source: 'MEMORY',
            value: {
              category: 'COMMITMENT',
              fact: { action: 'incluir vegetais no almoço' },
              relationToContext: 'follow-up atual',
              recallReason: 'FOLLOW_UP_DUE',
            },
            estimated: false,
          },
        ],
      },
      selectedDecisions: [...base.selectedDecisions, 'CHECK_COMMITMENT'],
      structure: {
        ...base.structure,
        blocks: base.structure.blocks.map((block, index) =>
          index === 1
            ? {
                ...block,
                decisions: [...block.decisions, 'CHECK_COMMITMENT'],
                facts: [...block.facts, 'episodicMemory.COMMITMENT'],
              }
            : block,
        ),
      },
    };
    const authorized = completeOutput();
    authorized.units[1] = {
      ...authorized.units[1],
      decisionCodes: [...authorized.units[1].decisionCodes, 'CHECK_COMMITMENT'],
      factKeys: [...authorized.units[1].factKeys, 'episodicMemory.COMMITMENT'],
      text: 'O combinado era incluir vegetais; o frango oferece cerca de 30 g de proteína.',
      claims: { ...authorized.units[1].claims, usesMemory: true },
    };
    const dated = completeOutput();
    dated.units[1] = {
      ...authorized.units[1],
      text: 'Em janeiro, o combinado era incluir vegetais; o frango oferece cerca de 30 g de proteína.',
    };

    const valid = await realizer(success(authorized)).service.realize(
      episodicPayload,
    );
    const invalid = await realizer(success(dated)).service.realize(
      episodicPayload,
    );

    expect(valid.status).toBe('COMPLETED');
    expect(valid.realizedFacts).toContain('episodicMemory.COMMITMENT');
    expect(invalid.status).toBe('INVALID_STRUCTURE');
    expect(invalid.failureCode).toBe('INVALID_EPISODIC_MEMORY');
  });

  it('rejects inferred emotion, guilt and emotional decisions without evidence', async () => {
    const base = payload();
    const emotionalPayload: SanitizedConversationPayload = {
      ...base,
      facts: {
        ...base.facts,
        allowed: [
          ...base.facts.allowed,
          {
            key: 'emotional.FRUSTRATION',
            source: 'LONGITUDINAL',
            value: {
              kind: 'FRUSTRATION',
              evidence: ['estratégia sem resultado'],
            },
            estimated: false,
          },
        ],
      },
      selectedDecisions: [...base.selectedDecisions, 'VALIDATE_FRUSTRATION'],
      structure: {
        ...base.structure,
        blocks: base.structure.blocks.map((block, index) =>
          index === 1
            ? {
                ...block,
                decisions: [...block.decisions, 'VALIDATE_FRUSTRATION'],
                facts: [...block.facts, 'emotional.FRUSTRATION'],
              }
            : block,
        ),
      },
    };
    const inferred = completeOutput();
    inferred.units[1] = {
      ...inferred.units[1],
      decisionCodes: [
        ...inferred.units[1].decisionCodes,
        'VALIDATE_FRUSTRATION',
      ],
      factKeys: [...inferred.units[1].factKeys, 'emotional.FRUSTRATION'],
      text: 'Você está frustrado com o frango e seus 30 g de proteína.',
    };
    const missingEvidence = completeOutput();
    missingEvidence.units[1] = {
      ...missingEvidence.units[1],
      decisionCodes: [
        ...missingEvidence.units[1].decisionCodes,
        'VALIDATE_FRUSTRATION',
      ],
    };

    expect(
      (await realizer(success(inferred)).service.realize(emotionalPayload))
        .status,
    ).toBe('INVALID_STRUCTURE');
    expect(
      (
        await realizer(success(missingEvidence)).service.realize(
          emotionalPayload,
        )
      ).status,
    ).toBe('INVALID_STRUCTURE');
  });

  it('rejects generic praise, empty motivation and robotic language', async () => {
    const base = payload();
    const genericPraise = completeOutput();
    genericPraise.units[1] = {
      ...genericPraise.units[1],
      text: 'Parabéns! Continue assim.',
      claims: {
        numbers: [],
        foods: [],
        usesMemory: false,
        usesRecommendation: false,
      },
    };
    const motivationalPayload: SanitizedConversationPayload = {
      ...base,
      selectedDecisions: [...base.selectedDecisions, 'MOTIVATE_WITH_EVIDENCE'],
      structure: {
        ...base.structure,
        blocks: base.structure.blocks.map((block, index) =>
          index === 1
            ? {
                ...block,
                decisions: [...block.decisions, 'MOTIVATE_WITH_EVIDENCE'],
              }
            : block,
        ),
      },
    };
    const emptyMotivation = completeOutput();
    emptyMotivation.units[1] = {
      ...emptyMotivation.units[1],
      decisionCodes: [
        ...emptyMotivation.units[1].decisionCodes,
        'MOTIVATE_WITH_EVIDENCE',
      ],
      text: 'Siga firme no processo.',
      claims: {
        numbers: [],
        foods: [],
        usesMemory: false,
        usesRecommendation: false,
      },
    };
    const robotic = completeOutput();
    robotic.units[1] = {
      ...robotic.units[1],
      text: 'De acordo com os dados, a análise indica equilíbrio.',
      claims: {
        numbers: [],
        foods: [],
        usesMemory: false,
        usesRecommendation: false,
      },
    };

    const praiseResult = await realizer(success(genericPraise)).service.realize(
      base,
    );
    const motivationResult = await realizer(
      success(emptyMotivation),
    ).service.realize(motivationalPayload);
    const roboticResult = await realizer(success(robotic)).service.realize(
      base,
    );

    expect(praiseResult.failureCode).toContain(
      'COACH_STYLE:GENERIC_PRAISE_WITHOUT_EVIDENCE',
    );
    expect(motivationResult.failureCode).toContain(
      'COACH_STYLE:MOTIVATION_WITHOUT_EVIDENCE',
    );
    expect(roboticResult.failureCode).toContain('COACH_STYLE:ROBOTIC_LANGUAGE');
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

  it.each([
    ['CELEBRATE', 'CELEBRATE'],
    ['CLARIFY_BEFORE_ANALYSIS', 'CLARIFY'],
  ] as const)(
    'rejects units that violate the %s profile',
    async (dialogueProfile, centralIntent) => {
      const base = payload();
      const incompatible: SanitizedConversationPayload = {
        ...base,
        structure: { ...base.structure, dialogueProfile, centralIntent },
      };

      const result = await realizer(success(completeOutput())).service.realize(
        incompatible,
      );

      expect(result.status).toBe('INVALID_STRUCTURE');
      expect(result.failureCode).toBe('DIALOGUE_PROFILE_VIOLATION');
    },
  );

  it('rejects detailed analysis inside RECOVERY and permits it only in DETAILED_ANALYSIS', async () => {
    const base = payload();
    const detailedPayload: SanitizedConversationPayload = {
      ...base,
      selectedDecisions: [...base.selectedDecisions, 'DETAIL_ANALYSIS'],
      structure: {
        ...base.structure,
        blocks: base.structure.blocks.map((block, index) =>
          index === 1
            ? {
                ...block,
                decisions: [...block.decisions, 'DETAIL_ANALYSIS'],
              }
            : block,
        ),
      },
    };
    const output = completeOutput();
    output.units[1] = {
      ...output.units[1],
      decisionCodes: [...output.units[1].decisionCodes, 'DETAIL_ANALYSIS'],
    };
    const detailed = await realizer(success(output)).service.realize(
      detailedPayload,
    );
    const recovery = await realizer(success(output)).service.realize({
      ...detailedPayload,
      structure: {
        ...detailedPayload.structure,
        dialogueProfile: 'RECOVERY',
        centralIntent: 'RECOVER',
      },
    });

    expect(detailed.status).toBe('COMPLETED');
    expect(recovery.status).toBe('INVALID_STRUCTURE');
    expect(recovery.failureCode).toBe('DIALOGUE_PROFILE_VIOLATION');
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
    expect(moduleSource).toContain('ConversationRealizationModule');
    const realizationModule = readFileSync(
      join(__dirname, 'conversation-realization.module.ts'),
      'utf8',
    );
    expect(realizationModule).toContain(
      'NutritionConversationLanguageRealizer',
    );
    expect(responseBuilder).not.toContain(
      'NutritionConversationLanguageRealizer',
    );
  });
});
