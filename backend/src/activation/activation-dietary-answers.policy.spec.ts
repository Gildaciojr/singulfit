import { ActivationDietaryAnswersPolicy } from './activation-dietary-answers.policy';

describe('Initial dietary answers and canonical sensitive confirmation', () => {
  const policy = new ActivationDietaryAnswersPolicy();
  it.each(['sim', 'tenho', 'claro'])(
    'requests names for %s without accepting it as a restriction',
    (text) => {
      expect(policy.read(text)).toMatchObject({
        status: 'DETAILS_REQUIRED',
        rawRestrictions: [],
      });
    },
  );
  it.each(['não', 'não.', 'nenhuma', 'não tenho', 'sem restrições'])(
    'keeps explicit absence as an unconfirmed draft: %s',
    (text) => {
      expect(policy.read(text)).toMatchObject({
        status: 'CONFIRMATION_PENDING',
        allergies: [],
        allergiesExplicit: true,
      });
    },
  );
  it.each([
    'Tenho alergia a amendoim e camarão.',
    'Tenho alergia a amendoim, camarão',
    'Tenho alergia a amendoim; camarão',
  ])('keeps all named allergens: %s', (text) => {
    expect(policy.read(text)?.allergies).toEqual(['amendoim', 'camarão']);
  });
  it('separates a declared allergy, intolerance and food preference', () => {
    expect(
      policy.read(
        'Tenho alergia a amendoim e camarão, tenho intolerância à lactose e prefiro evitar peixe',
      ),
    ).toMatchObject({
      allergies: ['amendoim', 'camarão'],
      intolerances: ['LACTOSE'],
      avoidedFoods: ['peixe'],
      allergiesExplicit: true,
    });
  });
  it.each([
    'como funciona?',
    'quero mudar de assunto',
    'depois',
    'talvez',
    'não sei',
    'bom dia',
  ])('does not turn unrelated/ambiguous input into food data: %s', (text) => {
    expect(policy.read(text)).toBeNull();
  });
  it('uses the existing explicit confirmation policy, including uncertainty and rejection', () => {
    expect(policy.confirmation('sim')).toBe('CONFIRMED');
    expect(policy.confirmation('não')).toBe('REJECTED');
    expect(policy.confirmation('acho que sim')).toBe('UNRELATED');
  });

  it('recognizes an explicit contextual correction without treating its negation as absence', () => {
    expect(policy.isCorrection('Não, na verdade tenho alergia a ovo')).toBe(
      true,
    );
    expect(
      policy.read('Não, na verdade tenho alergia a ovo')?.allergies,
    ).toEqual(['ovo']);
  });
  it('does not truncate a long sensitive declaration into a different confirmed allergy', () => {
    expect(
      policy.read(`tenho alergia a ${'ingrediente'.repeat(30)}`),
    ).toBeNull();
  });
  it('asks for clarification instead of saving a goal as an allergy in a mixed message', () => {
    expect(
      policy.read('tenho alergia a amendoim e quero emagrecer'),
    ).toBeNull();
  });
});
