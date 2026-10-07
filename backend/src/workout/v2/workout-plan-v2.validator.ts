import { Injectable } from '@nestjs/common';
import { WorkoutWeekday } from '@prisma/client';
import { workoutCandidatePublicTextIssues } from './workout-public-text.policy';
import { projectWorkoutRepetitions } from './workout-public-projection';
import { workoutModalityPlanIssues } from './workout-modality-expertise.policy';
import {
  estimateWorkoutSession,
  mandatoryWorkoutBlockMinutes,
} from './workout-duration-estimator';
import {
  hasInvalidWorkoutActivityName,
  workoutWeeklyRecoveryIssues,
  workoutStructuralActivityIssue,
} from './workout-plan-v2-quality.policy';
import { WORKOUT_MODALITY } from './workout-planning-artifact.contract';
import type {
  GeneratedWorkoutPlanV2Candidate,
  WorkoutActivityV2,
  WorkoutPlanValidationIssue,
  WorkoutPlanValidationResult,
} from './workout-plan-v2.contract';
import type { WorkoutPlanningContext } from './workout-planning-context.contract';
import type { WorkoutPlanningStrategy } from './workout-planning-strategy.contract';

@Injectable()
export class WorkoutPlanV2Validator {
  validate(
    candidate: GeneratedWorkoutPlanV2Candidate,
    context: WorkoutPlanningContext,
    strategy: WorkoutPlanningStrategy,
    requireWeekdays = false,
    validatePublicText = requireWeekdays,
  ): WorkoutPlanValidationResult {
    const issues: WorkoutPlanValidationIssue[] = [
      ...workoutModalityPlanIssues(candidate, strategy),
      ...(validatePublicText
        ? workoutCandidatePublicTextIssues(candidate, strategy)
        : []),
    ];
    if (candidate.artifactType !== strategy.artifactType)
      this.add(issues, 'ARTIFACT_MISMATCH', 'ERROR', 'artifactType');
    if (candidate.modality !== strategy.modality)
      this.add(issues, 'MODALITY_MISMATCH', 'ERROR', 'modality');
    if (
      (strategy.objective.status !== 'NOT_SET' &&
        candidate.objective !== strategy.objective.value) ||
      strategy.secondaryObjectives.some(
        (objective) => !candidate.secondaryObjectives?.includes(objective),
      )
    )
      this.add(issues, 'OBJECTIVE_MISMATCH', 'ERROR', 'objective');
    if (candidate.sessions.length !== strategy.sessionCount)
      this.add(issues, 'SESSION_COUNT_MISMATCH', 'ERROR', 'sessions');
    const schedule = context.training.scheduledTrainingDays;
    const prescribed =
      schedule?.status === 'CONFIRMED' ? schedule.value : undefined;
    if (
      requireWeekdays &&
      prescribed &&
      (prescribed.length !== candidate.sessions.length ||
        prescribed.some(
          (day) =>
            !candidate.sessions.some((session) => session.weekday === day),
        ))
    )
      this.add(issues, 'WEEKDAY_UNAVAILABLE', 'ERROR', 'sessions');
    const keys = new Set<string>();
    const activities = new Map<string, WorkoutActivityV2>();
    const weekdays = new Set<string>();
    for (const session of candidate.sessions) {
      if (requireWeekdays && !session.weekday)
        this.add(issues, 'WEEKDAY_REQUIRED', 'ERROR', session.sessionKey);
      if (session.weekday) {
        if (!Object.values(WorkoutWeekday).includes(session.weekday))
          this.add(issues, 'INVALID_PARAMETER', 'ERROR', session.sessionKey);
        if (weekdays.has(session.weekday))
          this.add(issues, 'DUPLICATE_WEEKDAY', 'ERROR', session.sessionKey);
        weekdays.add(session.weekday);
        const available = context.training.availableTrainingDays;
        if (
          available.status === 'CONFIRMED' &&
          !available.value.includes(session.weekday)
        )
          this.add(issues, 'WEEKDAY_UNAVAILABLE', 'ERROR', session.sessionKey);
      }
      this.unique(keys, session.sessionKey, issues);
      const estimate = estimateWorkoutSession(session);
      if (strategy.sessionDurationMinutes.status !== 'NOT_SET') {
        const target = strategy.sessionDurationMinutes.value;
        const tooShort = estimate.maximumMinutes < target * 0.8;
        const tooLong = estimate.minimumMinutes > target * 1.2;
        if (estimate.confidence === 'LOW')
          this.add(
            issues,
            'SESSION_DURATION_UNCERTAIN',
            'WARNING',
            session.sessionKey,
          );
        if (tooShort || tooLong) {
          this.add(
            issues,
            tooShort ? 'SESSION_CONTENT_TOO_SHORT' : 'SESSION_CONTENT_TOO_LONG',
            'WARNING',
            session.sessionKey,
          );
        }
      }
      const blockTotal = session.blocks.reduce(
        (sum, block) => sum + block.estimatedDurationMinutes,
        0,
      );
      const mandatory = session.blocks.reduce(
        (sum, block) => sum + mandatoryWorkoutBlockMinutes(block),
        0,
      );
      if (
        mandatory > session.estimatedDurationMinutes ||
        (strategy.sessionDurationMinutes.status !== 'NOT_SET' &&
          mandatory > strategy.sessionDurationMinutes.value)
      )
        this.add(
          issues,
          'SESSION_DURATION_EXCEEDED',
          'ERROR',
          session.sessionKey,
        );
      if (
        Math.abs(blockTotal - session.estimatedDurationMinutes) >
        Math.max(5, session.estimatedDurationMinutes * 0.25)
      )
        this.add(
          issues,
          'BLOCK_DURATION_INCOHERENT',
          'WARNING',
          session.sessionKey,
        );
      if (
        strategy.sessionDurationMinutes.status !== 'NOT_SET' &&
        session.estimatedDurationMinutes > strategy.sessionDurationMinutes.value
      )
        this.add(
          issues,
          'SESSION_DURATION_EXCEEDED',
          'ERROR',
          session.sessionKey,
        );
      for (const block of session.blocks) {
        const work = block.work;
        if (
          work &&
          (work.movementActivityKeys.length !== block.activities.length ||
            new Set(work.movementActivityKeys).size !==
              work.movementActivityKeys.length ||
            work.movementActivityKeys.some(
              (key) =>
                !block.activities.some(
                  (activity) => activity.activityKey === key,
                ),
            ) ||
            (work.format === 'EMOM' &&
              (work.intervalSeconds !== 60 ||
                work.rounds === null ||
                work.rounds * 60 !== work.durationSeconds)) ||
            (work.format === 'INTERVAL' &&
              (work.intervalSeconds === null ||
                work.rounds === null ||
                work.intervalSeconds * work.rounds !== work.durationSeconds)))
        )
          this.add(issues, 'WORK_STRUCTURE_INVALID', 'ERROR', block.blockKey);
        this.unique(keys, block.blockKey, issues);
        if (block.activities.length === 0)
          this.add(issues, 'EMPTY_BLOCK', 'ERROR', block.blockKey);
        if (
          mandatoryWorkoutBlockMinutes(block) > block.estimatedDurationMinutes
        )
          this.add(
            issues,
            'SESSION_DURATION_EXCEEDED',
            'ERROR',
            block.blockKey,
          );
        for (const activity of block.activities) {
          if (
            validatePublicText &&
            activity.kind === 'STRENGTH' &&
            projectWorkoutRepetitions(activity.repetitions) === null
          )
            this.add(
              issues,
              'PUBLIC_REPETITIONS_REQUIRED',
              'ERROR',
              activity.activityKey,
            );
          if (validatePublicText && activity.kind !== 'ENDURANCE') {
            if (!activity.publicIdentity)
              this.add(
                issues,
                'PUBLIC_IDENTITY_REQUIRED',
                'ERROR',
                activity.activityKey,
              );
            else if (
              activity.movementPattern === 'OTHER' &&
              activity.publicIdentity.jointAction === null
            )
              this.add(
                issues,
                'PUBLIC_IDENTITY_INCOMPLETE',
                'ERROR',
                activity.activityKey,
              );
          }
          this.unique(keys, activity.activityKey, issues);
          activities.set(activity.activityKey, activity);
          this.activity(activity, context, strategy, issues);
        }
      }
    }
    for (const substitution of candidate.substitutions) {
      const source = activities.get(substitution.sourceActivityKey);
      const alternative = activities.get(substitution.alternativeActivityKey);
      if (!source || !alternative)
        this.add(
          issues,
          'SUBSTITUTION_REFERENCE_INVALID',
          'ERROR',
          substitution.substitutionKey,
        );
      else if (
        !substitution.functionPreserved ||
        source.movementPattern !== alternative.movementPattern
      )
        this.add(
          issues,
          'SUBSTITUTION_FUNCTION_MISMATCH',
          'ERROR',
          substitution.substitutionKey,
        );
    }
    issues.push(...workoutWeeklyRecoveryIssues(candidate, context));
    const status = issues.some((issue) => issue.severity === 'ERROR')
      ? 'INVALID'
      : issues.length
        ? 'VALID_WITH_WARNINGS'
        : 'VALID';
    return Object.freeze({
      status,
      issues: Object.freeze(issues.map((issue) => Object.freeze(issue))),
    });
  }
  private activity(
    activity: WorkoutActivityV2,
    context: WorkoutPlanningContext,
    strategy: WorkoutPlanningStrategy,
    issues: WorkoutPlanValidationIssue[],
  ): void {
    const structural = workoutStructuralActivityIssue(activity);
    if (structural) issues.push(structural);
    if (hasInvalidWorkoutActivityName(activity.name))
      this.add(issues, 'ACTIVITY_NAME_INVALID', 'ERROR', activity.activityKey);
    for (const equipment of activity.equipment)
      if (!strategy.authorizedEquipment.includes(equipment))
        this.add(
          issues,
          'EQUIPMENT_UNAVAILABLE',
          'ERROR',
          activity.activityKey,
        );
    if (
      !strategy.technicalMovementsAllowed &&
      /(snatch|clean|jerk|muscle.?up|handstand)/i.test(activity.name)
    )
      this.add(
        issues,
        'TECHNICAL_MOVEMENT_UNSAFE',
        'ERROR',
        activity.activityKey,
      );
    if (
      strategy.experience.status !== 'NOT_SET' &&
      strategy.experience.value === 'BEGINNER' &&
      'intensity' in activity &&
      activity.intensity === 'HIGH'
    )
      this.add(issues, 'INTENSITY_EXCESSIVE', 'ERROR', activity.activityKey);
    for (const constraint of context.movementConstraints) {
      const conflict =
        (constraint.code === 'KNEE_LOAD' &&
          (activity.movementPattern === 'SQUAT' ||
            /(corrida|salto|lunge|agachamento)/i.test(activity.name))) ||
        (constraint.code === 'OVERHEAD' &&
          /overhead|desenvolvimento|snatch/i.test(activity.name)) ||
        (constraint.code === 'SPINAL_LOAD' &&
          /levantamento terra|deadlift/i.test(activity.name));
      if (conflict)
        this.add(issues, 'LIMITATION_CONFLICT', 'ERROR', activity.activityKey);
    }
    if (
      strategy.modality === WORKOUT_MODALITY.RUNNING &&
      strategy.experience.status !== 'NOT_SET' &&
      strategy.experience.value === 'BEGINNER' &&
      activity.kind === 'ENDURANCE' &&
      activity.intensity === 'HIGH'
    )
      this.add(issues, 'INTENSITY_EXCESSIVE', 'ERROR', activity.activityKey);
  }
  private unique(
    keys: Set<string>,
    key: string,
    issues: WorkoutPlanValidationIssue[],
  ): void {
    if (keys.has(key)) this.add(issues, 'DUPLICATE_KEY', 'ERROR', key);
    keys.add(key);
  }
  private add(
    issues: WorkoutPlanValidationIssue[],
    code: WorkoutPlanValidationIssue['code'],
    severity: WorkoutPlanValidationIssue['severity'],
    path: string,
  ): void {
    issues.push({ code, severity, path });
  }
}
