import { Injectable } from '@nestjs/common';
import type { CoachProfileSnapshot } from '../../context/coach-profile-snapshot.contract';
import {
  WORKOUT_ARTIFACT_TYPE,
  WORKOUT_MODALITY,
  type WorkoutArtifactType,
  type WorkoutModality,
  type WorkoutPlanningReadiness,
  type WorkoutReadinessField,
  type WorkoutSafetyFlag,
} from './workout-planning-artifact.contract';
import type {
  WorkoutPlanningValue,
  WorkoutRecognizedContext,
} from './workout-planning-context.contract';

@Injectable()
export class WorkoutPlanningReadinessService {
  evaluate(
    snapshot: CoachProfileSnapshot,
    artifactType: WorkoutArtifactType,
    modality: WorkoutModality,
    recognized: WorkoutRecognizedContext,
    previousPlanAvailable: boolean,
  ): WorkoutPlanningReadiness {
    const requiredFields = this.requiredFields(artifactType, modality);
    const availableFields: WorkoutReadinessField[] = [];
    const missingFields: WorkoutReadinessField[] = [];
    const confirmationRequiredFields: WorkoutReadinessField[] = [];
    for (const field of requiredFields) {
      const state = this.fieldState(
        snapshot,
        recognized,
        field,
        previousPlanAvailable,
      );
      if (state === 'AVAILABLE') availableFields.push(field);
      if (state === 'MISSING') missingFields.push(field);
      if (state === 'CONFIRMATION') confirmationRequiredFields.push(field);
    }
    if (
      modality === WORKOUT_MODALITY.CYCLING &&
      !this.availableEquipment(snapshot, recognized).includes('BIKE')
    ) {
      this.markMissing('EQUIPMENT', availableFields, missingFields);
    }
    if (
      modality === WORKOUT_MODALITY.CROSSFIT &&
      this.trainingEnvironment(snapshot, recognized) !== 'CROSSFIT_BOX'
    ) {
      this.markMissing('ENVIRONMENT', availableFields, missingFields);
    }

    const safetyFlags: WorkoutSafetyFlag[] = [
      ...(recognized.safetySignals ?? []),
    ];
    if (snapshot.conflicts.length > 0) safetyFlags.push('PROFILE_CONFLICT');
    if (
      snapshot.restrictions.physicalLimitations.status ===
      'REQUIRES_CONFIRMATION'
    ) {
      safetyFlags.push('UNCONFIRMED_LIMITATION');
    }
    if (
      modality === WORKOUT_MODALITY.CROSSFIT &&
      this.fieldState(
        snapshot,
        recognized,
        'EXPERIENCE',
        previousPlanAvailable,
      ) !== 'AVAILABLE'
    ) {
      safetyFlags.push('TECHNICAL_MODALITY_WITHOUT_READINESS');
    }

    const blockingSafety = safetyFlags.some((flag) =>
      [
        'ACUTE_PAIN',
        'FEVER',
        'SIGNIFICANT_MALAISE',
        'REPORTED_INCAPACITY',
        'EXTREME_REQUEST',
        'REHABILITATION_REQUEST',
      ].includes(flag),
    );
    const status = blockingSafety
      ? 'BLOCKED'
      : missingFields.length > 0
        ? 'BLOCKED'
        : confirmationRequiredFields.length > 0 ||
            safetyFlags.includes('UNCONFIRMED_LIMITATION')
          ? 'REQUIRES_CONFIRMATION'
          : safetyFlags.length > 0
            ? 'READY_WITH_LIMITS'
            : 'READY';
    return Object.freeze({
      artifactType,
      modality,
      status,
      executionLevel:
        status === 'READY'
          ? 'FULL_PLAN'
          : status === 'READY_WITH_LIMITS'
            ? 'LIMITED_GUIDANCE'
            : status === 'REQUIRES_CONFIRMATION'
              ? 'CLARIFICATION_ONLY'
              : 'NO_EXECUTION',
      requiredFields: Object.freeze(requiredFields),
      availableFields: Object.freeze(availableFields),
      missingFields: Object.freeze(missingFields),
      confirmationRequiredFields: Object.freeze(confirmationRequiredFields),
      safetyFlags: Object.freeze([...new Set(safetyFlags)]),
    });
  }

