import { Injectable } from '@nestjs/common';
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
  ): WorkoutPlanValidationResult {
    const issues: WorkoutPlanValidationIssue[] = [];
    if (candidate.artifactType !== strategy.artifactType)
      this.add(issues, 'ARTIFACT_MISMATCH', 'ERROR', 'artifactType');
    if (candidate.modality !== strategy.modality)
      this.add(issues, 'MODALITY_MISMATCH', 'ERROR', 'modality');
    if (candidate.sessions.length !== strategy.sessionCount)
      this.add(issues, 'SESSION_COUNT_MISMATCH', 'ERROR', 'sessions');
    const keys = new Set<string>();
    const activities = new Map<string, WorkoutActivityV2>();
    for (const session of candidate.sessions) {
      this.unique(keys, session.sessionKey, issues);
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
      if (
        session.blocks.reduce(
          (sum, block) => sum + block.activities.length,
          0,
        ) > strategy.maximumActivitiesPerSession
      )
        this.add(issues, 'VOLUME_EXCESSIVE', 'ERROR', session.sessionKey);
      for (const required of strategy.requiredBlocks)
        if (!session.blocks.some((block) => block.type === required))
          this.add(
            issues,
            'REQUIRED_BLOCK_MISSING',
            'ERROR',
            `${session.sessionKey}.${required}`,
          );
      for (const block of session.blocks) {
        this.unique(keys, block.blockKey, issues);
        if (block.activities.length === 0)
          this.add(issues, 'EMPTY_BLOCK', 'ERROR', block.blockKey);
        for (const activity of block.activities) {
          this.unique(keys, activity.activityKey, issues);
          activities.set(activity.activityKey, activity);
          this.activity(activity, context, strategy, issues);
        }
      }
    }
    for (const rule of candidate.progression)
      if (
        rule.maximumChangePercent >
        strategy.progressionPolicy.maximumWeeklyIncreasePercent
      )
        this.add(issues, 'AGGRESSIVE_PROGRESSION', 'ERROR', rule.ruleKey);
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
