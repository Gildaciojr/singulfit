import { Injectable } from '@nestjs/common';
import { FitnessGoal } from '@prisma/client';
import type {
  CoachProfileDatum,
  CoachProfileSnapshot,
} from '../../context/coach-profile-snapshot.contract';
import type {
  WorkoutMovementConstraint,
  WorkoutEquipment,
  WorkoutEnvironment,
  WorkoutExperienceLevel,
  WorkoutPlanningContext,
  WorkoutPlanningContextBuilderInput,
  WorkoutPlanningValue,
  WorkoutPreviousPlanSummary,
} from './workout-planning-context.contract';
import type { WorkoutSafetyFlag } from './workout-planning-artifact.contract';

@Injectable()
export class WorkoutPlanningContextBuilder {
  build(input: WorkoutPlanningContextBuilderInput): WorkoutPlanningContext {
    const recognized = input.recognizedContext;
    const movementConstraints = this.constraints(input.snapshot, recognized);
    const profileSafetySignals: WorkoutSafetyFlag[] = [];
    const returningAfterBreak = input.snapshot.training.returningAfterBreak;
    if (
      returningAfterBreak &&
      'value' in returningAfterBreak &&
      returningAfterBreak.value
    ) {
      profileSafetySignals.push('RETURN_AFTER_LONG_PAUSE');
    }
    return Object.freeze({
      schemaVersion: 2,
      artifactType: input.artifactType,
      modality:
        recognized.modality ??
        Object.freeze({ status: 'CONFIRMED', value: input.modality }),
      referenceDate: input.referenceDate.toISOString(),
      profile: Object.freeze({
        fitnessGoal: this.snapshotValue(input.snapshot.nutrition.primaryGoal),
        activityLevel: this.snapshotValue(
          input.snapshot.physical.activityLevel,
        ),
        ageYears: this.snapshotValue(input.snapshot.physical.ageYears),
      }),
      training: Object.freeze({
        objective:
          recognized.objective ??
          this.objectiveFromGoal(input.snapshot.nutrition.primaryGoal),
        experience:
          recognized.experience ??
          this.experience(input.snapshot.training.experienceLevel),
        weeklyFrequency:
          recognized.weeklyFrequency ??
          this.snapshotValue(input.snapshot.training.weeklyFrequency),
        sessionDurationMinutes:
          recognized.sessionDurationMinutes ??
          this.snapshotValue(input.snapshot.training.sessionDurationMinutes),
        environment:
          recognized.environment ??
          this.environment(input.snapshot.training.environment),
        equipment: this.arrayValue(
          recognized.equipment ??
            this.equipment(input.snapshot.training.availableEquipment),
        ),
        perceivedConditioning:
          recognized.perceivedConditioning ??
          this.conditioning(input.snapshot.training.perceivedConditioning),
        intensityPreference:
          recognized.intensityPreference ??
          this.intensity(input.snapshot.training.intensityPreference),
        cardioAvailability: this.optionalSnapshotValue(
          input.snapshot.training.cardioAvailability,
        ),
        formatPreference: this.formatPreference(
          input.snapshot.training.trainingFormatPreference,
        ),
        returningAfterBreak: this.optionalSnapshotValue(
          input.snapshot.training.returningAfterBreak,
        ),
        availableTrainingDays: this.optionalArraySnapshotValue(
          input.snapshot.routine.availableTrainingDays,
        ),
        dailyTrainingWindows: this.optionalArraySnapshotValue(
          input.snapshot.routine.dailyTrainingWindows,
        ),
      }),
      movementConstraints,
      safetySignals: Object.freeze([
        ...new Set([
          ...(recognized.safetySignals ?? []),
          ...profileSafetySignals,
        ]),
      ]),
      progressEvidence: Object.freeze(
        [...(input.progressEvidence ?? [])]
          .sort((left, right) =>
            left.observedAt.localeCompare(right.observedAt),
          )
          .map((evidence) => Object.freeze({ ...evidence })),
      ),
      currentPlanAvailable: 'value' in input.snapshot.plans.currentWorkout,
      previousPlan: input.previousPlan
        ? this.previousPlan(input.previousPlan)
        : null,
      lifecyclePurpose: recognized.purpose ?? 'CREATION',
    });
  }

