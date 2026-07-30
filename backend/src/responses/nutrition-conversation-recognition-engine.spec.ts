import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NutritionConversationRecognitionEngine } from './nutrition-conversation-recognition-engine';
import type { NutritionRecognitionEngineInput } from './nutrition-conversation-recognition-engine';

const base: NutritionRecognitionEngineInput = Object.freeze({
  positiveFactors: Object.freeze([]),
  recentMealCount: 0,
  currentQualityScore: null,
  recentQualityScores: Object.freeze([]),
  relapsePresent: false,
  returnAfterAbsence: false,
  activeDays: 0,
  consecutiveDays: 0,
  consistencyScore: 0,
  adherenceScore: 0,
  momentumScore: 0,
});

function assertDeepFrozen(value: unknown): void {
  if (typeof value !== 'object' || value === null) return;
  expect(Object.isFrozen(value)).toBe(true);
  Object.values(value).forEach(assertDeepFrozen);
}

describe('NutritionConversationRecognitionEngine', () => {
  const engine = new NutritionConversationRecognitionEngine();

  it('does not invent recognition without evidence', () => {
    expect(engine.recognize(base).signals).toEqual([]);
  });

  it('distinguishes effort, consistency and discipline from results', () => {
    const result = engine.recognize({
      ...base,
      positiveFactors: ['proteína presente'],
      consecutiveDays: 7,
      consistencyScore: 80,
    });
    expect(result.signals.map((signal) => signal.kind)).toEqual([
      'EFFORT',
      'CONSISTENCY',
      'DISCIPLINE',
      'GOOD_DECISION',
    ]);
  });

  it('recognizes small and big wins only from comparative evidence', () => {
    const result = engine.recognize({
      ...base,
      positiveFactors: ['mais vegetais'],
      recentMealCount: 2,
      currentQualityScore: 80,
      recentQualityScores: [65, 68],
      trendDirection: 'IMPROVING',
      longitudinalDirection: 'IMPROVING',
      consistencyScore: 80,
    });
    expect(result.signals.map((signal) => signal.kind)).toEqual(
      expect.arrayContaining(['SMALL_WIN', 'IMPROVEMENT', 'BIG_WIN']),
    );
  });

  it('recognizes recovery before other positive signals', () => {
    const result = engine.recognize({
      ...base,
      relapsePresent: true,
      longitudinalDirection: 'IMPROVING',
    });
    expect(result.signals[0].kind).toBe('RECOVERY');
  });

  it('recognizes a return after absence without claiming a nutritional result', () => {
    const result = engine.recognize({ ...base, returnAfterAbsence: true });
    expect(result.signals).toEqual([
      expect.objectContaining({
        kind: 'RECOVERY',
        origin: 'COACH',
        evidence: ['o registro foi retomado após um período de afastamento'],
      }),
    ]);
  });

  it('represents recurrence, plateau and strategies without moralization', () => {
    const recurrence = engine.recognize({
      ...base,
      relapsePresent: true,
      trendDirection: 'DECLINING',
      strategyWorked: 'organizar o almoço antecipadamente funcionou',
      strategyFailed: 'pular o lanche deixou de funcionar',
    });
    expect(recurrence.signals.map((signal) => signal.kind)).toEqual(
      expect.arrayContaining(['RECURRENCE', 'GOOD_STRATEGY', 'BAD_STRATEGY']),
    );
    expect(
      engine
        .recognize({ ...base, recentMealCount: 3, trendDirection: 'STABLE' })
        .signals.map((signal) => signal.kind),
    ).toContain('PLATEAU');
  });

  it('is deterministic, deeply frozen and does not mutate input', () => {
    const input = { ...base, positiveFactors: ['mais proteína'] };
    const snapshot = JSON.stringify(input);
    const first = engine.recognize(input);
    expect(engine.recognize(input)).toEqual(first);
    expect(JSON.stringify(input)).toBe(snapshot);
    assertDeepFrozen(first);
  });

  it('remains pure and isolated from database and OpenAI', () => {
    const source = readFileSync(
      join(__dirname, 'nutrition-conversation-recognition-engine.ts'),
      'utf8',
    );
    expect(source).not.toMatch(
      /Prisma|OpenAI|ConversationAI|Repository|Service|Date\.now|Math\.random|console\.log|\bany\b/,
    );
  });
});
