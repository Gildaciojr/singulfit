import { nutritionRequest } from '../understanding/nutrition-request.policy';
import { isDailyMealRequest } from '../understanding/daily-query.policy';
import { explicitContinuationDomain } from '../understanding/explicit-continuation-domain.policy';

describe('nutrition meal request semantics', () => {
  it.each([
    ['Qual meu lanche da tarde?', 'PLAN_LOOKUP', []],
    ['O que está no meu jantar?', 'PLAN_LOOKUP', []],
    ['Qual minha próxima refeição?', 'PLAN_LOOKUP', []],
    ['Me dê uma dica para lanche da tarde', 'NUTRITION_ADVICE', []],
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
