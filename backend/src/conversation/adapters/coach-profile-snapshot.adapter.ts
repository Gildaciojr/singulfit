import { Injectable } from '@nestjs/common';
import type { CoachProfileSnapshot } from '../../context/coach-profile-snapshot.contract';
import type { ConversationProfileContext } from '../contracts/conversation-context.contract';

@Injectable()
export class CoachProfileSnapshotConversationAdapter {
  adapt(snapshot: CoachProfileSnapshot): ConversationProfileContext {
    const sections = snapshot.completion.sections;
    return Object.freeze({
      completion: snapshot.completion.overall,
      missingFields: Object.freeze([
        ...new Set(sections.flatMap((section) => section.missingFields)),
      ]),
      confirmationRequiredFields: Object.freeze([
        ...new Set(
          sections.flatMap((section) => section.confirmationRequiredFields),
        ),
      ]),
      currentPlans: Object.freeze({
        dietAvailable:
          'value' in
          (snapshot.plans.currentNutritionPlan ?? snapshot.plans.currentDiet),
        workoutAvailable: 'value' in snapshot.plans.currentWorkout,
      }),
      progressContextAvailable:
        'value' in snapshot.longitudinal.latestProgressWeightKg ||
        'value' in snapshot.longitudinal.goalProgression ||
        'value' in snapshot.longitudinal.nutritionEvolution,
      safetyContextPresent:
        this.constraintsPresent(snapshot.restrictions.medicalConditions) ||
        this.constraintsPresent(snapshot.restrictions.physicalLimitations) ||
        this.constraintsPresent(snapshot.restrictions.allergies),
      conflictCount: snapshot.conflicts.length,
      referenceDate: snapshot.referenceDate,
    });
  }

  private constraintsPresent(value: {
    readonly status: string;
    readonly value?: readonly unknown[];
  }): boolean {
    return (
      (value.status === 'KNOWN' ||
        value.status === 'INFERRED' ||
        value.status === 'REQUIRES_CONFIRMATION') &&
      Array.isArray(value.value) &&
      value.value.length > 0
    );
  }
}
