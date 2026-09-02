import { isNutritionCurrentPlanRead } from './nutrition-current-plan-read.policy';

describe('isNutritionCurrentPlanRead', () => {
  it.each([
    'qual é minha dieta?',
    'me mostre meu plano alimentar',
    'qual minha dieta atual?',
    'quero ver minha dieta',
    'o que tem na minha dieta?',
    'mande meu plano alimentar',
    'qual foi a dieta que você montou para mim?',
    'minha dieta',
  ])('recognizes the current Nutrition plan read: %s', (message) => {
    expect(isNutritionCurrentPlanRead(message)).toBe(true);
  });

  it.each([
    'quero uma dieta',
    'monte meu plano alimentar',
    'crie uma nova dieta',
    'quero adaptar minha dieta',
    'troque o arroz da minha dieta',
    'não gostei da minha dieta',
    'qual é meu treino?',
  ])(
    'does not reclassify generation, mutation or another domain: %s',
    (message) => {
      expect(isNutritionCurrentPlanRead(message)).toBe(false);
    },
  );
});
