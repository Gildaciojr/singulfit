import { materiallyRepeatsNutritionAdvice } from '../runtime/nutrition-advice.policy';

describe('Nutrition material signature', () => {
  it.each([
    ['sopa de lentilhas com legumes', 'legumes com sopa de lentilha', true],
    [
      'Uma ideia de jantar é sopa de lentilhas com legumes.',
      'Para jantar, prepare uma deliciosa sopa de lentilhas e legumes.',
      true,
    ],
    [
      'arroz + frango + abobrinha',
      'frango grelhado com arroz e abobrinha',
      true,
    ],
    ['ARROZ, FRANGO e abobrinha', 'Abobrinha, frango e arroz.', true],
    ['arroz + frango + abobrinha', 'batata assada + peixe + salada', false],
    ['arroz + frango + abobrinha', 'arroz + peixe + salada', false],
    ['iogurte', 'iogurte', false],
  ])('compares %s versus %s', (previous, candidate, repeat) => {
    expect(materiallyRepeatsNutritionAdvice(previous, candidate)).toBe(repeat);
  });
});
