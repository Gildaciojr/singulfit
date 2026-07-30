import { Injectable } from '@nestjs/common';
import type { CoachProfileSnapshot } from '../../context/coach-profile-snapshot.contract';
import type { WorkoutPlanningReadiness } from './workout-planning-artifact.contract';
import type { WorkoutSafetyGateResult } from './workout-planning-generation.contract';
import type { WorkoutPlanValidationResult } from './workout-plan-v2.contract';

@Injectable()
export class WorkoutPlanningSafetyService {
  evaluateBeforeGeneration(
    snapshot: CoachProfileSnapshot,
    readiness: WorkoutPlanningReadiness,
  ): WorkoutSafetyGateResult {
    const flags = readiness.safetyFlags;
    const blocked = flags.filter((flag) =>
      [
        'ACUTE_PAIN',
        'FEVER',
        'SIGNIFICANT_MALAISE',
        'REPORTED_INCAPACITY',
        'EXTREME_REQUEST',
        'REHABILITATION_REQUEST',
      ].includes(flag),
    );
    if (blocked.length > 0 || readiness.status === 'BLOCKED') {
      return Object.freeze({
        outcome: 'BLOCKED',
        reasonCodes: Object.freeze(
          blocked.length > 0 ? blocked : ['READINESS_BLOCKED'],
        ),
      });
    }
    if (flags.includes('RECENT_INJURY') || flags.includes('CLINICAL_CONTEXT')) {
      return Object.freeze({
        outcome: 'PROFESSIONAL_REVIEW_RECOMMENDED',
        reasonCodes: Object.freeze(flags),
      });
    }
    if (
      readiness.status === 'REQUIRES_CONFIRMATION' ||
      snapshot.conflicts.length > 0
    ) {
      return Object.freeze({
        outcome: 'REQUIRES_CONFIRMATION',
        reasonCodes: Object.freeze(
          flags.length > 0 ? flags : ['PROFILE_CONFIRMATION_REQUIRED'],
        ),
      });
    }
    if (
      flags.includes('INSUFFICIENT_RECOVERY') ||
      flags.includes('RETURN_AFTER_LONG_PAUSE')
    ) {
      return Object.freeze({
        outcome: 'LIMITED',
        reasonCodes: Object.freeze(flags),
      });
    }
    return Object.freeze({
      outcome: 'ALLOWED',
      reasonCodes: Object.freeze(['NO_SAFETY_RESTRICTION']),
    });
  }

  evaluateAfterGeneration(
    validation: WorkoutPlanValidationResult,
  ): WorkoutSafetyGateResult {
    return validation.status === 'INVALID'
      ? Object.freeze({
          outcome: 'BLOCKED',
          reasonCodes: Object.freeze(['POST_GENERATION_VALIDATION_FAILED']),
        })
      : Object.freeze({
          outcome: 'ALLOWED',
          reasonCodes: Object.freeze(['NO_SAFETY_RESTRICTION']),
        });
  }
}
