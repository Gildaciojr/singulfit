import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NutritionConversationEmotionalEngine } from './nutrition-conversation-emotional-engine';
import type { NutritionEmotionalEngineInput } from './nutrition-conversation-emotional-engine';
import type { NutritionRecognitionSignal } from './nutrition-conversation-recognition.contract';

const base: NutritionEmotionalEngineInput = Object.freeze({
  recognitionSignals: Object.freeze([]),
  identifiedFoodCount: 1,
  requiresEstimateQualification: true,
  recommendationCount: 0,
  coachFatigueScore: 0,
  adherenceScore: 50,
  engagementScore: 50,
  behavioralInsights: Object.freeze([]),
});

function recognition(
  kind: NutritionRecognitionSignal['kind'],
  evidence = `evidência objetiva de ${kind}`,
  origin: NutritionRecognitionSignal['origin'] = 'LONGITUDINAL',
): NutritionRecognitionSignal {
  return Object.freeze({
    kind,
    origin,
    confidence: 'HIGH',
    evidence: Object.freeze([evidence]),
  });
}

function kinds(input: NutritionEmotionalEngineInput) {
  return new NutritionConversationEmotionalEngine()
    .recognize(input)
    .signals.map((signal) => signal.kind);
}

function assertDeepFrozen(value: unknown): void {
  if (typeof value !== 'object' || value === null) return;
  expect(Object.isFrozen(value)).toBe(true);
  Object.values(value).forEach(assertDeepFrozen);
}

describe('NutritionConversationEmotionalEngine', () => {
  const engine = new NutritionConversationEmotionalEngine();

  it('recognizes frustration only from objective setback evidence', () => {
    expect(
      kinds({
        ...base,
        recognitionSignals: [recognition('BAD_STRATEGY')],
      }),
    ).toContain('FRUSTRATION');
    expect(kinds(base)).not.toContain('FRUSTRATION');
  });

  it('recognizes confidence from consistency, recovery, wins or adherence', () => {
    expect(
      kinds({
        ...base,
        recognitionSignals: [recognition('CONSISTENCY')],
      }),
    ).toContain('CONFIDENCE');
  });

  it('recognizes overwhelm only from fatigue, low execution and accumulated guidance', () => {
    expect(
      kinds({
        ...base,
        coachFatigueScore: 80,
        adherenceScore: 30,
        recommendationCount: 3,
      }),
    ).toContain('OVERWHELM');
    expect(
      kinds({ ...base, coachFatigueScore: 80, adherenceScore: 30 }),
    ).not.toContain('OVERWHELM');
  });

  it('recognizes uncertainty from low nutrition confidence or unidentified food', () => {
    expect(kinds({ ...base, nutritionConfidence: 0.45 })).toContain(
      'UNCERTAINTY',
    );
    expect(kinds({ ...base, identifiedFoodCount: 0 })).toContain('UNCERTAINTY');
  });

  it('recognizes motivation only from behavior', () => {
    const result = engine.recognize({
      ...base,
      adherenceScore: 75,
      engagementScore: 70,
    });
    expect(result.signals).toContainEqual(
      expect.objectContaining({ kind: 'MOTIVATION', origin: 'BEHAVIOR' }),
    );
  });

  it('recognizes satisfaction only from consolidated positive results', () => {
    expect(
      kinds({
        ...base,
        recognitionSignals: [recognition('BIG_WIN')],
      }),
    ).toContain('SATISFACTION');
    expect(
      kinds({
        ...base,
        recognitionSignals: [recognition('SMALL_WIN')],
      }),
    ).not.toContain('SATISFACTION');
  });

  it('recognizes reengagement only from a coach recovery signal', () => {
    expect(
      kinds({
        ...base,
        recognitionSignals: [
          recognition('RECOVERY', 'retorno após ausência', 'COACH'),
        ],
      }),
    ).toContain('REENGAGEMENT');
    expect(
      kinds({
        ...base,
        recognitionSignals: [recognition('RECOVERY')],
      }),
    ).not.toContain('REENGAGEMENT');
  });

  it('recognizes fatigue from the existing coach fatigue signal', () => {
    expect(kinds({ ...base, coachFatigueScore: 70 })).toContain('FATIGUE');
  });

  it('recognizes resistance without moralization only from recurrence and low execution', () => {
    const result = engine.recognize({
      ...base,
      adherenceScore: 30,
      recognitionSignals: [recognition('RECURRENCE')],
    });
    expect(result.signals).toContainEqual(
      expect.objectContaining({ kind: 'RESISTANCE', origin: 'LONGITUDINAL' }),
    );
    expect(JSON.stringify(result)).not.toMatch(/culpa|falhou|preguiça/iu);
  });

  it('recognizes curiosity only from the existing data-responsive insight', () => {
    expect(
      kinds({ ...base, behavioralInsights: ['DATA_RESPONSIVE'] }),
    ).toContain('CURIOSITY');
    expect(kinds(base)).not.toContain('CURIOSITY');
  });

  it('is deterministic, deeply frozen and does not mutate input', () => {
    const input = {
      ...base,
      recognitionSignals: [recognition('BAD_STRATEGY')],
    };
    const snapshot = JSON.stringify(input);
    const first = engine.recognize(input);
    expect(engine.recognize(input)).toEqual(first);
    expect(JSON.stringify(input)).toBe(snapshot);
    assertDeepFrozen(first);
  });

  it('remains pure and isolated from database, OpenAI and free-text NLP', () => {
    const source = readFileSync(
      join(__dirname, 'nutrition-conversation-emotional-engine.ts'),
      'utf8',
    );
    expect(source).not.toMatch(
      /Prisma|OpenAI|ConversationAI|Repository|Service|embedding|fetch\(|Date\.now|Math\.random|console\.log|\bany\b/,
    );
    expect(source).not.toMatch(/message|content|tokenize|sentiment/iu);
  });
});
