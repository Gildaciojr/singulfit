import {
  nutritionRequest,
  selfContainedNutritionRequest,
} from '../understanding/nutrition-request.policy';
import { isDailyMealRequest } from '../understanding/daily-query.policy';
import { explicitContinuationDomain } from '../understanding/explicit-continuation-domain.policy';

describe('nutrition meal request semantics', () => {
  it.each(['o que eu como agora?', 'tô com fome agora, o que faço?'])(
    'recognizes immediate food guidance without a plan effect: %s',
    (text) => {
      expect(nutritionRequest(text)?.intent).toBe('NUTRITION_ADVICE');
      expect(selfContainedNutritionRequest(text)).not.toBeNull();
      expect(isDailyMealRequest(text)).toBe(false);
    },
  );
  it.each([
    'como agora eu configuro meu aplicativo?',
    'como agora eu vejo meu histórico?',
    'Como você acha que estou indo agora?',
  ])('does not interpret general adverbial como as eating: %s', (text) => {
    expect(nutritionRequest(text)).toBeNull();
    expect(selfContainedNutritionRequest(text)).toBeNull();
  });
  it.each([
    'me dá uma dica de janta',
    'me de uma dica pra jantar',
    'manda uma ideia de janta hoje',
    'o que eu como hoje a noite?',
    'tem algo bom pra comer?',
    'tô com fome, o que faço?',
    'manda um lanche',
    'me dá uma dica de lanche',
    'um lanche pra tarde',
    'o que eu como antes do treino?',
    'que posso comer depois da academia?',
    'e pro café da manhã?',
    'qual rango de hoje?',
    'me dá uma ideia de comida',
    'me dá uma dica de janta 😋!!',
  ])('macro P0 recognizes everyday read-only food requests: %s', (text) => {
    expect(nutritionRequest(text)?.intent).toBe('NUTRITION_ADVICE');
    expect(selfContainedNutritionRequest(text)).not.toBeNull();
  });
  it.each([
    ['O que posso comer no lugar do frango no almoço?', 'OFF_PLAN_ADVICE'],
    ['Não tenho frango, o que uso no lugar?', 'OFF_PLAN_ADVICE'],
    ['Posso comer ovo no lugar do frango no almoço?', 'PLAN_INQUIRY'],
    [
      'Posso substituir frango por ovos? Isso está previsto na minha dieta?',
      'PLAN_INQUIRY',
    ],
  ] as const)(
    'distinguishes recommendation from a plan decision: %s',
    (text, substitutionPurpose) => {
      expect(nutritionRequest(text)).toMatchObject({
        intent: 'MEAL_SUBSTITUTION',
        substitutionPurpose,
      });
    },
  );
  it.each([
    'Me dê uma dica alternativa de jantar para hoje?',
    'Sugira uma alternativa para o almoço',
    'Quero outra opção de jantar',
    'Uma ideia diferente para comer à noite?',
  ])(
    'keeps independent alternatives out of registered substitution queries: %s',
    (text) => {
      expect(nutritionRequest(text)?.intent).toBe('NUTRITION_ADVICE');
      expect(selfContainedNutritionRequest(text)).not.toBeNull();
    },
  );

  it.each([
    'Me dê uma dica para lanche da tarde',
    'Me dá uma dica de lanche da tarde',
    'Quero uma dica para o lanche da tarde',
    'Quero que você me dê uma dica para um lanche da tarde',
    'Me sugira um lanche da tarde',
    'O que você sugere para o lanche da tarde?',
    'Alguma ideia pro lanche da tarde?',
    'Tem alguma opção para meu lanche da tarde?',
    'Queria algo diferente para o lanche da tarde',
    'O que posso comer à tarde?',
    'Me dá uma opção rápida e proteica para a tarde',
    'Quero algo barato para comer à tarde',
    'Preciso de algo sem lactose para o lanche',
    'Me da uma opcao rapida e proteica para a tarde',
    'Me sugira uma opcao pratica para comer de manha',
    'Quero opcoes rapidas e proteicas para comer a noite',
  ])('recognizes autonomous read-only nutrition request: %s', (text) => {
    expect(selfContainedNutritionRequest(text)).not.toBeNull();
    expect(explicitContinuationDomain(text)).toBe('NUTRITION');
  });

  it.each([
    'Outra opção',
    'Me dá outra opção sem lactose',
    'Me dá outra',
    'E esse?',
    'Isso',
    'Troca esse',
    'O segundo',
    'E aquele?',
    'Pode substituir isso?',
    'Me dê uma dica para esse lanche',
    'Quero trocar esse jantar',
    'Troque permanentemente meu lanche por uma fruta',
    'Qual meu lanche da tarde?',
    'Minha reunião é à tarde',
    'quero algo rápido',
    'pode ser coisa barata?',
    'sem leite, por favor',
    'tenho alergia a amendoim',
    'monta uma dieta nova pra mim',
  ])('does not bypass reference, mutation or other intent: %s', (text) => {
    expect(selfContainedNutritionRequest(text)).toBeNull();
  });

  it.each([
    ['Qual meu lanche da tarde?', 'PLAN_LOOKUP', []],
    ['O que está no meu jantar?', 'PLAN_LOOKUP', []],
    ['Qual minha próxima refeição?', 'PLAN_LOOKUP', []],
    ['Me dê uma dica para lanche da tarde', 'NUTRITION_ADVICE', []],
    ['O que posso comer à tarde?', 'NUTRITION_ADVICE', []],
    [
      'Me dá uma opção rápida e proteica para a tarde',
      'CONSTRAINED_RECOMMENDATION',
      ['QUICK', 'HIGH_PROTEIN'],
    ],
    [
      'Quero um lanche rápido antes do treino',
      'CONSTRAINED_RECOMMENDATION',
      ['QUICK'],
    ],
    [
      'Me dê uma dica para lanche da tarde no meu plano',
      'NUTRITION_ADVICE',
      [],
    ],
    ['Quero uma dica para minha dieta', 'NUTRITION_ADVICE', []],
    ['O que seria bom eu comer à tarde?', 'NUTRITION_ADVICE', []],
    ['Me sugira um café da manhã', 'NUTRITION_ADVICE', []],
    ['Me sugira algo diferente para comer agora', 'NUTRITION_ADVICE', []],
    [
      'O que posso comer no lugar do meu lanche da tarde?',
      'MEAL_SUBSTITUTION',
      [],
    ],
    ['Não tenho frango, o que uso no lugar?', 'MEAL_SUBSTITUTION', []],
    ['Quero trocar esse jantar', 'MEAL_SUBSTITUTION', []],
    [
      'Quero um lanche rápido e proteico',
      'CONSTRAINED_RECOMMENDATION',
      ['QUICK', 'HIGH_PROTEIN'],
    ],
    [
      'Quero uma opção leve para agora',
      'CONSTRAINED_RECOMMENDATION',
      ['LIGHT'],
    ],
    ['Me sugira algo sem lactose', 'CONSTRAINED_RECOMMENDATION', ['LACTOSE']],
    ['Me sugira algo vegano', 'CONSTRAINED_RECOMMENDATION', ['VEGAN']],
    [
      'Quero um lanche barato para levar ao trabalho',
      'CONSTRAINED_RECOMMENDATION',
      ['LOW_COST', 'PORTABLE'],
    ],
  ] as const)(
    'classifies %s without borrowing a pending domain',
    (text, intent, constraints) => {
      expect(nutritionRequest(text)).toMatchObject({ intent, constraints });
      expect(explicitContinuationDomain(text)).toBe('NUTRITION');
      if (intent !== 'PLAN_LOOKUP')
        expect(isDailyMealRequest(text)).toBe(false);
    },
  );

  it.each([
    'e depois?',
    'Quero um treino',
    'Quero um treino e uma dieta',
    'Quero uma dieta',
    'Troque o frango do almoço por peixe',
    'Quero trocar esse jantar no meu plano daqui para frente',
  ])(
    'leaves existing continuation or persistent planning intact: %s',
    (text) => {
      expect(nutritionRequest(text)).toBeNull();
    },
  );
});
