import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LongitudinalResponseContext } from '../longitudinal/interfaces/longitudinal.interface';
import type { NutritionConversationContext } from './nutrition-conversation-context.interface';
import { NutritionConversationEpisodicMemoryCaptureEngine } from './nutrition-conversation-episodic-memory-capture.engine';
import { NutritionConversationEpisodicMemoryEngine } from './nutrition-conversation-episodic-memory.engine';

function context(
  overrides: Partial<NutritionConversationContext> = {},
): NutritionConversationContext {
  return {
    metadata: { mealAnalysisId: 'analysis-1' },
    facts: {
      mealCategory: 'LUNCH',
      foods: [{ name: 'Arroz', estimatedGrams: 100 }],
      totalCalories: 420,
      totalProtein: 30,
      totalCarbs: 50,
      totalFat: 10,
      qualityScore: 80,
      confidence: 0.9,
    },
    policies: { requiresEstimateQualification: true },
    userContext: {
      goal: 'WEIGHT_LOSS',
      activityLevel: 'MODERATE',
      relevantRestrictions: [{ description: 'sem lactose' }],
      relevantAllergies: [{ type: 'ALERGIA', description: 'amendoim' }],
      preferredLanguage: 'pt-BR',
      timezone: 'America/Sao_Paulo',
      recentMeals: [],
    },
    direction: {
      supportingEvidence: { positiveFactors: [], limitingFactors: [] },
    },
    recognition: {
      signals: [
        {
          kind: 'SMALL_WIN',
          origin: 'LONGITUDINAL',
          confidence: 'HIGH',
          evidence: ['STRUCTURED_COMPARISON'],
          goalRelation: 'WEIGHT_LOSS',
        },
      ],
    },
    communication: {
      communicationStyle: 'FRIENDLY',
      coachingStyle: 'MOTIVATIONAL',
      tone: 'MODERATE',
      motivationFocus: 'HEALTH',
      prefersShortMessages: false,
      preferredMessageLength: 500,
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

function longitudinal(): LongitudinalResponseContext {
  return {
    profile: null,
    preferences: [
      { foodName: 'Feijão', kind: 'FREQUENT', confidence: 0.9 },
      { foodName: 'Doce', kind: 'REJECTED', confidence: 0.95 },
    ],
    evolution: null,
    relapse: { severity: 'MEDIUM', reasons: ['SUGAR'] },
    goalProgression: {
      goal: 'WEIGHT_LOSS',
      state: 'IMPROVING',
      score: 82,
    },
    coachAdaptation: null,
    memories: [],
    monthlyReview: null,
  };
}

function assertDeepFrozen(value: unknown): void {
  if (typeof value !== 'object' || value === null) return;
  expect(Object.isFrozen(value)).toBe(true);
  Object.values(value).forEach(assertDeepFrozen);
}

describe('NutritionConversationEpisodicMemoryCaptureEngine', () => {
  const engine = new NutritionConversationEpisodicMemoryCaptureEngine();

  it('creates deterministic commands only from approved structured sources', () => {
    const input = {
      userId: 'user-1',
      sourceEvidenceKey: 'analysis-1',
      logicalNow: 1_000,
      context: context(),
      longitudinal: longitudinal(),
      preferredMealTimes: ['12:30', '19:00'],
      coachReengagement: { reason: 'FORGOTTEN', confidence: 0.9 },
      existing: [],
    } as const;
    const first = engine.plan(input);
    const second = engine.plan(input);
    const categories = new Set(
      first.flatMap((command) =>
        command.evidence ? [command.evidence.category] : [],
      ),
    );

    expect(second).toEqual(first);
    expect(first.every((command) => command.operation === 'CREATE')).toBe(true);
    expect(categories).toEqual(
      new Set([
        'GOAL',
        'RESTRICTION',
        'ALLERGY',
        'ROUTINE',
        'SUCCESS',
        'SETBACK',
        'MILESTONE',
        'HABIT',
        'FOLLOW_UP',
      ]),
    );
    expect(categories.has('PREFERENCE')).toBe(false);
    expect(
      first.some(
        (command) =>
          command.evidence?.fact &&
          JSON.stringify(command.evidence.fact).includes('Doce'),
      ),
    ).toBe(false);
    const protectedConstraints = first
      .map((command) => command.evidence)
      .filter(
        (evidence) =>
          evidence?.category === 'ALLERGY' ||
          evidence?.category === 'RESTRICTION',
      );
    expect(protectedConstraints).toHaveLength(2);
    expect(
      protectedConstraints.every(
        (evidence) =>
          evidence?.expiresAtLogical === undefined &&
          evidence.eligibleForConversation === false &&
          evidence.resumePolicy === 'NEVER',
      ),
    ).toBe(true);
    assertDeepFrozen(first);
  });

  it('produces NO_OP for retry, UPDATE for recurrence and SUPERSEDE for changed facts', () => {
    const base = {
      userId: 'user-1',
      sourceEvidenceKey: 'analysis-1',
      logicalNow: 1_000,
      context: context({ recognition: { signals: [] } }),
      existing: [],
    } as const;
    const created = engine.plan(base);
    const goal = created.find(
      (command) => command.evidence?.category === 'GOAL',
    );
    if (!goal?.evidence) throw new Error('Comando de objetivo ausente');
    const episode = new NutritionConversationEpisodicMemoryEngine().register(
      [],
      [goal.evidence],
      1_000,
    )[0];
    const existing = [{ sourceKey: goal.sourceKey, episode }];
    const retry = engine.plan({ ...base, existing });
    const changed = engine.plan({
      ...base,
      context: context({
        recognition: { signals: [] },
        userContext: {
          ...context().userContext,
          goal: 'MUSCLE_GAIN',
        },
      }),
      existing,
    });

    expect(
      retry.find((command) => command.continuityKey === 'profile:goal')
        ?.operation,
    ).toBe('NO_OP');
    expect(
      changed.find((command) => command.continuityKey === 'profile:goal')
        ?.operation,
    ).toBe('SUPERSEDE');

    const recurring = engine.plan({
      ...base,
      sourceEvidenceKey: 'analysis-2',
      context: context(),
      existing: [
        {
          sourceKey: engine.sourceKey(
            'user-1',
            'SUCCESS',
            'OBSERVATION',
            'recognition:success:small_win',
            'RECOGNITION_SUCCESS',
          ),
          episode: new NutritionConversationEpisodicMemoryEngine().register(
            [],
            [
              engine
                .plan({ ...base, context: context() })
                .find(
                  (command) =>
                    command.continuityKey === 'recognition:success:small_win',
                )!.evidence!,
            ],
            1_000,
          )[0],
        },
      ],
    });
    expect(
      recurring.find(
        (command) => command.continuityKey === 'recognition:success:small_win',
      )?.operation,
    ).toBe('UPDATE');
  });

  it('invalidates removed explicit profile constraints without reading free text', () => {
    const initial = engine.plan({
      userId: 'user-1',
      sourceEvidenceKey: 'analysis-1',
      logicalNow: 1_000,
      context: context({ recognition: { signals: [] } }),
      existing: [],
    });
    const allergy = initial.find(
      (command) => command.evidence?.category === 'ALLERGY',
    );
    if (!allergy?.evidence) throw new Error('Alergia ausente');
    const episode = new NutritionConversationEpisodicMemoryEngine().register(
      [],
      [allergy.evidence],
      1_000,
    )[0];
    const commands = engine.plan({
      userId: 'user-1',
      sourceEvidenceKey: 'analysis-2',
      logicalNow: 2_000,
      context: context({
        recognition: { signals: [] },
        userContext: {
          ...context().userContext,
          relevantAllergies: [],
        },
      }),
      existing: [{ sourceKey: allergy.sourceKey, episode }],
    });

    expect(commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operation: 'INVALIDATE',
          sourceKey: allergy.sourceKey,
          lifecycleAction: 'INVALIDATE',
        }),
      ]),
    );
  });

  it('isolates source keys by user and contains no AI, persistence, randomness or free-text extraction', () => {
    expect(
      engine.sourceKey(
        'user-1',
        'GOAL',
        'FACT',
        'profile:goal',
        'PROFILE_GOAL',
      ),
    ).not.toBe(
      engine.sourceKey(
        'user-2',
        'GOAL',
        'FACT',
        'profile:goal',
        'PROFILE_GOAL',
      ),
    );
    const source = readFileSync(
      join(
        __dirname,
        'nutrition-conversation-episodic-memory-capture.engine.ts',
      ),
      'utf8',
    );
    expect(source).not.toMatch(
      /OpenAI|Prisma|embedding|NLP|Math\.random|console\.log|message\.content|prompt|Base64|TODO|FIXME|\bany\b/,
    );
  });
});
