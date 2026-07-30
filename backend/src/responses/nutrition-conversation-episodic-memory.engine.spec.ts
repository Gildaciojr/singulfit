import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  NutritionConversationEpisodeCategory,
  NutritionConversationEpisodeEvidence,
  NutritionConversationEpisodeSelectionContext,
} from './nutrition-conversation-episodic-memory.contract';
import { NutritionConversationEpisodicMemoryEngine } from './nutrition-conversation-episodic-memory.engine';

const CATEGORIES: readonly NutritionConversationEpisodeCategory[] = [
  'GOAL',
  'DIFFICULTY',
  'HABIT',
  'SUCCESS',
  'SETBACK',
  'PLAN',
  'COMMITMENT',
  'QUESTION',
  'PREFERENCE',
  'ROUTINE',
  'ALLERGY',
  'RESTRICTION',
  'TRAVEL',
  'WORKOUT',
  'MILESTONE',
  'FOLLOW_UP',
];

function evidence(
  continuityKey: string,
  overrides: Partial<NutritionConversationEpisodeEvidence> = {},
): NutritionConversationEpisodeEvidence {
  return {
    category: 'COMMITMENT',
    nature: 'FACT',
    confidence: 'HIGH',
    createdAtLogical: 10,
    expiresAtLogical: 30,
    importance: 'HIGH',
    source: 'COACH',
    eligibleForConversation: true,
    resumePolicy: 'WHEN_RELEVANT',
    recallPolicy: 'FREE',
    recallReason: 'FOLLOW_UP_DUE',
    continuityKey,
    originEvidence: [
      { code: 'COMMITMENT_RECORDED', source: 'COACH', value: true },
    ],
    sensitivity: 'STANDARD',
    confirmation: 'NOT_REQUIRED',
    fact: { commitment: 'vegetais no almoço' },
    relationToContext: 'follow-up nutricional atual',
    theme: 'vegetais',
    ...overrides,
  };
}

function selection(
  overrides: Partial<NutritionConversationEpisodeSelectionContext> = {},
): NutritionConversationEpisodeSelectionContext {
  return {
    logicalNow: 20,
    currentTheme: 'vegetais',
    relevantCategories: ['COMMITMENT', 'SUCCESS', 'DIFFICULTY'],
    fatigueScore: 20,
    dialogueProfile: 'CONTINUITY_CHECK',
    limit: 2,
    previouslyRecalledContinuityKeys: [],
    ...overrides,
  };
}

function assertDeepFrozen(value: unknown): void {
  if (typeof value !== 'object' || value === null) return;
  expect(Object.isFrozen(value)).toBe(true);
  Object.values(value).forEach(assertDeepFrozen);
}

