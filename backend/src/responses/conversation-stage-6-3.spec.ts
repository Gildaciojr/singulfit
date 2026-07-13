import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ConversationLanguageUnit } from './conversation-language-unit.contract';
import { ConversationLanguageUnitValidationPolicy } from './conversation-language-unit-validation.policy';
import type { SanitizedConversationPayload } from './sanitized-conversation-payload.contract';
import { SanitizedConversationPayloadReferenceBuilder } from './sanitized-conversation-payload-reference.builder';

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
        {
          key: 'direction.authorizedRecommendation',
          source: 'RECOMMENDATION',
          value: { title: 'Adicionar fibras', action: 'Incluir vegetais' },
          estimated: false,
        },
      ],
      sensitive: [
        {
          key: 'userContext.memory',
          source: 'MEMORY',
          value: { summary: 'Prefere refeições simples' },
          estimated: false,
        },
      ],
      disclaimerRequired: ['facts.foods', 'facts.totalProtein'],
    },
    selectedDecisions: [
      'RESPOND_TO_MEAL',
      'SHOW_PROTEIN',
      'USE_MEMORY',
      'PROVIDE_RECOMMENDATION',
    ],
    structure: {
      blocks: [
        {
          key: 'block-1-primary-observation',
          type: 'PRIMARY_OBSERVATION',
          decisions: ['RESPOND_TO_MEAL', 'SHOW_PROTEIN'],
          facts: ['facts.foods', 'facts.totalProtein'],
          order: 0,
          paragraph: 0,
          presentation: 'PROSE',
          required: true,
          maximumLength: 160,
        },
        {
          key: 'block-2-correction',
          type: 'CORRECTION',
          decisions: ['PROVIDE_RECOMMENDATION'],
          facts: ['direction.authorizedRecommendation'],
          order: 1,
          paragraph: 1,
          presentation: 'PROSE',
          required: false,
          maximumLength: 120,
        },
        {
          key: 'block-3-relational-memory',
          type: 'RELATIONAL_MEMORY',
          decisions: ['USE_MEMORY'],
          facts: ['userContext.memory'],
          order: 2,
          paragraph: 2,
          presentation: 'PROSE',
          required: false,
          maximumLength: 100,
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
      maximumLength: 380,
      maximumEmojiCount: 0,
      maximumQuestions: 0,
      maximumActions: 1,
    },
    policies: {
      estimateQualificationRequired: true,
      emojiAllowed: false,
    },
  };
}

function unit(
  overrides: Partial<ConversationLanguageUnit> = {},
): ConversationLanguageUnit {
  return {
    blockKey: 'block-1-primary-observation',
    unitType: 'FACTUAL',
    decisionCodes: ['RESPOND_TO_MEAL', 'SHOW_PROTEIN'],
    factKeys: ['facts.foods', 'facts.totalProtein'],
    text: 'A refeição tem frango e 30 g de proteína.',
    claims: {
      numbers: [30],
      foods: ['Frango'],
      usesMemory: false,
      usesRecommendation: false,
    },
    ...overrides,
  };
}

function assertDeepFrozen(value: unknown): void {
  if (typeof value !== 'object' || value === null) return;
  expect(Object.isFrozen(value)).toBe(true);
  Object.values(value).forEach(assertDeepFrozen);
}

