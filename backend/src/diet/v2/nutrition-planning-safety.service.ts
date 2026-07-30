import { Injectable } from '@nestjs/common';
import type { CoachProfileSnapshot } from '../../context/coach-profile-snapshot.contract';
import type { NutritionPlanningReadiness } from './nutrition-planning-artifact.contract';
import type {
  NutritionSafetyGateResult,
  NutritionSafetyGateOutcome,
} from './nutrition-planning-generation.contract';
import type { NutritionPlanValidationResult } from './nutrition-plan-v2.contract';

@Injectable()
export class NutritionPlanningSafetyService {
  evaluateBeforeGeneration(
    snapshot: CoachProfileSnapshot,
    readiness: NutritionPlanningReadiness,
  ): NutritionSafetyGateResult {
    const reasons: NutritionSafetyGateResult['reasonCodes'][number][] = [];
    let outcome: NutritionSafetyGateOutcome = 'ALLOWED';

    if (readiness.status === 'BLOCKED') {
      reasons.push('READINESS_BLOCKED');
      outcome = 'BLOCKED';
    }
    if (readiness.status === 'REQUIRES_CONFIRMATION') {
      reasons.push('UNCONFIRMED_CONSTRAINT');
      outcome = 'REQUIRES_CONFIRMATION';
    }
    if (snapshot.conflicts.length > 0) {
      reasons.push('PROFILE_CONFLICT');
      outcome = 'REQUIRES_CONFIRMATION';
    }
    if (
      'value' in snapshot.restrictions.medicalConditions &&
      snapshot.restrictions.medicalConditions.value.length > 0
    ) {
      reasons.push('MEDICAL_CONTEXT_PRESENT');
      outcome = 'PROFESSIONAL_REVIEW_RECOMMENDED';
    }
    if (reasons.length === 0) reasons.push('NO_SAFETY_RESTRICTION');

    return Object.freeze({ outcome, reasonCodes: Object.freeze(reasons) });
  }

  evaluateAfterGeneration(
    validation: NutritionPlanValidationResult,
  ): NutritionSafetyGateResult {
    const result: NutritionSafetyGateResult =
      validation.status === 'INVALID'
        ? {
            outcome: 'BLOCKED',
            reasonCodes: Object.freeze(['POST_GENERATION_VALIDATION_FAILED']),
          }
        : {
            outcome: 'ALLOWED',
            reasonCodes: Object.freeze(['NO_SAFETY_RESTRICTION']),
          };
    return Object.freeze(result);
  }
}