  private snapshotValue<T>(
    datum: CoachProfileDatum<T>,
  ): WorkoutPlanningValue<T> {
    if (!('value' in datum)) return Object.freeze({ status: 'NOT_SET' });
    return Object.freeze({
      status:
        datum.status === 'KNOWN'
          ? 'CONFIRMED'
          : datum.status === 'INFERRED'
            ? 'INFERRED'
            : 'REQUIRES_CONFIRMATION',
      value: datum.value,
    });
  }

  private optionalSnapshotValue<T>(
    datum: CoachProfileDatum<T> | undefined,
  ): WorkoutPlanningValue<T> {
    return datum
      ? this.snapshotValue(datum)
      : Object.freeze({ status: 'NOT_SET' });
  }

  private optionalArraySnapshotValue<T>(
    datum: CoachProfileDatum<readonly T[]> | undefined,
  ): WorkoutPlanningValue<readonly T[]> {
    if (!datum || !('value' in datum)) {
      return Object.freeze({ status: 'NOT_SET' });
    }
    return Object.freeze({
      status:
        datum.status === 'KNOWN'
          ? 'CONFIRMED'
          : datum.status === 'INFERRED'
            ? 'INFERRED'
            : 'REQUIRES_CONFIRMATION',
      value: Object.freeze([...datum.value]),
    });
  }

  private experience(
    datum: CoachProfileDatum<string>,
  ): WorkoutPlanningValue<WorkoutExperienceLevel> {
    if (!('value' in datum)) return Object.freeze({ status: 'NOT_SET' });
    switch (datum.value) {
      case 'BEGINNER':
      case 'INTERMEDIATE':
      case 'ADVANCED':
        return this.typedSnapshotValue(datum, datum.value);
      default:
        return Object.freeze({ status: 'NOT_SET' });
    }
  }

  private environment(
    datum: CoachProfileDatum<string>,
  ): WorkoutPlanningValue<WorkoutEnvironment> {
    if (!('value' in datum)) return Object.freeze({ status: 'NOT_SET' });
    switch (datum.value) {
      case 'FULL_GYM':
      case 'LIMITED_GYM':
      case 'CROSSFIT_BOX':
      case 'HOME':
      case 'OUTDOOR':
      case 'TRACK':
      case 'TRAIL':
      case 'ROAD':
      case 'INDOOR':
        return this.typedSnapshotValue(datum, datum.value);
      default:
        return Object.freeze({ status: 'NOT_SET' });
    }
  }

  private equipment(
    datum: CoachProfileDatum<readonly string[]>,
  ): WorkoutPlanningValue<readonly WorkoutEquipment[]> {
    if (!('value' in datum)) return Object.freeze({ status: 'NOT_SET' });
    const value = datum.value
      .map((item) => this.equipmentValue(item))
      .filter((item): item is WorkoutEquipment => item !== undefined);
    if (value.length !== datum.value.length) {
      return Object.freeze({ status: 'NOT_SET' });
    }
    return this.typedSnapshotValue(datum, Object.freeze(value));
  }

  private equipmentValue(value: string): WorkoutEquipment | undefined {
    switch (value) {
      case 'BARBELL':
      case 'DUMBBELL':
      case 'KETTLEBELL':
      case 'MACHINE':
      case 'CABLE':
      case 'BENCH':
      case 'PULL_UP_BAR':
      case 'RESISTANCE_BAND':
      case 'BODYWEIGHT':
      case 'BIKE':
      case 'TREADMILL':
      case 'ROW_ERGOMETER':
        return value;
      default:
        return undefined;
    }
  }

  private conditioning(
    datum: CoachProfileDatum<string>,
  ): WorkoutPlanningValue<'LOW' | 'MODERATE' | 'HIGH'> {
    if (!('value' in datum)) return Object.freeze({ status: 'NOT_SET' });
    switch (datum.value) {
      case 'LOW':
      case 'MODERATE':
      case 'HIGH':
        return this.typedSnapshotValue(datum, datum.value);
      default:
        return Object.freeze({ status: 'NOT_SET' });
    }
  }

  private intensity(
    datum: CoachProfileDatum<string>,
  ): WorkoutPlanningValue<'LIGHT' | 'MODERATE' | 'HIGH'> {
    if (!('value' in datum)) return Object.freeze({ status: 'NOT_SET' });
    switch (datum.value) {
      case 'LIGHT':
      case 'MODERATE':
      case 'HIGH':
        return this.typedSnapshotValue(datum, datum.value);
      default:
        return Object.freeze({ status: 'NOT_SET' });
    }
  }

