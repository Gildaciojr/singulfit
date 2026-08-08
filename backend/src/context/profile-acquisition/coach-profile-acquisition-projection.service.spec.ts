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
});