describe('NutritionConversationEpisodicMemoryEngine', () => {
  const engine = new NutritionConversationEpisodicMemoryEngine();

  it('supports every approved category with immutable structured evidence', () => {
    const episodes = engine.register(
      [],
      CATEGORIES.map((category, index) =>
        evidence(`episode-${category}`, {
          category,
          createdAtLogical: index,
          expiresAtLogical: 100,
        }),
      ),
      20,
    );

    expect(episodes.map((episode) => episode.category)).toEqual(CATEGORIES);
    assertDeepFrozen(episodes);
  });

  it('supersedes and consolidates without deleting history', () => {
    const first = engine.register([], [evidence('commitment')], 10);
    const second = engine.register(
      first,
      [evidence('commitment', { createdAtLogical: 15 })],
      15,
    );

    expect(second).toHaveLength(2);
    expect(second[0]).toEqual(
      expect.objectContaining({
        status: 'SUPERSEDED',
        lifecycle: expect.objectContaining({
          state: 'SUPERSEDED',
          version: 2,
        }),
      }),
    );
    expect(second[1]).toEqual(
      expect.objectContaining({
        status: 'ACTIVE',
        lifecycle: expect.objectContaining({
          state: 'CONSOLIDATED',
          version: 2,
        }),
      }),
    );
  });

  it('expires, completes and invalidates only through logical lifecycle transitions', () => {
    const episodes = engine.register(
      [],
      [
        evidence('expired', { expiresAtLogical: 15 }),
        evidence('completed'),
        evidence('invalidated'),
      ],
      10,
    );
    const transitioned = engine.applyLifecycle(
      episodes,
      [
        {
          continuityKey: 'completed',
          action: 'COMPLETE',
          atLogical: 18,
          reason: 'COMMITMENT_CONFIRMED',
        },
        {
          continuityKey: 'invalidated',
          action: 'INVALIDATE',
          atLogical: 19,
          reason: 'STRUCTURED_CONTRADICTION',
        },
      ],
      20,
    );

    expect(transitioned.map((episode) => episode.status)).toEqual([
      'EXPIRED',
      'COMPLETED',
      'INVALIDATED',
    ]);
    expect(transitioned.map((episode) => episode.lifecycle.version)).toEqual([
      2, 2, 2,
    ]);
    expect(transitioned).toHaveLength(episodes.length);
    assertDeepFrozen(transitioned);
  });

  it('never reactivates superseded history when applying a lifecycle directive', () => {
    const first = engine.register([], [evidence('commitment')], 10);
    const history = engine.register(
      first,
      [evidence('commitment', { createdAtLogical: 15 })],
      15,
    );

    const transitioned = engine.applyLifecycle(
      history,
      [
        {
          continuityKey: 'commitment',
          action: 'COMPLETE',
          atLogical: 20,
          reason: 'CURRENT_COMMITMENT_COMPLETED',
        },
      ],
      20,
    );

    expect(transitioned.map((episode) => episode.status)).toEqual([
      'SUPERSEDED',
      'COMPLETED',
    ]);
    expect(transitioned[0].lifecycle.state).toBe('SUPERSEDED');
    assertDeepFrozen(transitioned);
  });

  it('selects by relevance, importance and recency without immediate reuse', () => {
    const episodes = engine.register(
      [],
      [
        evidence('reused', {
          category: 'SUCCESS',
          createdAtLogical: 18,
          fact: 'vitória anterior',
        }),
        evidence('fresh', {
          category: 'DIFFICULTY',
          createdAtLogical: 17,
          fact: 'dificuldade atual',
        }),
        evidence('irrelevant', {
          category: 'TRAVEL',
          createdAtLogical: 19,
          theme: 'viagem',
        }),
      ],
      20,
    );
    const first = engine.select(episodes, {
      ...selection(),
      dialogueProfile: 'ACKNOWLEDGE_ONLY',
      previouslyRecalledContinuityKeys: ['reused'],
      limit: 1,
    });
    const second = engine.select(episodes, {
      ...selection(),
      dialogueProfile: 'ACKNOWLEDGE_ONLY',
      previouslyRecalledContinuityKeys: ['reused'],
      limit: 1,
    });

    expect(first.selected[0].continuityKey).toBe('fresh');
    expect(first.suppressed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          continuityKey: 'irrelevant',
          reason: 'CONTEXT_MISMATCH',
        }),
      ]),
    );
    expect(second).toEqual(first);
    assertDeepFrozen(first);
  });

  it('requires confirmation for inference and hypothesis and respects fatigue', () => {
    const episodes = engine.register(
      [],
      [
        evidence('hypothesis', {
          nature: 'HYPOTHESIS',
          confirmation: 'UNCONFIRMED',
          recallPolicy: 'REQUIRES_CONFIRMATION',
        }),
        evidence('low-importance', { importance: 'LOW' }),
        evidence('critical', {
          category: 'ALLERGY',
          importance: 'CRITICAL',
          recallReason: 'SAFETY_RELEVANCE',
        }),
      ],
      20,
    );
    const result = engine.select(episodes, {
      ...selection(),
      fatigueScore: 90,
      relevantCategories: ['COMMITMENT', 'ALLERGY'],
    });

    expect(result.selected.map((item) => item.continuityKey)).toEqual([
      'critical',
    ]);
    expect(result.suppressed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason: 'CONFIRMATION_REQUIRED' }),
        expect.objectContaining({ reason: 'FATIGUE' }),
      ]),
    );
  });

  it('does not mutate inputs or depend on AI, persistence, text inference, clock or randomness', () => {
    const input = [evidence('immutable')];
    const before = JSON.stringify(input);
    engine.register([], input, 20);
    const source = readFileSync(
      join(__dirname, 'nutrition-conversation-episodic-memory.engine.ts'),
      'utf8',
    );

    expect(JSON.stringify(input)).toBe(before);
    expect(source).not.toMatch(
      /OpenAI|Prisma|Repository|embedding|NLP|Date\.now|new Date|Math\.random|console\.log|TODO|FIXME|\bany\b/,
    );
  });
});
