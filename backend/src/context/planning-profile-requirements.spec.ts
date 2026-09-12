import { NutritionPlanningReadinessService } from '../diet/v2/nutrition-planning-readiness.service';
import { NUTRITION_ARTIFACT_TYPE } from '../diet/v2/nutrition-planning-artifact.contract';
import { PROFILE_ACQUISITION_FIELD } from './coach-adaptive-profile-collector.contract';
import {
  NUTRITION_BASIC_PLAN_REQUIREMENTS,
  PROFILE_REQUIREMENT_ACQUISITION_OWNER,
  isAdaptiveNutritionBasicRequirement,
} from './planning-profile-requirements.contract';
import { CoachProfileFieldRegistryService } from './profile-acquisition/coach-profile-field-registry.service';
import { ProfileQuestionSpecificationService } from './profile-acquisition/profile-question.service';
import type { CoachProfileSnapshot } from './coach-profile-snapshot.contract';

describe('Nutrition basic planning profile requirements', () => {
  const registry = new CoachProfileFieldRegistryService();
  const questions = new ProfileQuestionSpecificationService(registry);
  const readiness = new NutritionPlanningReadinessService();

  const unavailable = Object.freeze({ status: 'UNKNOWN', sources: [] });
  const unavailableSnapshot = {
    physical: {
      ageYears: unavailable,
      sex: unavailable,
      heightCm: unavailable,
      currentWeightKg: unavailable,
      activityLevel: unavailable,
    },
    nutrition: {
      primaryGoal: unavailable,
      desiredMealCount: unavailable,
      dietaryPattern: unavailable,
      foodIntolerances: unavailable,
      declaredFoodPreferences: unavailable,
      declaredFoodRejections: unavailable,
      cookingAvailability: unavailable,
      eatingOutFrequency: unavailable,
      foodBudget: unavailable,
      hydration: unavailable,
    },
    restrictions: {
      foodRestrictions: unavailable,
      allergies: unavailable,
      medicalConditions: unavailable,
    },
    routine: { mealTimes: unavailable },
    plans: { currentDiet: unavailable },
    conflicts: [],
  } as CoachProfileSnapshot;

  it('derives DAILY_STRUCTURE basic required fields exactly from the shared policy', () => {
    const evaluation = readiness.evaluate(
      unavailableSnapshot,
      NUTRITION_ARTIFACT_TYPE.DAILY_STRUCTURE,
      false,
    );

    expect(evaluation.requiredFields).toEqual(
      NUTRITION_BASIC_PLAN_REQUIREMENTS.map((requirement) => requirement.field),
    );
  });

  it('gives every adaptive Nutrition requirement a real question specification', () => {
    const adaptiveRequirements = NUTRITION_BASIC_PLAN_REQUIREMENTS.filter(
      (requirement) =>
        requirement.acquisitionOwner ===
        PROFILE_REQUIREMENT_ACQUISITION_OWNER.ADAPTIVE_PROFILE,
    );

    expect(adaptiveRequirements).not.toHaveLength(0);
    for (const requirement of adaptiveRequirements) {
      const definition = registry
        .all()
        .find(
          (candidate) =>
            questions.toCollectorField(candidate.field) === requirement.field,
        );
      expect(definition).toBeDefined();
      const specification = questions.forField(
        definition!.field,
        'MISSING_CONTEXTUAL_FIELD',
      );
      expect(specification.field).toBe(definition!.field);
    }
  });

  it.each([PROFILE_ACQUISITION_FIELD.AGE, PROFILE_ACQUISITION_FIELD.SEX])(
    '%s remains base-profile owned rather than adaptive',
    (field) => {
      const requirement = NUTRITION_BASIC_PLAN_REQUIREMENTS.find(
        (candidate) => candidate.field === field,
      );

      expect(requirement).toEqual({
        field,
        acquisitionOwner: PROFILE_REQUIREMENT_ACQUISITION_OWNER.BASE_PROFILE,
      });
      expect(isAdaptiveNutritionBasicRequirement(field)).toBe(false);
    },
  );
});
