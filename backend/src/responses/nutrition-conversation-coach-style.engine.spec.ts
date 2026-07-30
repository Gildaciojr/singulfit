import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CompositionPlan } from './conversation-composition.contract';
import type { ConversationLanguageUnit } from './conversation-language-unit.contract';
import {
  DEFAULT_NUTRITION_CONVERSATION_COACH_STYLE,
  NutritionConversationCoachStyleEngine,
} from './nutrition-conversation-coach-style.engine';
import type { NutritionConversationContext } from './nutrition-conversation-context.interface';
import type {
  SanitizedConversationDecision,
  SanitizedConversationPayload,
} from './sanitized-conversation-payload.contract';

function context(
  overrides: Partial<NutritionConversationContext> = {},
): NutritionConversationContext {
  return {
    metadata: { mealAnalysisId: 'analysis-1' },
    facts: {
      mealCategory: 'LUNCH',
      foods: [{ name: 'Arroz', estimatedGrams: 120 }],
      totalCalories: 420,
      totalProtein: 25,
      totalCarbs: 52,
      totalFat: 10,
      qualityScore: 78,
    },
    policies: { requiresEstimateQualification: true },
    userContext: {
      goal: 'WEIGHT_LOSS',
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
    recognition: { signals: [] },
    emotional: { signals: [] },
    episodicMemory: { episodes: [] },
    dialogue: {
      interactionIntent: 'MEAL_ANALYSIS',
      explicitDetailRequest: false,
      specificQuestion: false,
      clarificationRequired: false,
      previousCommitmentAvailable: false,
    },
    communication: {
      communicationStyle: 'BALANCED',
      coachingStyle: 'MOTIVATIONAL',
      tone: 'MODERATE',
      motivationFocus: 'HEALTH',
      prefersShortMessages: false,
      preferredMessageLength: 480,
      idealEmojiCount: 0,
      fatigue: {
        score: 20,
        repeatedThemeScore: 0,
        repeatedPhraseScore: 0,
      },
      stageOfChange: 'ACTION',
      preferredTopics: [],
      ignoredTopics: [],
      shouldAskQuestion: false,
    },
    ...overrides,
  };
}

function composition(
  overrides: Partial<CompositionPlan> = {},
): CompositionPlan {
  return {
    id: 'composition-1',
    decisionPlanId: 'decision-plan-1',
    blocks: [],
    dialogueProfile: 'ACKNOWLEDGE_ONLY',
    centralIntent: 'RECOGNIZE',
    profileBudgets: {
      maximumPerceptibleDecisions: 2,
      maximumFactCount: 5,
      maximumBlockCount: 3,
      maximumParagraphCount: 2,
      maximumQuestions: 0,
      maximumActions: 0,
      maximumEmojiCount: 0,
      maximumLength: 360,
    },
    closingRequirement: 'OPTIONAL',
    depth: 'BRIEF',
    density: 'LOW',
    rhythm: 'WARM',
    presentation: 'PROSE',
    paragraphCount: 1,
    maximumLength: 360,
    emojiAllowed: false,
    maximumEmojiCount: 0,
    ...overrides,
  };
}

function payload(
  coach = DEFAULT_NUTRITION_CONVERSATION_COACH_STYLE,
): SanitizedConversationPayload {
  return {
    facts: {
      allowed: [
        {
          key: 'recognition.SMALL_WIN',
          source: 'LONGITUDINAL',
          value: { kind: 'SMALL_WIN' },
          estimated: false,
        },
        {
          key: 'userContext.goal',
          source: 'USER_CONTEXT',
          value: 'WEIGHT_LOSS',
          estimated: false,
        },
      ],
      sensitive: [],
      disclaimerRequired: [],
    },
    selectedDecisions: ['RESPOND_TO_MEAL'],
    structure: {
      dialogueProfile: 'ACKNOWLEDGE_ONLY',
      centralIntent: 'RECOGNIZE',
      blocks: [],
      depth: 'BRIEF',
      density: 'LOW',
      rhythm: 'WARM',
      presentation: 'PROSE',
      paragraphCount: 1,
    },
    style: {
      coach,
      communication: 'BALANCED',
      coaching: 'MOTIVATIONAL',
      tone: 'MODERATE',
      motivationFocus: 'HEALTH',
      stageOfChange: 'ACTION',
    },
    limits: {
      maximumLength: 360,
      maximumEmojiCount: 0,
      maximumQuestions: 0,
      maximumActions: 0,
      maximumFacts: 5,
      maximumBlocks: 3,
      maximumParagraphs: 2,
    },
    policies: {
      estimateQualificationRequired: false,
      emojiAllowed: false,
      closingRequirement: 'OPTIONAL',
    },
  };
}

function unit(
  text: string,
  decisions: readonly SanitizedConversationDecision[] = ['RESPOND_TO_MEAL'],
  factKeys: readonly string[] = [],
): ConversationLanguageUnit {
  return {
    blockKey: 'response',
    unitType: 'RELATIONAL',
    decisionCodes: decisions,
    factKeys,
    text,
    claims: {
      numbers: [],
      foods: [],
      usesMemory: false,
      usesRecommendation: false,
    },
  };
}

function assertDeepFrozen(value: unknown): void {
  if (typeof value !== 'object' || value === null) return;
  expect(Object.isFrozen(value)).toBe(true);
  Object.values(value).forEach(assertDeepFrozen);
}

describe('NutritionConversationCoachStyleEngine', () => {
  const engine = new NutritionConversationCoachStyleEngine();

  it('keeps one permanent identity and resolves deterministic variation', () => {
    const first = engine.resolve(context(), composition(), ['RESPOND_TO_MEAL']);
    const second = engine.resolve(context(), composition(), [
      'RESPOND_TO_MEAL',
    ]);

    expect(second).toEqual(first);
    expect(first).toEqual(
      expect.objectContaining({
        identity: 'SINGULFIT_COACH_V1',
        role: 'SPORTS_NUTRITION_COACH',
        toneStrategy: 'CALM_OBJECTIVE',
        pacing: 'BALANCED',
      }),
    );
    expect(first.personality).toEqual(
      DEFAULT_NUTRITION_CONVERSATION_COACH_STYLE.personality,
    );
    assertDeepFrozen(first);
  });

  it.each([
    [
      'victory',
      context({
        recognition: {
          signals: [
            {
              kind: 'SMALL_WIN',
              origin: 'LONGITUDINAL',
              confidence: 'HIGH',
              evidence: ['comparação real'],
            },
          ],
        },
      }),
      composition({ centralIntent: 'CELEBRATE', dialogueProfile: 'CELEBRATE' }),
      'DISCREET_CELEBRATION',
    ],
    [
      'setback',
      context({
        recognition: {
          signals: [
            {
              kind: 'SETBACK',
              origin: 'LONGITUDINAL',
              confidence: 'HIGH',
              evidence: ['regressão confirmada'],
            },
          ],
        },
      }),
      composition({ centralIntent: 'RECOVER', dialogueProfile: 'RECOVERY' }),
      'CALM_RECOVERY',
    ],
    [
      'plateau',
      context({
        recognition: {
          signals: [
            {
              kind: 'PLATEAU',
              origin: 'LONGITUDINAL',
              confidence: 'HIGH',
              evidence: ['tendência estável'],
            },
          ],
        },
      }),
      composition(),
      'PLATEAU_REASSURANCE',
    ],
    [
      'detail',
      context(),
      composition({ centralIntent: 'TEACH', dialogueProfile: 'TEACH_BRIEFLY' }),
      'CURIOUS_EXPLANATION',
    ],
  ] as const)(
    'adapts tone for %s without changing identity',
    (_, input, plan, expected) => {
      const style = engine.resolve(input, plan, ['RESPOND_TO_MEAL']);
      expect(style.toneStrategy).toBe(expected);
      expect(style.identity).toBe('SINGULFIT_COACH_V1');
    },
  );

  it('uses context, fatigue, complexity and memory without randomness', () => {
    const fatigued = context({
      episodicMemory: {
        episodes: [
          {
            continuityKey: 'goal',
            category: 'GOAL',
            fact: { goal: 'WEIGHT_LOSS' },
            relationToContext: 'objetivo atual',
            recallReason: 'CURRENT_GOAL',
            source: 'USER_CONTEXT',
            sensitivity: 'STANDARD',
          },
        ],
      },
      communication: {
        ...context().communication,
        fatigue: {
          score: 80,
          repeatedThemeScore: 70,
          repeatedPhraseScore: 60,
        },
      },
    });
    const style = engine.resolve(
      fatigued,
      composition({ paragraphCount: 3, closingRequirement: 'PROHIBITED' }),
      ['RESPOND_TO_MEAL'],
    );

    expect(style.openingStrategy).toBe('CONTINUITY');
    expect(style.pacing).toBe('COMPACT');
    expect(style.closingStrategy).toBe('NONE');
    expect(style.humor).toBe('PROHIBITED');
  });

  it('rejects empty praise, empty motivation and inferred emotion', () => {
    const praise = engine.evaluate(payload(), 'Parabéns! Continue assim.', [
      unit('Parabéns! Continue assim.'),
    ]);
    const motivation = engine.evaluate(payload(), 'Siga firme no processo.', [
      unit('Siga firme no processo.', ['MOTIVATE_WITH_EVIDENCE']),
    ]);
    const emotion = engine.evaluate(payload(), 'Você está frustrado.', [
      unit('Você está frustrado.', ['VALIDATE_FRUSTRATION']),
    ]);

    expect(praise.violations).toContain('GENERIC_PRAISE_WITHOUT_EVIDENCE');
    expect(motivation.violations).toContain('MOTIVATION_WITHOUT_EVIDENCE');
    expect(emotion.violations).toContain('EMOTIONAL_INFERENCE');
  });

  it('rejects robotic, repetitive, moralizing and automatic closing language', () => {
    const result = engine.evaluate(
      payload(),
      'De acordo com os dados, foi perfeito. De acordo com os dados, foi perfeito. Sem desculpas. Conte comigo.',
      [
        unit(
          'De acordo com os dados, foi perfeito. De acordo com os dados, foi perfeito. Sem desculpas. Conte comigo.',
        ),
      ],
    );

    expect(result.violations).toEqual(
      expect.arrayContaining([
        'ROBOTIC_LANGUAGE',
        'LEXICAL_REPETITION',
        'MORALIZING_LANGUAGE',
        'GENERIC_CLOSING',
      ]),
    );
  });

  it('rejects psychological diagnosis and unauthorized promises', () => {
    const result = engine.evaluate(
      payload(),
      'Você tem ansiedade, mas garanto que vai dar certo com certeza.',
      [unit('Você tem ansiedade, mas garanto que vai dar certo com certeza.')],
    );

    expect(result.violations).toEqual(
      expect.arrayContaining([
        'PSYCHOLOGICAL_DIAGNOSIS',
        'UNAUTHORIZED_PROMISE',
      ]),
    );
  });

  it('accepts evidence-based recognition and natural continuity with objective metrics', () => {
    const text =
      'A melhora apareceu na comparação real, e isso aproxima você do objetivo. Na conversa anterior, esse ajuste já tinha funcionado.';
    const result = engine.evaluate(payload(), text, [
      {
        ...unit(
          text,
          ['ACKNOWLEDGE_IMPROVEMENT', 'RECALL_GOAL'],
          ['recognition.SMALL_WIN', 'userContext.goal'],
        ),
        claims: {
          numbers: [],
          foods: [],
          usesMemory: true,
          usesRecommendation: false,
        },
      },
    ]);

    expect(result.valid).toBe(true);
    expect(result.metrics.coachIdentity).toBe(100);
    expect(result.metrics.motivationQuality).toBe(100);
    expect(result.metrics.humanPerception).toBeGreaterThanOrEqual(80);
    assertDeepFrozen(result);
  });

  it('contains no random, clock, provider or infrastructure dependency', () => {
    const source = readFileSync(
      join(__dirname, 'nutrition-conversation-coach-style.engine.ts'),
      'utf8',
    );
    expect(source).not.toMatch(
      /Math\.random|Date\.now|OpenAI|ConversationAI|Prisma|Evolution|EventBus|Outbox|console\.log|TODO|FIXME|\bany\b/,
    );
  });
});
