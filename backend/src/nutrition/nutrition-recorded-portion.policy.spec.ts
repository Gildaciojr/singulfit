import { recordedPortion } from './nutrition-recorded-portion.policy';
describe('Recorded nutritional portions', () => {
  const foods = [
    {
      foodName: 'Arroz cozido',
      quantity: '100 g',
      calories: 130,
      protein: 3,
      carbs: 28,
      fat: 1,
    },
  ];
  it('scales existing numeric evidence without inventing a serving or confidence', () => {
    expect(
      recordedPortion(foods, {
        foodQuote: 'arroz cozido',
        quantityQuote: '50 g',
      }),
    ).toMatchObject({ calories: 65, protein: 1.5, carbs: 14, fat: 0.5 });
  });
  it.each(['uma concha', '50 ml', '50 g por exemplo', '0 g'])(
    'cannot convert an unknown or incompatible portion %s',
    (quantityQuote) => {
      expect(
        recordedPortion(foods, { foodQuote: 'Arroz cozido', quantityQuote }),
      ).toBeNull();
    },
  );
  it('does not infer a food equivalence or choose between conflicting sources', () => {
    expect(
      recordedPortion(foods, { foodQuote: 'arroz cru', quantityQuote: '50 g' }),
    ).toBeNull();
    expect(
      recordedPortion([...foods, ...foods], {
        foodQuote: 'Arroz cozido',
        quantityQuote: '50 g',
      }),
    ).toBeNull();
  });
});