describe('Conversation Layer stage 6.3', () => {
  const referenceBuilder = new SanitizedConversationPayloadReferenceBuilder();
  const policy = new ConversationLanguageUnitValidationPolicy();

  it('generates the same sanitized reference for equal payloads', () => {
    const first = referenceBuilder.build(payload());
    const second = referenceBuilder.build(payload());

    expect(second).toBe(first);
    expect(first).toMatch(/^sanitized-payload:[a-f0-9]{64}$/);
    expect(first).not.toMatch(/analysis|recommendation|conversation|user/i);
  });

  it('generates different references for different sanitized payloads', () => {
    const source = payload();
    const changed: SanitizedConversationPayload = {
      ...source,
      limits: { ...source.limits, maximumLength: 381 },
    };

    expect(referenceBuilder.build(changed)).not.toBe(
      referenceBuilder.build(source),
    );
  });

  it('accepts a traced unit linked to an existing block, decisions and facts', () => {
    const result = policy.validate(payload(), [unit()]);

    expect(result).toEqual(
      expect.objectContaining({ valid: true, violations: [] }),
    );
    assertDeepFrozen(result);
  });

  it.each([
    [
      'unknown block',
      unit({ blockKey: 'block-99-unknown' }),
      'BLOCK_NOT_AUTHORIZED',
    ],
    [
      'unknown decision',
      unit({ decisionCodes: ['ASK_QUESTION'] }),
      'DECISION_NOT_AUTHORIZED',
    ],
    [
      'unknown fact',
      unit({ factKeys: ['facts.totalFat'] }),
      'FACT_NOT_AUTHORIZED',
    ],
    [
      'fact from another block',
      unit({ factKeys: ['direction.authorizedRecommendation'] }),
      'FACT_NOT_LINKED_TO_BLOCK',
    ],
  ])('rejects %s', (_label, candidate, violation) => {
    expect(policy.validate(payload(), [candidate]).violations).toContain(
      violation,
    );
  });

  it('accepts only numbers declared by linked facts', () => {
    expect(policy.validate(payload(), [unit()]).valid).toBe(true);
    expect(
      policy.validate(payload(), [
        unit({ claims: { ...unit().claims, numbers: [31] } }),
      ]).violations,
    ).toContain('NUMBER_NOT_AUTHORIZED');
  });

  it('accepts only food names declared by the linked food fact', () => {
    expect(policy.validate(payload(), [unit()]).valid).toBe(true);
    expect(
      policy.validate(payload(), [
        unit({ claims: { ...unit().claims, foods: ['Salmão'] } }),
      ]).violations,
    ).toContain('FOOD_NOT_AUTHORIZED');
  });

  it('allows memory only in a unit linked to the authorized memory fact', () => {
    const memory = unit({
      blockKey: 'block-3-relational-memory',
      unitType: 'RELATIONAL',
      decisionCodes: ['USE_MEMORY'],
      factKeys: ['userContext.memory'],
      text: 'Isso combina com sua preferência registrada.',
      claims: {
        numbers: [],
        foods: [],
        usesMemory: true,
        usesRecommendation: false,
      },
    });

    expect(policy.validate(payload(), [memory]).valid).toBe(true);
    expect(
      policy.validate(payload(), [
        unit({ claims: { ...unit().claims, usesMemory: true } }),
      ]).violations,
    ).toContain('MEMORY_NOT_AUTHORIZED');
  });

  it('allows recommendations only in a unit linked to the authorized recommendation', () => {
    const recommendation = unit({
      blockKey: 'block-2-correction',
      decisionCodes: ['PROVIDE_RECOMMENDATION'],
      factKeys: ['direction.authorizedRecommendation'],
      text: 'A orientação autorizada é incluir vegetais.',
      claims: {
        numbers: [],
        foods: [],
        usesMemory: false,
        usesRecommendation: true,
      },
    });

    expect(policy.validate(payload(), [recommendation]).valid).toBe(true);
    expect(
      policy.validate(payload(), [
        unit({ claims: { ...unit().claims, usesRecommendation: true } }),
      ]).violations,
    ).toContain('RECOMMENDATION_NOT_AUTHORIZED');
  });

  it('requires factual traceability for factual units', () => {
    const result = policy.validate(payload(), [unit({ factKeys: [] })]);
    expect(result.violations).toContain('FACTUAL_UNIT_WITHOUT_FACTS');
  });

  it('is deterministic and does not mutate input units', () => {
    const source = [unit()];
    const snapshot = JSON.stringify(source);
    const first = policy.validate(payload(), source);
    const second = policy.validate(payload(), source);

    expect(second).toEqual(first);
    expect(JSON.stringify(source)).toBe(snapshot);
  });

  it('contains no false compositionPlanId trace or external integration', () => {
    const contract = readFileSync(
      join(__dirname, 'conversation-language-realization.contract.ts'),
      'utf8',
    );
    const sources = [
      'conversation-language-unit-validation.policy.ts',
      'sanitized-conversation-payload-reference.builder.ts',
    ].map((file) => readFileSync(join(__dirname, file), 'utf8'));
    const responseBuilder = readFileSync(
      join(__dirname, 'response-builder.service.ts'),
      'utf8',
    );

    expect(contract).not.toContain('compositionPlanId');
    expect(contract).toContain('sanitizedPayloadReference');
    for (const source of sources) {
      expect(source).not.toMatch(
        /OpenAI|ConversationAIService|PrismaService|EventBus|Evolution|ResponseBuilder|NutritionResponseFormatter|fetch\(|axios|Date\.now|Math\.random|console\.log/,
      );
    }
    expect(responseBuilder).not.toMatch(
      /ConversationLanguageUnitValidationPolicy|SanitizedConversationPayloadReferenceBuilder/,
    );
  });
});
