import {
  CoachProfileAcquisitionField,
  CoachProfileValueType,
} from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { CoachProfileFieldRegistryService } from './coach-profile-field-registry.service';
import { ProfileAnswerRecognizerService } from './profile-answer-recognizer.service';
import {
  ProfileQuestionRealizerService,
  ProfileQuestionSpecificationService,
} from './profile-question.service';
import { ProfileAcquisitionOperationalConfigService } from './profile-acquisition-operational-config.service';

describe('Structured profile acquisition registry and recognition', () => {
  const registry = new CoachProfileFieldRegistryService();
  const questions = new ProfileQuestionSpecificationService(registry);
  const recognizer = new ProfileAnswerRecognizerService(registry);
  const realizer = new ProfileQuestionRealizerService();

  function specification(field: CoachProfileAcquisitionField) {
    return questions.forField(field, 'MISSING_CONTEXTUAL_FIELD');
  }

  it('registers every persistent field exactly once with immutable policies', () => {
    const definitions = registry.all();
    expect(definitions.map((definition) => definition.field).sort()).toEqual(
      Object.values(CoachProfileAcquisitionField).sort(),
    );
    expect(
      new Set(definitions.map((definition) => definition.field)).size,
    ).toBe(definitions.length);
    for (const definition of definitions) {
      expect(definition.definitionVersion).toBe(1);
      expect(Object.isFrozen(definition)).toBe(true);
      expect(Object.isFrozen(definition.allowedOptions)).toBe(true);
      expect(Object.isFrozen(definition.dependencies)).toBe(true);
      expect(Object.isFrozen(definition.consumers)).toBe(true);
    }
    expect(
      registry.get(CoachProfileAcquisitionField.FOOD_INTOLERANCES),
    ).toMatchObject({
      valueType: CoachProfileValueType.TEXT_LIST,
      confirmationPolicy: 'ALWAYS_EXPLICIT',
      inferencePolicy: 'PROHIBITED',
      sensitivity: 'SENSITIVE',
    });
  });

  it('creates one channel-independent question and realizes a versioned natural template', () => {
    const question = specification(
      CoachProfileAcquisitionField.TRAINING_MODALITY,
    );
    const realized = realizer.realize(question);
    expect(question).toMatchObject({
      responseType: 'OPTION',
      allowsFreeText: true,
      version: 1,
    });
    expect(question.allowedOptions).toHaveLength(8);
    expect(realized.text).toContain('Onde ou como');
    expect(realized.text.split('?')).toHaveLength(2);
    expect(Object.isFrozen(question)).toBe(true);
    expect(Object.isFrozen(question.allowedOptions)).toBe(true);
    expect(Object.isFrozen(realized)).toBe(true);
    expect(JSON.parse(JSON.stringify(question))).toEqual(question);
  });

  it('recognizes explicit confirmation through the existing recognizer and realizes no raw payload', () => {
    const question = specification(
      CoachProfileAcquisitionField.FOOD_INTOLERANCES,
    );
    const confirmation = recognizer.recognizeConfirmation('sim, pode salvar');
    const realized = realizer.realizeConfirmation(question, ['LACTOSE']);

    expect(confirmation).toEqual({
      disposition: 'CONFIRMED',
      confidence: 'DETERMINISTIC',
      reasonCode: 'USER_CONFIRMED_VALUE',
    });
    expect(realized.text).toBe(
      'Só para confirmar: LACTOSE. Posso salvar assim?',
    );
    expect(Object.isFrozen(confirmation)).toBe(true);
    expect(Object.isFrozen(realized)).toBe(true);
  });

  it.each([
    [
      CoachProfileAcquisitionField.TRAINING_MODALITY,
      'academia',
      'GYM_STRENGTH',
    ],
    [CoachProfileAcquisitionField.TRAINING_MODALITY, 'em casa', 'HOME_WORKOUT'],
    [CoachProfileAcquisitionField.TRAINING_MODALITY, 'corrida', 'RUNNING'],
    [CoachProfileAcquisitionField.TRAINING_MODALITY, 'bike', 'CYCLING'],
    [CoachProfileAcquisitionField.TRAINING_MODALITY, 'CrossFit', 'CROSSFIT'],
    [CoachProfileAcquisitionField.WEEKLY_FREQUENCY, 'três dias', 3],
    [
      CoachProfileAcquisitionField.SESSION_DURATION_MINUTES,
      'uns 45 minutos',
      45,
    ],
    [
      CoachProfileAcquisitionField.AVAILABLE_EQUIPMENT,
      'não tenho equipamento',
      ['BODYWEIGHT'],
    ],
    [
      CoachProfileAcquisitionField.AVAILABLE_EQUIPMENT,
      'halteres e elásticos',
      ['DUMBBELL', 'RESISTANCE_BAND'],
    ],
    [CoachProfileAcquisitionField.DESIRED_MEAL_COUNT, 'quatro refeições', 4],
    [CoachProfileAcquisitionField.EATING_PATTERN, 'vegetariano', 'VEGETARIAN'],
    [
      CoachProfileAcquisitionField.FOOD_INTOLERANCES,
      'intolerância à lactose',
      ['LACTOSE'],
    ],
  ])('recognizes %s deterministically from %s', (field, answer, expected) => {
    const first = recognizer.recognize(specification(field), answer);
    const second = recognizer.recognize(specification(field), answer);
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      disposition: 'RECOGNIZED',
      value: expected,
      confidence: 'DETERMINISTIC',
    });
    expect(Object.isFrozen(first)).toBe(true);
    if (Array.isArray(first.value)) {
      expect(Object.isFrozen(first.value)).toBe(true);
    }
  });

  it('distinguishes refusal, deferral, uncertainty, invalid range and unrelated text', () => {
    const field = CoachProfileAcquisitionField.WEEKLY_FREQUENCY;
    expect(
      recognizer.recognize(specification(field), 'não quero responder')
        .disposition,
    ).toBe('DECLINED');
    expect(
      recognizer.recognize(specification(field), 'depois vejo').disposition,
    ).toBe('DEFERRED');
    expect(
      recognizer.recognize(specification(field), 'não sei').disposition,
    ).toBe('UNKNOWN');
    expect(
      recognizer.recognize(specification(field), '12 vezes').disposition,
    ).toBe('INVALID');
    expect(
      recognizer.recognize(specification(field), 'gosto de música').disposition,
    ).toBe('UNRELATED');
  });

  it('requires explicit confirmation for a sensitive confirmed absence', () => {
    const result = recognizer.recognize(
      specification(CoachProfileAcquisitionField.FOOD_INTOLERANCES),
      'não tenho',
    );
    expect(result).toMatchObject({
      disposition: 'RECOGNIZED',
      value: [],
      confirmationRequired: true,
    });
  });

  it('keeps acquisition OFF by default and resolves configured modes deterministically', async () => {
    const module = await Test.createTestingModule({
      providers: [
        ProfileAcquisitionOperationalConfigService,
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue(undefined) },
        },
      ],
    }).compile();
    expect(
      module.get(ProfileAcquisitionOperationalConfigService).get(),
    ).toEqual({
      mode: 'OFF',
      questionExpirationHours: 48,
    });
  });
});
