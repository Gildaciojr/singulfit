import { CoachProfileAcquisitionField } from '@prisma/client';
import { workoutEquipmentBaseline } from '../../workout/v2/workout-equipment-defaults';
import { CoachProfileFieldRegistryService } from './coach-profile-field-registry.service';
import { ProfileAnswerRecognizerService } from './profile-answer-recognizer.service';
import { productiveWorkoutProfileFacts } from './productive-profile-facts';

describe('productive profile facts', () => {
  it.each([
    'Quero montar um treino para academia 5 vezes por semana',
    'monte um treino completo para eu fazer na academia, 05 vezes por semana',
    'Quero treinar na academia 5 dias por semana',
    'Quero treinar na academia 5 vezes por semana, sem lesão',
    'Quero academia 5x por semana, não quero cardio',
    'Monte meu treino de academia cinco dias por semana, sem corrida',
    'Treino na academia 5x por semana; meu irmão fica sem halteres',
  ])('consumes explicit environment and frequency: %s', (message) => {
    const facts = productiveWorkoutProfileFacts(message);
    expect(facts.environment).toEqual({
      value: 'FULL_GYM',
      evidence: 'EXPLICIT',
    });
    expect(facts.weeklyFrequency).toEqual({ value: 5, evidence: 'EXPLICIT' });
    const baseline = workoutEquipmentBaseline('FULL_GYM');
    expect(baseline?.status).toBe('INFERRED');
    if (baseline?.status === 'INFERRED')
      expect(facts.equipment?.value).toBe(baseline.value);
    expect(facts.equipment?.evidence).toBe('INFERRED');
  });
  it.each([
    'pequena',
    'limitada',
    'de condomínio',
    'de hotel',
    'sem máquinas',
    'só com halteres',
  ])('preserves %s gym precedence', (qualifier) => {
    const facts = productiveWorkoutProfileFacts(
      `Quero treinar em uma academia ${qualifier} 5 vezes por semana`,
    );
    expect(facts.environment?.value).toBe('LIMITED_GYM');
    expect(facts.weeklyFrequency?.value).toBe(5);
    expect(facts.equipment).toBeUndefined();
  });
  it.each(['talvez na academia', 'academia ou casa', 'nao na academia'])(
    'does not confirm ambiguous environment: %s',
    (text) => {
      expect(productiveWorkoutProfileFacts(text).environment).toBeUndefined();
    },
  );
  it('does not substitute baseline for explicit equipment restrictions', () => {
    expect(
      productiveWorkoutProfileFacts('treino na academia sem aparelhos')
        .equipment,
    ).toBeUndefined();
    const equipment = { value: ['DUMBBELL'], evidence: 'EXPLICIT' as const };
    expect(
      productiveWorkoutProfileFacts('treino na academia', { equipment })
        .equipment,
    ).toBe(equipment);
  });
  it('does not attach an unrelated alternative to the environment field', () => {
    const facts = productiveWorkoutProfileFacts(
      'academia pequena, na academia cinco dias por semana, sem corrida ou cardio',
    );
    expect(facts.environment?.value).toBe('LIMITED_GYM');
    expect(facts.weeklyFrequency?.value).toBe(5);
  });
  it('does not choose between contradictory gym declarations', () => {
    expect(
      productiveWorkoutProfileFacts('academia completa ou academia pequena')
        .environment,
    ).toBeUndefined();
  });

  it.each([
    ['academia', 'FULL_GYM'],
    ['academia pequena', 'LIMITED_GYM'],
    ['em casa', 'HOME'],
    ['no box de CrossFit', 'CROSSFIT_BOX'],
    ['na trilha', 'TRAIL'],
    ['na pista', 'TRACK'],
    ['na estrada', 'ROAD'],
    ['na rua', 'STREET'],
    ['ao ar livre', 'OUTDOOR'],
  ])('projects the canonical environment %s', (message, environment) => {
    const facts = productiveWorkoutProfileFacts(`Quero treinar ${message}`);
    expect(facts.environment).toEqual({
      value: environment,
      evidence: 'EXPLICIT',
    });
    const baseline = workoutEquipmentBaseline(environment);
    if (baseline?.status === 'INFERRED')
      expect(facts.equipment?.value).toBe(baseline.value);
    else expect(facts.equipment).toBeUndefined();
  });

  it.each([
    '5x',
    '5 vezes',
    '5 vezes por semana',
    '05 vezes por semana',
    '5 dias',
    '05 dias por semana',
    '5 dias por semana',
    'cinco vezes por semana',
    'cinco dias por semana',
  ])('projects canonical frequency %s', (message) => {
    expect(productiveWorkoutProfileFacts(message).weeklyFrequency).toEqual({
      value: 5,
      evidence: 'EXPLICIT',
    });
  });

  it.each([
    'academia ou casa',
    'talvez academia',
    'não sei se academia ou casa',
  ])('does not inherit arbitrary environment on conflict: %s', (message) => {
    expect(
      productiveWorkoutProfileFacts(message, {
        environment: { value: 'FULL_GYM', evidence: 'EXPLICIT' },
      }).environment,
    ).toBeUndefined();
  });
  it.each([
    '5 vezes ou 3 vezes por semana',
    'cinco dias ou três dias',
    'talvez 5x por semana',
    'não posso 5 dias',
  ])('does not inherit arbitrary frequency: %s', (message) => {
    expect(
      productiveWorkoutProfileFacts(message, {
        weeklyFrequency: { value: 5, evidence: 'EXPLICIT' },
      }).weeklyFrequency,
    ).toBeUndefined();
  });

  it.each(['academia sem máquinas', 'academia pequena', 'academia limitada'])(
    'does not keep a stale inferred FULL_GYM baseline after declaring %s',
    (message) => {
      const baseline = workoutEquipmentBaseline('FULL_GYM');
      if (baseline?.status !== 'INFERRED') throw new Error('Baseline missing');
      const facts = productiveWorkoutProfileFacts(message, {
        equipment: { value: baseline.value, evidence: 'INFERRED' },
      });
      expect(facts.environment?.value).toBe('LIMITED_GYM');
      expect(facts.equipment).toBeUndefined();
    },
  );
});

