import { ConversationEntityRecognizerService } from '../understanding/conversation-entity-recognizer.service';
import { ConversationMessageNormalizerService } from '../understanding/conversation-message-normalizer.service';
import { ConversationReferenceResolverService } from '../understanding/conversation-reference-resolver.service';
import { ConversationSafetyDetectorService } from '../understanding/conversation-safety-detector.service';
import { ConversationTokenizerService } from '../understanding/conversation-tokenizer.service';
import {
  historyEntry,
  understandingInput,
} from './conversation-understanding.fixtures';

describe('Conversation Understanding deterministic pipeline components', () => {
  const normalizer = new ConversationMessageNormalizerService();
  const tokenizer = new ConversationTokenizerService();
  const references = new ConversationReferenceResolverService();
  const entities = new ConversationEntityRecognizerService();
  const safety = new ConversationSafetyDetectorService();

  function normalize(text: string) {
    return normalizer.normalize(text);
  }

  it('normalizes compatibility Unicode, accents, punctuation and whitespace', () => {
    const result = normalize('  CAFÉ\u00a0da manhã!!! 😊  ');
    expect(result).toMatchObject({
      canonical: 'café da manhã!!! 😊',
      folded: 'cafe da manha',
      hasLexicalContent: true,
    });
    expect(tokenizer.tokenize(result)).toEqual({
      tokens: ['cafe', 'da', 'manha'],
      uniqueTokens: ['cafe', 'da', 'manha'],
    });
  });

  it.each([
    ['esse plano', 'DIET', true],
    ['essa dieta', 'DIET', false],
    ['aquele plano', 'DIET', true],
    ['aquela dieta', 'DIET', false],
    ['isso', 'DIET', true],
    ['aquilo', 'DIET', true],
    ['meu plano', 'DIET', true],
  ] as const)(
    'resolves the deictic reference %s from continuity',
    (text, targetPlan, usedContinuity) => {
      const message = normalize(text);
      const result = references.resolve(
        understandingInput(text, { targetPlan }),
        message,
        tokenizer.tokenize(message),
      );
      expect(result).toMatchObject({
        usedContinuity,
        references: expect.arrayContaining([
          expect.objectContaining({
            kind: 'PLAN',
            domain: 'NUTRITION',
            resolution: 'RESOLVED',
          }),
        ]),
      });
    },
  );

  it('resolves ordinal and previous plan references explicitly', () => {
    const second = normalize('o segundo plano de treino');
    const previous = normalize('minha dieta anterior');
    expect(
      references.resolve(
        understandingInput(second.original),
        second,
        tokenizer.tokenize(second),
      ).references,
    ).toContainEqual(
      expect.objectContaining({
        target: 'ORDINAL',
        ordinal: 2,
        domain: 'WORKOUT',
      }),
    );
    expect(
      references.resolve(
        understandingInput(previous.original),
        previous,
        tokenizer.tokenize(previous),
      ).references,
    ).toContainEqual(
      expect.objectContaining({ target: 'PREVIOUS', domain: 'NUTRITION' }),
    );
  });

  it('uses recent history and profile plans only as explicit contextual evidence', () => {
    const message = normalize('isso');
    const fromHistory = references.resolve(
      understandingInput('isso', {
        recentHistory: [historyEntry('Seu plano alimentar está pronto')],
      }),
      message,
      tokenizer.tokenize(message),
    );
    const fromProfile = references.resolve(
      understandingInput('meu plano', { workoutAvailable: true }),
      normalize('meu plano'),
      tokenizer.tokenize(normalize('meu plano')),
    );
    expect(fromHistory.usedRecentHistory).toBe(true);
    expect(fromHistory.references).toContainEqual(
      expect.objectContaining({ kind: 'HISTORY_TURN', logicalTurn: 2 }),
    );
    expect(fromProfile).toMatchObject({
      usedProfile: true,
      references: expect.arrayContaining([
        expect.objectContaining({ domain: 'WORKOUT', resolution: 'RESOLVED' }),
      ]),
    });
  });

  it('keeps a deictic plan unresolved without contextual evidence', () => {
    const message = normalize('troca isso');
    expect(
      references.resolve(
        understandingInput(message.original),
        message,
        tokenizer.tokenize(message),
      ).references,
    ).toContainEqual(
      expect.objectContaining({ kind: 'PLAN', resolution: 'UNRESOLVED' }),
    );
  });

  it('recognizes meals, foods, plan components and nutrition artifacts', () => {
    const result = entities.recognize(
      normalize(
        'Troque café da manhã, almoço, jantar, lanche e ceia com whey, frango, arroz, banana e creatina na dieta semanal',
      ),
    );
    for (const name of [
      'café da manhã',
      'almoço',
      'jantar',
      'lanche',
      'ceia',
    ]) {
      expect(result.entities).toContainEqual(
        expect.objectContaining({ kind: 'MEAL', name }),
      );
    }
    for (const name of ['whey', 'frango', 'arroz', 'banana', 'creatina']) {
      expect(result.entities).toContainEqual(
        expect.objectContaining({ kind: 'FOOD', name }),
      );
    }
    expect(result.entities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'NUTRITION_ARTIFACT',
          value: 'WEEKLY_PLAN',
        }),
        expect.objectContaining({
          kind: 'NUTRITION_ARTIFACT',
          value: 'FOOD_SUBSTITUTION',
        }),
      ]),
    );
  });

  it.each([
    ['corrida', 'RUNNING'],
    ['bike', 'CYCLING'],
    ['crossfit', 'CROSSFIT'],
    ['musculação', 'GYM_STRENGTH'],
    ['caminhada', 'WALKING'],
    ['calistenia', 'CALISTHENICS'],
    ['mobilidade', 'MOBILITY'],
  ] as const)('recognizes workout modality %s', (text, value) => {
    expect(entities.recognize(normalize(text)).entities).toContainEqual({
      kind: 'WORKOUT_MODALITY',
      value,
    });
  });

  it('recognizes daily nutrition and exercise-substitution artifacts', () => {
    expect(
      entities.recognize(normalize('plano diário de dieta')).entities,
    ).toContainEqual({
      kind: 'NUTRITION_ARTIFACT',
      value: 'DAILY_STRUCTURE',
    });
    expect(
      entities.recognize(normalize('substitua um exercício do treino'))
        .entities,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'WORKOUT_ARTIFACT',
          value: 'EXERCISE_SUBSTITUTION',
        }),
        expect.objectContaining({
          kind: 'PLAN_COMPONENT',
          component: 'EXERCISE',
        }),
      ]),
    );
  });

  it('does not create duplicate entities', () => {
    const result = entities.recognize(normalize('corrida corrida corrida'));
    expect(
      result.entities.filter((entity) => entity.kind === 'WORKOUT_MODALITY'),
    ).toHaveLength(1);
  });

  it('does not mark common messages as unsafe', () => {
    expect(safety.detect(normalize('obrigado pela ajuda'))).toMatchObject({
      safety: {
        signals: [],
        requiresSafeResponse: false,
        requiresProfessionalGuidance: false,
      },
      entities: [],
    });
  });
});
