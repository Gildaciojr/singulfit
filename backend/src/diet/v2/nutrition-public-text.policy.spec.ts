import {
  classifyNutritionPublicNote,
  isNutritionMetaText,
} from './nutrition-public-text.policy';

describe('Nutrition public text policy', () => {
  it.each([
    'conforme exclusão definida',
    'conforme exclusões definidas',
    'conforme exclusões cadastradas',
    'conforme restrição definida',
    'conforme restrições definidas',
    'conforme cadastro',
    'conforme seu cadastro',
    'contexto não informa',
    'contexto disponível',
    'conforme contexto',
    'excluded foods',
    'applied constraints',
    'strategy',
    'profile field',
    'alvo energético estimado',
    'macros estimados',
    'Como o contexto não informa preferências adicionais...',
    'Evitar tomate conforme exclusão definida.',
    'Evitar tomate conforme exclusões definidas.',
    'CONFORME AS EXCLUSÕES CADASTRADAS',
    'excluded_foods',
    'applied-constraints',
  ])('detects internal commentary: %s', (line) => {
    expect(isNutritionMetaText(line)).toBe(true);
  });

  it.each([
    'Ajuste a hidratação conforme sua sede e rotina.',
    'Organizei os horários conforme sua rotina.',
    'Beba água conforme sua sede.',
    'Organizei conforme seus horários.',
    'Escolha alimentos conforme a restrição médica já orientada.',
  ])('allows ordinary public guidance: %s', (line) => {
    expect(isNutritionMetaText(line)).toBe(false);
  });

  it('does not infer allergy from excluded foods or from a model-authored safety claim', () => {
    expect(
      classifyNutritionPublicNote(
        'Você informou alergia a tomate; evite exposição.',
        {
          excludedFoods: ['tomate'],
          appliedConstraintCodes: [],
        },
      ),
    ).toBe('COMMON_REJECTION');
  });

  it('does not let an unrelated real constraint promote a common rejection', () => {
    expect(
      classifyNutritionPublicNote('Evite tomate.', {
        excludedFoods: ['tomate'],
        appliedConstraintCodes: ['PEANUT'],
      }),
    ).toBe('COMMON_REJECTION');
  });

  it('uses the supported allergy constraint to preserve a necessary food warning', () => {
    expect(
      classifyNutritionPublicNote(
        'Você informou alergia a amendoim; confira rótulos para evitar exposição.',
        {
          excludedFoods: ['amendoim'],
          appliedConstraintCodes: ['PEANUT'],
        },
      ),
    ).toBe('SAFETY_RELEVANT');
  });

  it('uses a real lactose constraint to preserve a necessary intolerance warning', () => {
    expect(
      classifyNutritionPublicNote(
        'Evite leite por sua intolerância à lactose.',
        {
          excludedFoods: ['leite'],
          appliedConstraintCodes: ['LACTOSE'],
        },
      ),
    ).toBe('SAFETY_RELEVANT');
  });
});