describe('productive command precedence', () => {
  const recognizer = new ProfileAnswerRecognizerService(
    new CoachProfileFieldRegistryService(),
  );
  const specification = {
    field: CoachProfileAcquisitionField.AVAILABLE_EQUIPMENT,
    confirmationPolicy: 'IMPLICIT_ON_VALID_RESPONSE' as const,
    reasonCode: 'MISSING_CONTEXTUAL_FIELD' as const,
  };
  it.each([
    'monte um treino completo para eu fazer na academia, 05 vezes por semana',
    'Quero montar um treino para academia 5 vezes por semana',
    'crie uma dieta para mim',
    'poderia gerar um plano de treino e dieta?',
    'refaça minha ficha de treino',
    'Quero um treino para academia',
    'Quero um treino novo',
    'Preciso de um treino',
    'Me monta um treino',
    'Monte um treino',
    'Faz um treino para mim',
    'Crie uma dieta',
    'Preciso de uma dieta para emagrecer',
    'Quero um plano de treino e dieta',
    'Monte um treino sem corrida, não quero cardio',
    'Quero um treino para academia 5x por semana',
  ])('leaves new productive commands to official runtime: %s', (message) => {
    expect(recognizer.isIndependentCommand(message)).toBe(true);
    expect(recognizer.recognize(specification, message)).toMatchObject({
      disposition: 'UNRELATED',
      reasonCode: 'NOT_APPLICABLE',
    });
  });
  it.each([
    'não quero montar um treino',
    'não quero dieta',
    'não preciso de um treino agora',
    'quero evitar montar um treino',
    'não quero um treino novo',
  ])('does not classify a denied request as independent: %s', (message) => {
    expect(recognizer.isIndependentCommand(message)).toBe(false);
  });
  it('still recognizes short Academia answer', () => {
    expect(
      recognizer.recognize(
        {
          ...specification,
          field: CoachProfileAcquisitionField.TRAINING_ENVIRONMENT,
        },
        'Academia',
      ),
    ).toMatchObject({ disposition: 'RECOGNIZED', value: 'FULL_GYM' });
  });
});