  private formatPreference(
    datum: CoachProfileDatum<string>,
  ): WorkoutPlanningValue<'INDIVIDUAL' | 'GROUP' | 'FLEXIBLE'> {
    if (!('value' in datum)) return Object.freeze({ status: 'NOT_SET' });
    switch (datum.value) {
      case 'INDIVIDUAL':
      case 'GROUP':
      case 'FLEXIBLE':
        return this.typedSnapshotValue(datum, datum.value);
      default:
        return Object.freeze({ status: 'NOT_SET' });
    }
  }

  private typedSnapshotValue<T>(
    datum: {
      readonly status: 'KNOWN' | 'INFERRED' | 'REQUIRES_CONFIRMATION';
    },
    value: T,
  ): WorkoutPlanningValue<T> {
    return Object.freeze({
      status:
        datum.status === 'KNOWN'
          ? 'CONFIRMED'
          : datum.status === 'INFERRED'
            ? 'INFERRED'
            : 'REQUIRES_CONFIRMATION',
      value,
    });
  }

  private arrayValue<T>(
    datum: WorkoutPlanningValue<readonly T[]> | undefined,
  ): WorkoutPlanningValue<readonly T[]> {
    if (!datum || datum.status === 'NOT_SET') {
      return Object.freeze({ status: 'NOT_SET' });
    }
    return Object.freeze({
      status: datum.status,
      value: Object.freeze([...datum.value].sort()),
    });
  }

  private objectiveFromGoal(
    datum: CoachProfileSnapshot['nutrition']['primaryGoal'],
  ): WorkoutPlanningContext['training']['objective'] {
    if (!('value' in datum)) return Object.freeze({ status: 'NOT_SET' });
    const value =
      datum.value === FitnessGoal.WEIGHT_LOSS
        ? 'WEIGHT_LOSS'
        : datum.value === FitnessGoal.MUSCLE_GAIN
          ? 'HYPERTROPHY'
          : 'GENERAL_HEALTH';
    return Object.freeze({
      status: datum.status === 'KNOWN' ? 'CONFIRMED' : 'INFERRED',
      value,
    });
  }

  private constraints(
    snapshot: CoachProfileSnapshot,
    recognized: WorkoutPlanningContextBuilderInput['recognizedContext'],
  ): readonly WorkoutMovementConstraint[] {
    const constraints: WorkoutMovementConstraint[] = [
      ...(recognized.movementConstraints ?? []),
    ];
    const datum = snapshot.restrictions.physicalLimitations;
    if ('value' in datum) {
      for (const limitation of datum.value) {
        const label = limitation.description.trim().slice(0, 160);
        const normalized = this.normalize(label);
        const code = /joelho|patela/.test(normalized)
          ? 'KNEE_LOAD'
          : /lombar|coluna/.test(normalized)
            ? 'SPINAL_LOAD'
            : /ombro|acima da cabeca/.test(normalized)
              ? 'OVERHEAD'
              : 'CUSTOM';
        constraints.push(
          Object.freeze({
            code,
            label,
            status:
              code === 'CUSTOM' || datum.status === 'REQUIRES_CONFIRMATION'
                ? 'REQUIRES_CONFIRMATION'
                : datum.status === 'KNOWN'
                  ? 'CONFIRMED'
                  : 'INFERRED',
          }),
        );
      }
    }
    const unique = new Map<string, WorkoutMovementConstraint>();
    for (const constraint of constraints) {
      unique.set(`${constraint.code}:${constraint.label}`, constraint);
    }
    return Object.freeze(
      [...unique.values()].sort((left, right) =>
        `${left.code}:${left.label}`.localeCompare(
          `${right.code}:${right.label}`,
        ),
      ),
    );
  }

  private previousPlan(
    plan: NonNullable<WorkoutPlanningContextBuilderInput['previousPlan']>,
  ): WorkoutPreviousPlanSummary {
    return Object.freeze({
      artifactType: plan.artifactType,
      modality: plan.modality,
      objective: plan.objective,
      sessionCount: plan.sessions.length,
      sessionLabels: Object.freeze(
        plan.sessions.map((session) => session.label),
      ),
      validationStatus: plan.validation.status,
    });
  }

  private normalize(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  }
}
