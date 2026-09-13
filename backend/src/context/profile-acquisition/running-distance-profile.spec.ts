import { CoachProfileAcquisitionField } from '@prisma/client';
import { RUNNING_COMPLETE_DISTANCE_REQUIRED_FIELDS } from '../planning-profile-requirements.contract';
import { CoachProfileFieldRegistryService } from './coach-profile-field-registry.service';
import { ProfileAnswerRecognizerService } from './profile-answer-recognizer.service';
import { ProfileQuestionSpecificationService } from './profile-question.service';

describe('running distance profile acquisition', () => {
  const registry = new CoachProfileFieldRegistryService();
  const questions = new ProfileQuestionSpecificationService(registry);
  const recognizer = new ProfileAnswerRecognizerService(registry);

  const recognize = (field: CoachProfileAcquisitionField, answer: string) =>
    recognizer.recognize(
      questions.forField(field, 'MISSING_CONTEXTUAL_FIELD'),
      answer,
    );

  it.each([
    [CoachProfileAcquisitionField.TARGET_DISTANCE, '2,5 km', 2500],
    [CoachProfileAcquisitionField.TARGET_DISTANCE, '2.5 km', 2500],
    [CoachProfileAcquisitionField.TARGET_DISTANCE, '5km', 5000],
    [CoachProfileAcquisitionField.TARGET_DISTANCE, '5 quilômetros', 5000],
    [
      CoachProfileAcquisitionField.CURRENT_RUNNING_DISTANCE,
      'hoje consigo correr 3 km',
      3000,
    ],
    [CoachProfileAcquisitionField.CURRENT_RUNNING_DISTANCE, '5000 m', 5000],
  ])('%s recognizes %s as canonical meters', (field, answer, meters) => {
    expect(recognize(field, answer)).toMatchObject({
      disposition: 'RECOGNIZED',
      valueType: 'INTEGER',
      value: meters,
    });
  });

  it.each(['0 km', '-2 km', 'não sei', 'texto aleatório'])(
    'rejects invalid distance %s',
    (answer) => {
      expect(
        recognize(CoachProfileAcquisitionField.TARGET_DISTANCE, answer)
          .disposition,
      ).not.toBe('RECOGNIZED');
    },
  );

  it('keeps every canonical running requirement registry-backed and questionable', () => {
    for (const collectorField of RUNNING_COMPLETE_DISTANCE_REQUIRED_FIELDS) {
      const definition = registry
        .all()
        .find(
          (item) => questions.toCollectorField(item.field) === collectorField,
        );
      expect(definition).toBeDefined();
      expect(
        questions.forField(definition!.field, 'MISSING_CONTEXTUAL_FIELD'),
      ).toMatchObject({ field: definition!.field });
    }
  });
});
