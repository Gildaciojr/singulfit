import { ConversationLanguageRealizerService } from '../runtime/conversation-language-realizer.service';
import { ConversationResponseFormatterService } from '../runtime/conversation-response-formatter.service';
import { ConversationResponseValidatorService } from '../runtime/conversation-response-validator.service';
import type { ConversationResponsePayload } from '../runtime/conversation-response-payload.builder';

describe('Conversation response pipeline', () => {
  const realizer = new ConversationLanguageRealizerService();
  const formatter = new ConversationResponseFormatterService();
  const validator = new ConversationResponseValidatorService();

  function contextual(
    overrides: Partial<
      Extract<ConversationResponsePayload, { kind: 'CONTEXTUAL_RESPONSE' }>
    > = {},
  ): Extract<ConversationResponsePayload, { kind: 'CONTEXTUAL_RESPONSE' }> {
    return {
      kind: 'CONTEXTUAL_RESPONSE',
      routeKind: 'ANSWER_MESSAGE',
      cue: 'COMMON',
      currentMessage: '',
      preferredName: null,
      goal: null,
      desiredOutcome: null,
      continuity: null,
      trainingTime: null,
      mealTimes: [],
      cookingAvailability: null,
      mealsAwayFromHome: null,
      trainingModality: null,
      trainingExperience: null,
      dietaryPattern: null,
      preferredFoods: [],
      rejectedFoods: [],
      restrictions: [],
      communicationStyle: null,
      motivation: null,
      messagePreference: 'BALANCED',
      journeyStage: null,
      memories: [],
      progress: null,
      currentDiet: null,
      currentWorkout: null,
      ...overrides,
    };
  }

  it('uses human context naturally for a greeting without repeating the name', () => {
    const result = realizer.realize(
      contextual({
        cue: 'GREETING',
        preferredName: 'Gil',
        goal: 'ganho de massa muscular',
        trainingTime: 'depois do trabalho',
      }),
    );

    expect(result.message).toBe('Oi, Gil! Que bom falar com você.');
    expect(result.followUpQuestion).toContain('ganho de massa muscular');
    expect(
      `${result.message} ${result.followUpQuestion}`.match(/Gil/gu),
    ).toHaveLength(1);
  });

  it('uses continuity only when persisted context is supplied', () => {
    const withMemory = realizer.realize(
      contextual({
        cue: 'CONTINUITY',
        continuity: 'quero ajustar o lanche antes do treino',
      }),
    );
    const withoutMemory = realizer.realize(
      contextual({
        cue: 'CONTINUITY',
      }),
    );

    expect(withMemory.message).toContain('quero ajustar o lanche');
    expect(withoutMemory.message).not.toContain('você comentou');
  });

  it('responds to adherence difficulty with persisted human context', () => {
    const result = realizer.realize(
      contextual({
        currentMessage: 'Hoje foi difícil seguir a dieta',
        preferredName: 'Gil',
        preferredFoods: ['arroz e feijão'],
        progress: 'as escolhas alimentares recentes estão evoluindo',
      }),
    );

    expect(result.message).toContain('Gil');
    expect(result.message).toContain('arroz e feijão');
    expect(result.message).toContain('estão evoluindo');
    expect(result.message).not.toMatch(/Escolha uma opção|\b[123]\./u);
  });

  it('uses motivation and progress to change a low-motivation response', () => {
    const base = contextual({
      currentMessage: 'Estou desanimado',
      currentWorkout: 'Treino A',
    });
    const resultDriven = realizer.realize({
      ...base,
      motivation: 'foco em progresso e resultados',
    });
    const autonomyDriven = realizer.realize({
      ...base,
      motivation: 'autonomia',
    });

    expect(resultDriven.message).not.toBe(autonomyDriven.message);
    expect(resultDriven.message).not.toMatch(/\b[123]\./u);
  });

  it('answers a pizza question conversationally without a numbered menu', () => {
    const result = realizer.realize(
      contextual({
        routeKind: 'NUTRITION_GUIDANCE',
        currentMessage: 'Posso comer pizza hoje?',
        goal: 'emagrecimento',
      }),
    );

    expect(result.message).toContain('Pode comer');
    expect(result.message).toContain('emagrecimento');
    expect(result.message).not.toMatch(/Escolha uma opção|\b[123]\./u);
  });

  it.each([
    ['DIET', 'plano alimentar'],
    ['WORKOUT', 'treino'],
    ['BOTH', 'plano alimentar e do treino'],
    [null, 'alimentação, treino ou dos dois'],
  ] as const)(
    'realizes one contextual confirmation for %s',
    (targetPlan, expected) => {
      const result = realizer.realize({
        kind: 'CONFIRMATION_REQUEST',
        targetPlan,
      });

      expect(result.requiresFollowUp).toBe(true);
      expect(result.followUpQuestion).toContain(expected);
      expect(validator.isValid(result)).toBe(true);
      expect(formatter.format(result).match(/\?/g)).toHaveLength(1);
    },
  );

  it.each([
    ['CAUTION_GUIDANCE', 'observe os sintomas'],
    ['PROFESSIONAL_GUIDANCE', 'profissional de saúde'],
    ['URGENT_GUIDANCE', 'serviço de urgência'],
  ] as const)(
    'realizes safe non-clinical guidance for %s',
    (action, expected) => {
      const result = realizer.realize({ kind: 'SAFETY_GUIDANCE', action });

      expect(result.message).toContain(expected);
      expect(result.requiresFollowUp).toBe(false);
      expect(validator.isValid(result)).toBe(true);
    },
  );

  it.each([
    { message: '', requiresFollowUp: false, followUpQuestion: null },
    {
      message: 'x'.repeat(4_001),
      requiresFollowUp: false,
      followUpQuestion: null,
    },
    { message: 'Mensagem', requiresFollowUp: true, followUpQuestion: null },
    { message: 'Uma? Duas?', requiresFollowUp: false, followUpQuestion: null },
    {
      message: '{"message":"visível"}',
      requiresFollowUp: false,
      followUpQuestion: null,
    },
    {
      message: 'Este é um diagnóstico.',
      requiresFollowUp: false,
      followUpQuestion: null,
    },
    {
      message: 'Salvei seu plano.',
      requiresFollowUp: false,
      followUpQuestion: null,
    },
  ] as const)('rejects an invalid realized response: %o', (response) => {
    expect(validator.isValid(response)).toBe(false);
  });
});