  private requiredFields(
    artifact: WorkoutArtifactType,
    modality: WorkoutModality,
  ): WorkoutReadinessField[] {
    if (artifact === WORKOUT_ARTIFACT_TYPE.POINT_GUIDANCE) {
      return ['MODALITY', 'PHYSICAL_LIMITATIONS'];
    }
    if (
      artifact === WORKOUT_ARTIFACT_TYPE.PLAN_REVIEW ||
      artifact === WORKOUT_ARTIFACT_TYPE.PLAN_ADAPTATION ||
      artifact === WORKOUT_ARTIFACT_TYPE.EXERCISE_SUBSTITUTION ||
      artifact === WORKOUT_ARTIFACT_TYPE.CURRENT_PLAN_PRESENTATION
    ) {
      return ['MODALITY', 'PHYSICAL_LIMITATIONS', 'CURRENT_PLAN'];
    }
    const fields: WorkoutReadinessField[] = [
      'OBJECTIVE',
      'MODALITY',
      'SESSION_DURATION',
      'ENVIRONMENT',
      'PHYSICAL_LIMITATIONS',
    ];
    if (
      modality !== WORKOUT_MODALITY.RUNNING &&
      modality !== WORKOUT_MODALITY.WALKING
    ) {
      fields.push('EQUIPMENT');
    }
    if (artifact === WORKOUT_ARTIFACT_TYPE.WEEKLY_PLAN) {
      fields.push('EXPERIENCE', 'WEEKLY_FREQUENCY');
    }
    if (
      modality === WORKOUT_MODALITY.RUNNING ||
      modality === WORKOUT_MODALITY.CYCLING ||
      modality === WORKOUT_MODALITY.CROSSFIT
    ) {
      if (!fields.includes('EXPERIENCE')) fields.push('EXPERIENCE');
      fields.push('PERCEIVED_CONDITIONING');
    }
    return fields;
  }

  private fieldState(
    snapshot: CoachProfileSnapshot,
    recognized: WorkoutRecognizedContext,
    field: WorkoutReadinessField,
    previousPlanAvailable: boolean,
  ): 'AVAILABLE' | 'MISSING' | 'CONFIRMATION' {
    if (field === 'CURRENT_PLAN') {
      return previousPlanAvailable ? 'AVAILABLE' : 'MISSING';
    }
    if (field === 'PHYSICAL_LIMITATIONS') {
      const datum = snapshot.restrictions.physicalLimitations;
      if (!('value' in datum)) return 'MISSING';
      return datum.status === 'REQUIRES_CONFIRMATION'
        ? 'CONFIRMATION'
        : 'AVAILABLE';
    }
    const values: Readonly<
      Partial<Record<WorkoutReadinessField, WorkoutPlanningValue<unknown>>>
    > = {
      OBJECTIVE: recognized.objective,
      MODALITY: recognized.modality,
      EXPERIENCE: recognized.experience,
      WEEKLY_FREQUENCY: recognized.weeklyFrequency,
      SESSION_DURATION: recognized.sessionDurationMinutes,
      ENVIRONMENT: recognized.environment,
      EQUIPMENT: recognized.equipment,
      PERCEIVED_CONDITIONING: recognized.perceivedConditioning,
    };
    const datum = values[field];
    if (datum && datum.status !== 'NOT_SET') {
      return datum.status === 'REQUIRES_CONFIRMATION'
        ? 'CONFIRMATION'
        : 'AVAILABLE';
    }
    const snapshotDatum = this.snapshotDatum(snapshot, field);
    if (
      !snapshotDatum ||
      snapshotDatum.status === 'UNKNOWN' ||
      snapshotDatum.status === 'NOT_APPLICABLE'
    ) {
      return 'MISSING';
    }
    return snapshotDatum.status === 'REQUIRES_CONFIRMATION'
      ? 'CONFIRMATION'
      : 'AVAILABLE';
  }

  private snapshotDatum(
    snapshot: CoachProfileSnapshot,
    field: WorkoutReadinessField,
  ) {
    switch (field) {
      case 'OBJECTIVE':
        return snapshot.training.primaryGoal;
      case 'MODALITY':
        return snapshot.training.preferredModality;
      case 'EXPERIENCE':
        return snapshot.training.experienceLevel;
      case 'WEEKLY_FREQUENCY':
        return snapshot.training.weeklyFrequency;
      case 'SESSION_DURATION':
        return snapshot.training.sessionDurationMinutes;
      case 'ENVIRONMENT':
        return snapshot.training.environment;
      case 'EQUIPMENT':
        return snapshot.training.availableEquipment;
      case 'PERCEIVED_CONDITIONING':
        return snapshot.training.perceivedConditioning;
      default:
        return null;
    }
  }

  private availableEquipment(
    snapshot: CoachProfileSnapshot,
    recognized: WorkoutRecognizedContext,
  ): readonly string[] {
    if (recognized.equipment && recognized.equipment.status !== 'NOT_SET') {
      return recognized.equipment.value;
    }
    const datum = snapshot.training.availableEquipment;
    return 'value' in datum ? datum.value : Object.freeze([]);
  }

  private trainingEnvironment(
    snapshot: CoachProfileSnapshot,
    recognized: WorkoutRecognizedContext,
  ): string | null {
    if (recognized.environment && recognized.environment.status !== 'NOT_SET') {
      return recognized.environment.value;
    }
    const datum = snapshot.training.environment;
    return 'value' in datum ? datum.value : null;
  }

  private markMissing(
    field: WorkoutReadinessField,
    available: WorkoutReadinessField[],
    missing: WorkoutReadinessField[],
  ): void {
    const index = available.indexOf(field);
    if (index >= 0) available.splice(index, 1);
    if (!missing.includes(field)) missing.push(field);
  }
}
