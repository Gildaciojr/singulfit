import {
  CoachProfileAcquisitionField,
  CoachProfileConfirmationState,
  CoachProfileFieldValue,
  CoachProfileValueSource,
  CoachProfileValueStatus,
  CoachProfileValueType,
} from '@prisma/client';
import {
  COACH_PROFILE_DATA_SOURCE,
  COACH_PROFILE_KNOWLEDGE_STATUS,
} from '../coach-profile-snapshot.contract';
import { CoachProfileAcquisitionProjectionService } from './coach-profile-acquisition-projection.service';

describe('CoachProfileAcquisitionProjectionService', () => {
  function fieldValue(
    field: CoachProfileAcquisitionField,
    valueType: CoachProfileValueType,
    overrides: Partial<CoachProfileFieldValue> = {},
  ): CoachProfileFieldValue {
    return {
      id: `${field}-value-id`,
      userId: 'user-id',
      field,
      valueType,
      textValue: valueType === CoachProfileValueType.TEXT ? 'current' : null,
      integerValue: valueType === CoachProfileValueType.INTEGER ? 4 : null,
      booleanValue: valueType === CoachProfileValueType.BOOLEAN ? false : null,
      textListValue:
        valueType === CoachProfileValueType.TEXT_LIST ? ['current'] : [],
      valueFingerprint: 'fingerprint',
      status: CoachProfileValueStatus.CONFIRMED,
      source: CoachProfileValueSource.USER_CONFIRMED,
      confirmationState: CoachProfileConfirmationState.CONFIRMED,
      definitionVersion: 1,
      referenceDate: new Date('2026-08-08T12:00:00.000Z'),
      operationKey: `${field}-operation-key`,
      previousValueId: null,
      isActive: true,
      confirmedAt: new Date('2026-08-08T12:00:00.000Z'),
      invalidatedAt: null,
      createdAt: new Date('2026-08-08T12:00:00.000Z'),
      updatedAt: new Date('2026-08-08T12:00:00.000Z'),
      ...overrides,
    };
  }

  function textListRecord(
    field: CoachProfileAcquisitionField,
    overrides: Partial<CoachProfileFieldValue> = {},
  ): CoachProfileFieldValue {
    return {
      id: `${field}-value-id`,
      userId: 'user-id',
      field,
      valueType: CoachProfileValueType.TEXT_LIST,
      textValue: null,
      integerValue: null,
      booleanValue: null,
      textListValue: [],
      valueFingerprint: 'fingerprint',
      status: CoachProfileValueStatus.CONFIRMED,
      source: CoachProfileValueSource.USER_CONFIRMED,
      confirmationState: CoachProfileConfirmationState.CONFIRMED,
      definitionVersion: 1,
      referenceDate: new Date('2026-08-08T12:00:00.000Z'),
      operationKey: `${field}-operation-key`,
      previousValueId: null,
      isActive: true,
      confirmedAt: new Date('2026-08-08T12:00:00.000Z'),
      invalidatedAt: null,
      createdAt: new Date('2026-08-08T12:00:00.000Z'),
      updatedAt: new Date('2026-08-08T12:00:00.000Z'),
      ...overrides,
    };
  }

  it('projects confirmed empty allergies as known empty constraints', () => {
    const service = new CoachProfileAcquisitionProjectionService();
    const record: CoachProfileFieldValue = {
      id: 'allergies-value-id',
      userId: 'user-id',
      field: CoachProfileAcquisitionField.ALLERGIES,
      valueType: CoachProfileValueType.TEXT_LIST,
      textValue: null,
      integerValue: null,
      booleanValue: null,
      textListValue: [],
      valueFingerprint: 'fingerprint',
      status: CoachProfileValueStatus.CONFIRMED,
      source: CoachProfileValueSource.USER_CONFIRMED,
      confirmationState: CoachProfileConfirmationState.CONFIRMED,
      definitionVersion: 1,
      referenceDate: new Date('2026-08-08T12:00:00.000Z'),
      operationKey: 'operation-key',
      previousValueId: null,
      isActive: true,
      confirmedAt: new Date('2026-08-08T12:00:00.000Z'),
      invalidatedAt: null,
      createdAt: new Date('2026-08-08T12:00:00.000Z'),
      updatedAt: new Date('2026-08-08T12:00:00.000Z'),
    };

    const projection = service.project([record]);
    expect(
      service.textList(projection, CoachProfileAcquisitionField.ALLERGIES),
    ).toEqual({
      status: COACH_PROFILE_KNOWLEDGE_STATUS.KNOWN,
      value: [],
      sources: [COACH_PROFILE_DATA_SOURCE.PROFILE_ACQUISITION],
    });
  });

  it('projects confirmed empty medical conditions as known empty constraints', () => {
    const service = new CoachProfileAcquisitionProjectionService();
    const record: CoachProfileFieldValue = {
      id: 'medical-conditions-value-id',
      userId: 'user-id',
      field: CoachProfileAcquisitionField.MEDICAL_CONDITIONS,
      valueType: CoachProfileValueType.TEXT_LIST,
      textValue: null,
      integerValue: null,
      booleanValue: null,
      textListValue: [],
      valueFingerprint: 'fingerprint',
      status: CoachProfileValueStatus.CONFIRMED,
      source: CoachProfileValueSource.USER_CONFIRMED,
      confirmationState: CoachProfileConfirmationState.CONFIRMED,
      definitionVersion: 1,
      referenceDate: new Date('2026-08-09T12:00:00.000Z'),
      operationKey: 'medical-conditions-operation-key',
      previousValueId: null,
      isActive: true,
      confirmedAt: new Date('2026-08-09T12:00:00.000Z'),
      invalidatedAt: null,
      createdAt: new Date('2026-08-09T12:00:00.000Z'),
      updatedAt: new Date('2026-08-09T12:00:00.000Z'),
    };

    const projection = service.project([record]);
    expect(
      service.textList(
        projection,
        CoachProfileAcquisitionField.MEDICAL_CONDITIONS,
      ),
    ).toEqual({
      status: COACH_PROFILE_KNOWLEDGE_STATUS.KNOWN,
      value: [],
      sources: [COACH_PROFILE_DATA_SOURCE.PROFILE_ACQUISITION],
    });
  });

  it.each([
    CoachProfileAcquisitionField.PHYSICAL_LIMITATIONS,
    CoachProfileAcquisitionField.ALLERGIES,
    CoachProfileAcquisitionField.FOOD_INTOLERANCES,
  ])(
    'keeps active confirmed empty %s above historical conflicts',
    (field) => {
      const service = new CoachProfileAcquisitionProjectionService();
      const projection = service.project([
        textListRecord(field, {
          id: `${field}-historical-conflict`,
          status: CoachProfileValueStatus.CONFLICTED,
          confirmationState: CoachProfileConfirmationState.REJECTED,
          isActive: false,
          confirmedAt: null,
        }),
        textListRecord(field),
      ]);

      expect(service.textList(projection, field)).toEqual({
        status: COACH_PROFILE_KNOWLEDGE_STATUS.KNOWN,
        value: [],
        sources: [COACH_PROFILE_DATA_SOURCE.PROFILE_ACQUISITION],
      });
    },
  );

  it.each([
    CoachProfileAcquisitionField.PHYSICAL_LIMITATIONS,
    CoachProfileAcquisitionField.ALLERGIES,
    CoachProfileAcquisitionField.FOOD_INTOLERANCES,
  ])('keeps unconfirmed empty %s pending confirmation', (field) => {
    const service = new CoachProfileAcquisitionProjectionService();
    const projection = service.project([
      textListRecord(field, {
        status: CoachProfileValueStatus.ANSWERED_UNCONFIRMED,
        source: CoachProfileValueSource.USER_ANSWER,
        confirmationState: CoachProfileConfirmationState.PENDING,
        confirmedAt: null,
      }),
    ]);

    expect(service.textList(projection, field)).toEqual({
      status: COACH_PROFILE_KNOWLEDGE_STATUS.REQUIRES_CONFIRMATION,
      value: [],
      sources: [COACH_PROFILE_DATA_SOURCE.PROFILE_ACQUISITION],
    });
  });

  it.each([
    [
      'TEXT',
      CoachProfileAcquisitionField.TRAINING_MODALITY,
      CoachProfileValueType.TEXT,
      (service: CoachProfileAcquisitionProjectionService, projection: ReturnType<CoachProfileAcquisitionProjectionService['project']>) =>
        service.text(projection, CoachProfileAcquisitionField.TRAINING_MODALITY),
      'running',
    ],
    [
      'INTEGER',
      CoachProfileAcquisitionField.TRAINING_FREQUENCY,
      CoachProfileValueType.INTEGER,
      (service: CoachProfileAcquisitionProjectionService, projection: ReturnType<CoachProfileAcquisitionProjectionService['project']>) =>
        service.integer(
          projection,
          CoachProfileAcquisitionField.TRAINING_FREQUENCY,
        ),
      4,
    ],
    [
      'BOOLEAN false',
      CoachProfileAcquisitionField.CARDIO_AVAILABILITY,
      CoachProfileValueType.BOOLEAN,
      (service: CoachProfileAcquisitionProjectionService, projection: ReturnType<CoachProfileAcquisitionProjectionService['project']>) =>
        service.boolean(
          projection,
          CoachProfileAcquisitionField.CARDIO_AVAILABILITY,
        ),
      false,
    ],
    [
      'non-empty TEXT_LIST',
      CoachProfileAcquisitionField.ALLERGIES,
      CoachProfileValueType.TEXT_LIST,
      (service: CoachProfileAcquisitionProjectionService, projection: ReturnType<CoachProfileAcquisitionProjectionService['project']>) =>
        service.textList(projection, CoachProfileAcquisitionField.ALLERGIES),
      ['amendoim'],
    ],
  ] as const)(
    'uses the active confirmed canonical %s value instead of an inactive conflict',
    (_label, field, valueType, read, currentValue) => {
      const service = new CoachProfileAcquisitionProjectionService();
      const projection = service.project([
        fieldValue(field, valueType, {
          id: `${field}-historical-conflict`,
          textValue: valueType === CoachProfileValueType.TEXT ? 'obsolete' : null,
          integerValue: valueType === CoachProfileValueType.INTEGER ? 9 : null,
          booleanValue: valueType === CoachProfileValueType.BOOLEAN ? true : null,
          textListValue:
            valueType === CoachProfileValueType.TEXT_LIST ? ['obsolete'] : [],
          status: CoachProfileValueStatus.CONFLICTED,
          source: CoachProfileValueSource.USER_ANSWER,
          confirmationState: CoachProfileConfirmationState.PENDING,
          isActive: false,
          confirmedAt: null,
        }),
        fieldValue(field, valueType, {
          textValue: valueType === CoachProfileValueType.TEXT ? 'running' : null,
          textListValue:
            valueType === CoachProfileValueType.TEXT_LIST ? ['amendoim'] : [],
        }),
      ]);

      expect(read(service, projection)).toMatchObject({
        status: COACH_PROFILE_KNOWLEDGE_STATUS.KNOWN,
        value: currentValue,
      });
    },
  );

  it('does not make an active invalidation available through its old confirmed absence', () => {
    const service = new CoachProfileAcquisitionProjectionService();
    const field = CoachProfileAcquisitionField.PHYSICAL_LIMITATIONS;
    const projection = service.project([
      textListRecord(field, {
        id: 'physical-limitations-old-confirmed',
        isActive: false,
      }),
      textListRecord(field, {
        id: 'physical-limitations-invalidated',
        textListValue: null,
        valueFingerprint: null,
        status: CoachProfileValueStatus.INVALIDATED,
        confirmationState: CoachProfileConfirmationState.CONFIRMED,
        isActive: true,
        confirmedAt: null,
        invalidatedAt: new Date('2026-08-10T12:00:00.000Z'),
      }),
    ]);

    expect(service.textList(projection, field)).toMatchObject({
      status: COACH_PROFILE_KNOWLEDGE_STATUS.UNKNOWN,
    });
  });

  it('uses a historical conflict only when no active canonical value exists', () => {
    const service = new CoachProfileAcquisitionProjectionService();
    const field = CoachProfileAcquisitionField.TRAINING_MODALITY;
    const projection = service.project([
      fieldValue(field, CoachProfileValueType.TEXT, {
        id: 'first-conflict',
        textValue: 'gym',
        status: CoachProfileValueStatus.CONFLICTED,
        isActive: false,
        confirmedAt: null,
      }),
      fieldValue(field, CoachProfileValueType.TEXT, {
        id: 'latest-conflict',
        textValue: 'running',
        status: CoachProfileValueStatus.CONFLICTED,
        isActive: false,
        confirmedAt: null,
      }),
    ]);

    expect(service.text(projection, field)).toMatchObject({
      status: COACH_PROFILE_KNOWLEDGE_STATUS.REQUIRES_CONFIRMATION,
      value: 'gym',
    });
  });

  it('requires confirmation for an active correction until it is confirmed', () => {
    const service = new CoachProfileAcquisitionProjectionService();
    const field = CoachProfileAcquisitionField.TRAINING_MODALITY;
    const projection = service.project([
      fieldValue(field, CoachProfileValueType.TEXT, {
        id: 'old-confirmed',
        textValue: 'gym',
        isActive: false,
      }),
      fieldValue(field, CoachProfileValueType.TEXT, {
        id: 'new-unconfirmed',
        textValue: 'running',
        status: CoachProfileValueStatus.ANSWERED_UNCONFIRMED,
        source: CoachProfileValueSource.USER_ANSWER,
        confirmationState: CoachProfileConfirmationState.PENDING,
        confirmedAt: null,
      }),
    ]);

    expect(service.text(projection, field)).toMatchObject({
      status: COACH_PROFILE_KNOWLEDGE_STATUS.REQUIRES_CONFIRMATION,
      value: 'running',
    });
  });

  it('uses the newly confirmed correction as the canonical value', () => {
    const service = new CoachProfileAcquisitionProjectionService();
    const field = CoachProfileAcquisitionField.TRAINING_MODALITY;
    const projection = service.project([
      fieldValue(field, CoachProfileValueType.TEXT, {
        id: 'old-confirmed',
        textValue: 'gym',
        isActive: false,
      }),
      fieldValue(field, CoachProfileValueType.TEXT, {
        id: 'new-confirmed',
        textValue: 'running',
      }),
    ]);

    expect(service.text(projection, field)).toMatchObject({
      status: COACH_PROFILE_KNOWLEDGE_STATUS.KNOWN,
      value: 'running',
    });
  });
});
