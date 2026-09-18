import { CoachProfileAcquisitionField as Field } from '@prisma/client';
import { CoachProfileFieldRegistryService } from './coach-profile-field-registry.service';
import { ProfileAnswerRecognizerService } from './profile-answer-recognizer.service';
import { ProfileQuestionSpecificationService } from './profile-question.service';

describe('Registry driven natural profile responses', () => {
  const registry = new CoachProfileFieldRegistryService();
  const questions = new ProfileQuestionSpecificationService(registry);
  const recognizer = new ProfileAnswerRecognizerService(registry);
  const recognize = (field: Field, text: string) =>
    recognizer.recognize(
      questions.forField(field, 'MISSING_CONTEXTUAL_FIELD'),
      text,
    );
  const sensitive = registry.all().filter((d) => d.sensitivity === 'SENSITIVE');

  it.each(registry.all())(
    'recognizes a typed valid value for $field',
    (definition) => {
      const samples: Partial<Record<Field, string>> = {
        PHYSICAL_LIMITATIONS: 'nenhuma',
        FOOD_INTOLERANCES: 'nenhuma',
        ALLERGIES: 'nenhuma',
        MEDICAL_CONDITIONS: 'nenhuma',
        DECLARED_FOOD_PREFERENCES: 'arroz e feijão',
        DECLARED_FOOD_REJECTIONS: 'não gosto de peixe',
        REPORTED_SUPPLEMENTATION: 'creatina',
        MEAL_TIMES: '08:00 e 12:00',
        TRAINING_TIME: '18:00',
        DAILY_TRAINING_WINDOWS: 'manhã',
        TARGET_DISTANCE: '5 km',
        CURRENT_RUNNING_DISTANCE: '2,5 km',
      };
      const text =
        samples[definition.field] ??
        (definition.valueType === 'BOOLEAN'
          ? 'sim.'
          : definition.valueType === 'INTEGER'
            ? String(definition.minimum)
            : definition.allowedOptions[0]);
      expect(text).toBeDefined();
      expect(recognize(definition.field, text)).toMatchObject({
        disposition: 'RECOGNIZED',
        valueType: definition.valueType,
        confirmationRequired:
          definition.confirmationPolicy === 'ALWAYS_EXPLICIT',
      });
    },
  );

  it.each([
    [Field.TARGET_DISTANCE, '5 km', 5000],
    [Field.CURRENT_RUNNING_DISTANCE, '2,5 km', 2500],
  ])('recognizes canonical meters for %s', (field, text, value) => {
    expect(recognize(field, text)).toMatchObject({
      disposition: 'RECOGNIZED',
      value,
    });
  });

  it.each(sensitive)(
    'canonicalizes generic absence only in the sensitive field $field',
    (definition) => {
      for (const text of [
        'não',
        'Não.',
        'não tenho',
        'não possuo',
        'nenhum',
        'nenhuma',
      ])
        expect(recognize(definition.field, text)).toMatchObject({
          disposition: 'RECOGNIZED',
          value: [],
          confirmationRequired: true,
        });
    },
  );
  it.each([
    [Field.ALLERGIES, 'não tenho nenhuma alergia alimentar'],
    [Field.FOOD_INTOLERANCES, 'não tenho intolerância'],
    [Field.PHYSICAL_LIMITATIONS, 'não tenho limitações'],
    [Field.MEDICAL_CONDITIONS, 'não tenho nenhuma condição'],
  ])('canonicalizes field-specific absence for %s', (field, text) => {
    expect(recognize(field, text)).toMatchObject({
      disposition: 'RECOGNIZED',
      value: [],
    });
  });

  it.each(registry.all().filter((item) => item.valueType === 'BOOLEAN'))(
    'bounds boolean language for $field',
    (definition) => {
      for (const text of [
        'sim',
        'sim.',
        'tenho',
        'tenho sim',
        'possuo',
        'claro',
        'correto',
      ])
        expect(recognize(definition.field, text)).toMatchObject({
          value: true,
        });
      for (const text of [
        'não',
        'não.',
        'nao',
        'não tenho',
        'não possuo',
        'nenhum',
        'nenhuma',
      ])
        expect(recognize(definition.field, text)).toMatchObject({
          value: false,
        });
      for (const text of [
        'sim mas não sei',
        'tenho uma dúvida',
        'não gosto de peixe',
      ])
        expect(recognize(definition.field, text).disposition).not.toBe(
          'RECOGNIZED',
        );
    },
  );

  it.each(registry.all().filter((d) => d.valueType === 'INTEGER'))(
    'respects bounds and units for $field',
    (definition) => {
      const isDistance =
        definition.field === Field.TARGET_DISTANCE ||
        definition.field === Field.CURRENT_RUNNING_DISTANCE;
      const format = (value: number) =>
        isDistance ? `${value} m` : String(value);
      const invalidValues = [
        ...(definition.minimum === undefined ? [] : [definition.minimum - 1]),
        ...(definition.maximum === undefined ? [] : [definition.maximum + 1]),
      ];
      for (const n of invalidValues)
        expect(recognize(definition.field, format(n)).disposition).not.toBe(
          'RECOGNIZED',
        );
      expect(
        recognize(definition.field, 'tenho 5 alergias').disposition,
      ).not.toBe('RECOGNIZED');
    },
  );

  it.each([
    'sim',
    'sim.',
    'pode',
    'pode.',
    'pode salvar',
    'pode confirmar',
    'correto',
    'isso',
    'isso mesmo',
    'exato',
    'está certo',
    'é isso',
    'confirmo',
  ])('accepts natural confirmation %s for every field', (text) => {
    for (const definition of registry.all())
      expect(
        recognizer.recognizeContextualConfirmation(definition.field, text),
      ).toMatchObject({ disposition: 'CONFIRMED' });
  });

  it.each(['acho que sim', 'talvez', 'não sei', 'provavelmente', 'pode ser'])(
    'does not confirm uncertainty %s',
    (text) => {
      for (const definition of registry.all()) {
        expect(
          recognizer.recognizeContextualConfirmation(definition.field, text)
            .disposition,
        ).toBe('UNRELATED');
        expect(recognize(definition.field, text).disposition).not.toBe(
          'RECOGNIZED',
        );
      }
    },
  );

  it.each([
    [Field.WEEKLY_FREQUENCY, 'Não, na verdade treino 4 vezes', 4],
    [Field.SESSION_DURATION_MINUTES, 'Na verdade são 60 minutos', 60],
    [Field.FOOD_INTOLERANCES, 'Não, tenho intolerância à lactose', ['LACTOSE']],
    [
      Field.PHYSICAL_LIMITATIONS,
      'Na verdade tenho problema no joelho',
      ['problema no joelho'],
    ],
    [Field.MEDICAL_CONDITIONS, 'Na verdade tenho hipertensão', ['hipertensão']],
    [Field.TRAINING_ENVIRONMENT, 'Corrigindo, treino em casa', 'HOME'],
    [Field.CARDIO_AVAILABILITY, 'Corrigindo, não tenho', false],
  ] as const)('keeps typed corrections for %s', (field, text, value) => {
    expect(
      recognizer.recognizeContextualConfirmation(field, text),
    ).toMatchObject({ disposition: 'CORRECTED_VALUE', value });
  });

  it('does not consume commands or cross-capture sensitive absence', () => {
    expect(recognize(Field.TRAINING_MODALITY, 'meu treino')).toMatchObject({
      disposition: 'UNRELATED',
      reasonCode: 'NOT_APPLICABLE',
    });
    expect(
      recognize(Field.DECLARED_FOOD_REJECTIONS, 'não gosto de peixe').value,
    ).not.toEqual([]);
    expect(
      recognize(Field.PHYSICAL_LIMITATIONS, 'não tenho alergias').disposition,
    ).not.toBe('RECOGNIZED');
  });
});
