import {
  hydrationTotal,
  intakeEvidence,
} from './nutrition-intake-evidence.policy';

describe('Canonical intake evidence', () => {
  it('records explicit absence as zero, but never drops a contradictory clause', () => {
    expect(
      intakeEvidence(
        { kind: 'WATER_TOTAL', day: 'TODAY', quote: 'Não bebi água ainda.' },
        'Não bebi água ainda.',
      ),
    ).toMatchObject({ volumeMl: 0 });
    expect(
      intakeEvidence(
        { kind: 'WATER_TOTAL', day: 'TODAY', quote: 'Não bebi água' },
        'Não bebi água, mas tomei 1 litro depois.',
      ),
    ).toBeNull();
  });
  it('does not turn refusal, a question or a guessed goal into an authorized ledger effect', () => {
    expect(
      intakeEvidence(
        {
          kind: 'VOID',
          action: 'DELETE',
          targetRecordId: 'previous',
          day: 'TODAY',
          quote: 'Não apaga',
        },
        'Não apaga meu almoço',
      ),
    ).toBeNull();
    expect(
      intakeEvidence(
        { kind: 'WATER_GOAL', day: 'TODAY', quote: '2 litros' },
        'Qual minha meta, 2 litros?',
      ),
    ).toBeNull();
    expect(
      intakeEvidence(
        { kind: 'MEAL', action: 'CORRECT', day: 'TODAY', quote: 'arroz' },
        'Corrige meu almoço: arroz',
      ),
    ).toBeNull();
  });
  it.each([
    ['500 ml', 500],
    ['1 litro', 1000],
    ['1,5 litros', 1500],
    ['2 copos de 250 ml', 500],
  ])('derives %s from literal units', (quote, volumeMl) => {
    expect(
      intakeEvidence(
        { kind: 'WATER_ADD', day: 'TODAY', quote },
        `Bebi ${quote}.`,
      ),
    ).toMatchObject({ volumeMl });
  });
  it.each([
    'dois copos',
    '2 copos',
    'muita água',
    'meta batida',
    '0 ml',
    '-500 ml',
    '1 litro e mais água',
  ])('does not fabricate volume from %s', (quote) => {
    expect(
      intakeEvidence(
        { kind: 'WATER_ADD', day: 'TODAY', quote },
        `Bebi ${quote}.`,
      ),
    ).toBeNull();
  });
  it('rejects invented quantities and yesterday not present in the inbound', () => {
    expect(
      intakeEvidence(
        { kind: 'WATER_ADD', day: 'TODAY', quote: '500 ml' },
        'Bebi água',
      ),
    ).toBeNull();
    expect(
      intakeEvidence(
        { kind: 'WATER_ADD', day: 'YESTERDAY', quote: '500 ml' },
        'Bebi 500 ml',
      ),
    ).toBeNull();
  });
  it('accumulated total replaces prior additions, then later increments are added', () => {
    expect(
      hydrationTotal([
        { kind: 'WATER_ADD', volumeMl: 500 },
        { kind: 'WATER_TOTAL', volumeMl: 1000 },
        { kind: 'WATER_ADD', volumeMl: 300 },
      ]),
    ).toBe(1300);
    expect(hydrationTotal([])).toBeNull();
  });
  it('retains unknown meal nutrition rather than assigning zero', () => {
    expect(
      intakeEvidence(
        { kind: 'MEAL', day: 'TODAY', quote: 'arroz e frango' },
        'Almocei arroz e frango',
      ),
    ).toMatchObject({ kind: 'MEAL', volumeMl: null });
  });
});

describe('intake calendar evidence', () => {
  it('rejects invalid dates without rolling February forward', () => {
    expect(
      intakeEvidence(
        { kind: 'MEAL', day: 'TODAY', quote: 'arroz', date: '2026-02-30' },
        'Em 2026-02-30 comi arroz',
      ),
    ).toBeNull();
  });
});
