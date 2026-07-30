import { Injectable } from '@nestjs/common';
import {
  CoachProfileAcquisitionField,
  CoachProfileFieldValue,
  CoachProfileValueStatus,
  CoachProfileValueType,
} from '@prisma/client';
import {
  COACH_PROFILE_DATA_SOURCE,
  COACH_PROFILE_KNOWLEDGE_STATUS,
  CoachProfileDatum,
} from '../coach-profile-snapshot.contract';
import type { RecognizedProfileValue } from './profile-acquisition.contract';

export type CoachProfileAcquisitionProjection = Readonly<
  Partial<
    Record<
      CoachProfileAcquisitionField,
      CoachProfileDatum<RecognizedProfileValue>
    >
  >
>;

@Injectable()
export class CoachProfileAcquisitionProjectionService {
  project(
    records: readonly CoachProfileFieldValue[],
  ): CoachProfileAcquisitionProjection {
    const grouped = new Map<
      CoachProfileAcquisitionField,
      CoachProfileFieldValue[]
    >();
    for (const record of records) {
      const values = grouped.get(record.field) ?? [];
      values.push(record);
      grouped.set(record.field, values);
    }
    const projection: Partial<
      Record<
        CoachProfileAcquisitionField,
        CoachProfileDatum<RecognizedProfileValue>
      >
    > = {};
    for (const [field, values] of grouped) {
      const selected =
        values.find(
          (value) => value.status === CoachProfileValueStatus.CONFLICTED,
        ) ?? values.find((value) => value.isActive);
      if (selected) projection[field] = this.datum(selected);
    }
    return Object.freeze(projection);
  }

  text(
    projection: CoachProfileAcquisitionProjection,
    field: CoachProfileAcquisitionField,
  ): CoachProfileDatum<string> {
    const datum = projection[field];
    if (datum && 'value' in datum && typeof datum.value === 'string') {
      return Object.freeze({
        status: datum.status,
        value: datum.value,
        sources: datum.sources,
      });
    }
    return this.unavailable(datum);
  }

  integer(
    projection: CoachProfileAcquisitionProjection,
    field: CoachProfileAcquisitionField,
  ): CoachProfileDatum<number> {
    const datum = projection[field];
    if (datum && 'value' in datum && typeof datum.value === 'number') {
      return Object.freeze({
        status: datum.status,
        value: datum.value,
        sources: datum.sources,
      });
    }
    return this.unavailable(datum);
  }

  boolean(
    projection: CoachProfileAcquisitionProjection,
    field: CoachProfileAcquisitionField,
  ): CoachProfileDatum<boolean> {
    const datum = projection[field];
    if (datum && 'value' in datum && typeof datum.value === 'boolean') {
      return Object.freeze({
        status: datum.status,
        value: datum.value,
        sources: datum.sources,
      });
    }
    return this.unavailable(datum);
  }

  textList(
    projection: CoachProfileAcquisitionProjection,
    field: CoachProfileAcquisitionField,
  ): CoachProfileDatum<readonly string[]> {
    const datum = projection[field];
    if (
      datum &&
      'value' in datum &&
      Array.isArray(datum.value) &&
      datum.value.every((value) => typeof value === 'string')
    ) {
      return Object.freeze({
        ...datum,
        value: Object.freeze([...datum.value]),
      });
    }
    return this.unavailable(datum);
  }

  private datum(
    record: CoachProfileFieldValue,
  ): CoachProfileDatum<RecognizedProfileValue> {
    const sources = Object.freeze([
      COACH_PROFILE_DATA_SOURCE.PROFILE_ACQUISITION,
    ]);
    if (record.status === CoachProfileValueStatus.NOT_APPLICABLE) {
      return Object.freeze({
        status: COACH_PROFILE_KNOWLEDGE_STATUS.NOT_APPLICABLE,
        sources,
      });
    }
    const value = this.value(record);
    if (value === undefined) {
      return Object.freeze({
        status: COACH_PROFILE_KNOWLEDGE_STATUS.UNKNOWN,
        sources,
      });
    }
    const status =
      record.status === CoachProfileValueStatus.CONFIRMED
        ? COACH_PROFILE_KNOWLEDGE_STATUS.KNOWN
        : record.status === CoachProfileValueStatus.INFERRED
          ? COACH_PROFILE_KNOWLEDGE_STATUS.INFERRED
          : COACH_PROFILE_KNOWLEDGE_STATUS.REQUIRES_CONFIRMATION;
    return Object.freeze({ status, value, sources });
  }

  private value(
    record: CoachProfileFieldValue,
  ): RecognizedProfileValue | undefined {
    if (
      record.valueType === CoachProfileValueType.TEXT &&
      record.textValue !== null
    ) {
      return record.textValue;
    }
    if (
      record.valueType === CoachProfileValueType.INTEGER &&
      record.integerValue !== null
    ) {
      return record.integerValue;
    }
    if (
      record.valueType === CoachProfileValueType.BOOLEAN &&
      record.booleanValue !== null
    ) {
      return record.booleanValue;
    }
    if (
      record.valueType === CoachProfileValueType.TEXT_LIST &&
      Array.isArray(record.textListValue) &&
      record.textListValue.every((value) => typeof value === 'string')
    ) {
      return Object.freeze([...record.textListValue]);
    }
    return undefined;
  }

  private unavailable<T>(
    datum: CoachProfileDatum<RecognizedProfileValue> | undefined,
  ): CoachProfileDatum<T> {
    if (datum?.status === COACH_PROFILE_KNOWLEDGE_STATUS.NOT_APPLICABLE) {
      return Object.freeze({
        status: COACH_PROFILE_KNOWLEDGE_STATUS.NOT_APPLICABLE,
        sources: datum.sources,
      });
    }
    return Object.freeze({
      status: COACH_PROFILE_KNOWLEDGE_STATUS.UNKNOWN,
      sources: datum?.sources ?? Object.freeze([]),
    });
  }
}
