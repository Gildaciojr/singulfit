import {
  nutritionCompositionViolation,
  parseNutritionComposition,
  repeatedNutritionComposition,
  type NutritionAdviceComposition,
} from '../runtime/nutrition-advice-variety.policy';
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

const initialDinner =
  'Uma boa alternativa é arroz branco com peito de frango grelhado e abobrinha refogada. Outra alternativa é macarrão com bife bovino grelhado.';
const repeatedDinner =
  'Uma outra opção é arroz branco com peito de frango grelhado e alface e pepino. Também arroz branco com carne bovina e abobrinha.';
const option = (
  quote: string,
  mainIngredients: string[],
  mainProtein: string | null,
  accompaniments: string[] = [],
  preparation: string | null = null,
) => ({ quote, mainIngredients, mainProtein, accompaniments, preparation });
describe('Semantic meal composition in the existing generation', () => {
  const previous = [
    option(
      initialDinner,
      ['arroz branco', 'peito de frango'],
      'peito de frango',
      ['abobrinha'],
    ),
    option(initialDinner, ['macarrão', 'bife bovino'], 'bife bovino'),
  ];
  it('consolidated P0 rejects the real central dinner pair despite changed sides/prose', () => {
    const composition: NutritionAdviceComposition = {
      previous,
      current: [
        option(
          repeatedDinner,
          ['arroz branco', 'peito de frango'],
          'peito de frango',
          ['alface', 'pepino'],
        ),
      ],
    };
    expect(parseNutritionComposition(composition)).toEqual(composition);
    expect(
      nutritionCompositionViolation(
        composition,
        repeatedDinner,
        [initialDinner],
        true,
      ),
    ).toBe('NUTRITION_ADVICE_REPEATS_PREVIOUS_SUGGESTION');
  });
  it('compares every earlier alternative, not only the latest paragraph', () => {
    expect(
      repeatedNutritionComposition({
        previous,
        current: [
          option(
            'Macarrão e bife bovino com salada',
            ['macarrão', 'bife bovino'],
            'bife bovino',
            ['salada'],
          ),
        ],
      }),
    ).toBe(true);
  });
  it('rejects a repeated option omitted from the model reconstruction of history', () => {
    expect(
      nutritionCompositionViolation(
        {
          previous: previous.slice(1),
          current: [
            option(
              repeatedDinner,
              ['arroz branco', 'peito de frango'],
              'peito de frango',
            ),
          ],
        },
        repeatedDinner,
        [initialDinner],
        true,
      ),
    ).toBe('NUTRITION_ADVICE_REPEATS_PREVIOUS_SUGGESTION');
  });
  it('permits a genuinely new main combination and shared side ingredients', () => {
    const quote = 'Batata assada com peixe e abobrinha';
    expect(
      nutritionCompositionViolation(
        {
          previous,
          current: [
            option(
              quote,
              ['batata', 'peixe'],
              'peixe',
              ['abobrinha'],
              'assada',
            ),
          ],
        },
        quote,
        [initialDinner],
        true,
      ),
    ).toBeNull();
  });
  it('rejects a repeated public option omitted from both model compositions', () => {
    const quote = 'Batata assada com peixe';
    expect(
      nutritionCompositionViolation(
        {
          previous: previous.slice(1),
          current: [option(quote, ['batata', 'peixe'], 'peixe')],
        },
        `${quote}. Outra opção é arroz branco com peito de frango e salada.`,
        [initialDinner],
        true,
        previous,
      ),
    ).toBe('NUTRITION_ADVICE_COMPOSITION_UNSUPPORTED');
  });
  it('allows shared ingredients as declared sides of a materially different main composition', () => {
    const quote = 'Batata assada com peixe, acompanhada de arroz branco';
    expect(
      nutritionCompositionViolation(
        {
          previous: previous.slice(1),
          current: [
            option(quote, ['batata', 'peixe'], 'peixe', ['arroz branco']),
          ],
        },
        quote,
        [initialDinner],
        true,
        previous,
      ),
    ).toBeNull();
  });
  it('compares grounded ingredient mentions with whole-word plural equivalence', () => {
    expect(
      repeatedNutritionComposition({
        previous,
        current: [
          option(
            'Arroz branco com frango',
            ['arroz branco', 'frango'],
            'frango',
          ),
        ],
      }),
    ).toBe(true);
    expect(
      parseNutritionComposition({
        previous: [],
        current: [option('Uma nova opção', ['ovo'], 'ovo')],
      }),
    ).toBeNull();
  });
  it('cannot hide a repeated ingredient outside the reported current composition', () => {
    const quote = 'Batata com peixe';
    expect(
      nutritionCompositionViolation(
        { previous, current: [option(quote, ['batata', 'peixe'], 'peixe')] },
        `${quote}. Outra opção é arroz branco com peito de frango.`,
        [initialDinner],
        true,
      ),
    ).toBe('NUTRITION_ADVICE_COMPOSITION_UNSUPPORTED');
  });
  it('does not accept invented quotes or unreported ingredient metadata', () => {
    expect(
      parseNutritionComposition({
        previous: [],
        current: [option(repeatedDinner, ['lentilhas'], 'lentilhas')],
      }),
    ).toBeNull();
    expect(
      nutritionCompositionViolation(
        {
          previous,
          current: [option('Batata com peixe', ['batata', 'peixe'], 'peixe')],
        },
        repeatedDinner,
        [initialDinner],
        true,
      ),
    ).toBe('NUTRITION_ADVICE_COMPOSITION_UNSUPPORTED');
  });
});
