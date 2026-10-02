import { declaredWorkoutProfileFacts } from './workout-declared-profile-facts';
import { GenerateWorkoutPlanV2InputBuilder } from './generate-workout-plan-v2-input.builder';
import type { CoachProfileSnapshotBuilder } from '../../context/coach-profile-snapshot.builder';
import type { PrismaService } from '../../prisma/prisma.service';
import { productiveWorkoutProfileFacts } from '../../context/profile-acquisition/productive-profile-facts';
import { workoutEquipmentBaseline } from './workout-equipment-defaults';

describe('shared workout declarations', () => {
  it.each([
    ['Moro em condomínio e treino em casa 5 vezes por semana', 'HOME', 5],
    ['Estou em um hotel e corro na rua 4 vezes por semana', 'STREET', 4],
    ['Treino na academia do condomínio', 'LIMITED_GYM', null],
    ['Treino na academia do hotel', 'LIMITED_GYM', null],
    ['Treino na academia de condomínio', 'LIMITED_GYM', null],
    ['Treino na academia de hotel', 'LIMITED_GYM', null],
    ['academia sem máquinas', 'LIMITED_GYM', null],
    ['academia só com halteres', 'LIMITED_GYM', null],
    ['academia com equipamentos limitados', 'LIMITED_GYM', null],
    ['Treino na academia sem máquinas', 'LIMITED_GYM', null],
    ['Na academia só tenho halteres', 'LIMITED_GYM', null],
    ['Minha academia tem equipamentos limitados', 'LIMITED_GYM', null],
    ['Academia pequena, sem aparelhos', 'LIMITED_GYM', null],
  ] as const)(
    'recognizes only environment-linked qualifications: %s',
    (message, environment, weeklyFrequency) => {
      const facts = declaredWorkoutProfileFacts(message);
      expect(facts.environment).toBe(environment);
      expect(facts.weeklyFrequency).toBe(weeklyFrequency);
      expect(productiveWorkoutProfileFacts(message).environment?.value).toBe(
        environment,
      );
      if (environment === 'LIMITED_GYM') {
        expect(
          productiveWorkoutProfileFacts(message).equipment,
        ).toBeUndefined();
        expect(builder.recognizeDeclaredContext(message).equipment).not.toEqual(
          workoutEquipmentBaseline('FULL_GYM'),
        );
      }
    },
  );

  it.each(['condomínio', 'hotel', 'Estou em um hotel', 'Moro em condomínio'])(
    'does not infer a gym from an unrelated place: %s',
    (message) => {
      expect(declaredWorkoutProfileFacts(message).environment).toBeUndefined();
      expect(declaredWorkoutProfileFacts(message).environmentMentioned).toBe(
        false,
      );
    },
  );

  it('does not qualify gym with a HOME restriction from another clause', () => {
    const facts = declaredWorkoutProfileFacts(
      'Treino na academia durante a semana; em casa fico sem halteres',
    );
    expect(facts.environment).toBeUndefined(); // Two declared environments remain unresolved.
    expect(facts.equipmentRestricted).toBe(true);
    expect(
      declaredWorkoutProfileFacts('Treino na academia durante a semana')
        .environment,
    ).toBe('FULL_GYM');
    const separateRestriction = declaredWorkoutProfileFacts(
      'Treino na academia durante a semana; guardo objetos em casa sem halteres',
    );
    expect(separateRestriction.environment).not.toBe('LIMITED_GYM');
  });

  it('keeps a single gym FULL_GYM when equipment restriction belongs to another clause', () => {
    const facts = declaredWorkoutProfileFacts(
      'Treino na academia durante a semana; meu irmão fica sem halteres',
    );
    expect(facts.environment).toBe('FULL_GYM');
    expect(facts.equipmentRestricted).toBe(true);
    expect(facts.equipmentScope.restricted).toBe(false);
    const message =
      'Treino na academia durante a semana; meu irmão fica sem halteres';
    expect(builder.recognizeDeclaredContext(message).equipment).toEqual(
      workoutEquipmentBaseline('FULL_GYM'),
    );
    const baseline = workoutEquipmentBaseline('FULL_GYM');
    expect(productiveWorkoutProfileFacts(message).equipment).toEqual({
      value: baseline && 'value' in baseline ? baseline.value : undefined,
      evidence: 'INFERRED',
    });
  });
  it('keeps a third-party HOME restriction separate from the unresolved gym', () => {
    const message = 'Treino na academia; em casa minha esposa só tem halteres';
    const facts = declaredWorkoutProfileFacts(message);
    expect(facts.environment).toBeUndefined();
    expect(facts.equipmentScope).toEqual({ text: '', restricted: false });
    expect(productiveWorkoutProfileFacts(message).equipment).toBeUndefined();
    expect(builder.recognizeDeclaredContext(message).equipment).toBeUndefined();
  });
  const builder = new GenerateWorkoutPlanV2InputBuilder(
    {} as CoachProfileSnapshotBuilder,
    {} as PrismaService,
  );
  it.each([
    'academia 5x',
    'academia pequena cinco dias por semana',
    'em casa 05 vezes por semana',
    'CrossFit três vezes por semana',
    'trilha 2 dias',
    'pista 4 vezes',
    'estrada 6x',
    'rua sete dias',
    'ao ar livre uma vez por semana',
    'academia sem máquinas cinco vezes por semana',
    'academia ou casa',
    '5 vezes ou 3 vezes por semana',
  ])('uses identical facts for acquisition and generation: %s', (message) => {
    const canonical = declaredWorkoutProfileFacts(message);
    const acquired = productiveWorkoutProfileFacts(message);
    const generated = builder.recognizeDeclaredContext(message);
    expect(acquired.environment?.value).toBe(canonical.environment);
    expect(
      generated.environment && 'value' in generated.environment
        ? generated.environment.value
        : undefined,
    ).toBe(canonical.environment);
    expect(acquired.weeklyFrequency?.value ?? null).toBe(
      canonical.weeklyFrequency,
    );
    expect(
      generated.weeklyFrequency && 'value' in generated.weeklyFrequency
        ? generated.weeklyFrequency.value
        : null,
    ).toBe(canonical.weeklyFrequency);
  });
  it.each([
    ['uma', 1],
    ['duas', 2],
    ['três', 3],
    ['quatro', 4],
    ['cinco', 5],
    ['seis', 6],
    ['sete', 7],
  ] as const)('recognizes %s as frequency %s', (word, expected) => {
    expect(
      declaredWorkoutProfileFacts(`${word} vezes por semana`).weeklyFrequency,
    ).toBe(expected);
    expect(declaredWorkoutProfileFacts(`${expected}x`).weeklyFrequency).toBe(
      expected,
    );
    expect(
      declaredWorkoutProfileFacts(`0${expected} dias por semana`)
        .weeklyFrequency,
    ).toBe(expected);
  });
  it('does not attach HOME/CROSSFIT equipment baseline to an explicit absence', () => {
    for (const message of ['em casa sem halteres', 'CrossFit sem barras']) {
      expect(
        builder.recognizeDeclaredContext(message).equipment?.status,
      ).not.toBe('INFERRED');
      expect(productiveWorkoutProfileFacts(message).equipment).toBeUndefined();
    }
  });
});
