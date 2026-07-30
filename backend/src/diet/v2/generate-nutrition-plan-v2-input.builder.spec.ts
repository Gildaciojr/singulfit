import type { CoachProfileSnapshot } from '../../context/coach-profile-snapshot.contract';
import {
  CONVERSATION_GOAL,
  type ConversationGoal,
  type ConversationGoalDecision,
} from '../../context/conversation-goal-planner.contract';
import {
  GenerateNutritionPlanV2InputBuilder,
  NUTRITION_V2_INITIAL_PLAN_ARTIFACT_TYPE,
} from './generate-nutrition-plan-v2-input.builder';
import { NutritionArtifactResolverService } from './nutrition-artifact-resolver.service';

describe('GenerateNutritionPlanV2InputBuilder', () => {
  const snapshot = Object.freeze({}) as CoachProfileSnapshot;
  const referenceDate = new Date('2026-07-29T12:00:00.000Z');

  function decision(goal: ConversationGoal): ConversationGoalDecision {
    return Object.freeze({
      recognizedIntent:
        goal === CONVERSATION_GOAL.GENERAL_GUIDANCE
          ? 'GENERAL_GUIDANCE_REQUEST'
          : 'DIET_PLAN_REQUEST',
      goal,
      reason:
        goal === CONVERSATION_GOAL.GENERAL_GUIDANCE
          ? 'GENERAL_GUIDANCE_REQUESTED'
          : 'DIET_PROFILE_READY',
      targetPlan: goal === CONVERSATION_GOAL.GENERAL_GUIDANCE ? null : 'DIET',
      profileCompletionState: 'COMPLETE',
      canExecute: true,
      confidence: 'HIGH',
      selectedProfileField: null,
      metPreconditions: Object.freeze([]),
      missingPreconditions: Object.freeze([]),
      pendingDependencies: Object.freeze([]),
    });
  }

  function createSubject() {
    return new GenerateNutritionPlanV2InputBuilder(
      new NutritionArtifactResolverService(),
    );
  }

  it('preserves the official required objects without copying their contracts', () => {
    const plannerDecision = decision(CONVERSATION_GOAL.GENERATE_DIET_PLAN);

    const result = createSubject().build({
      userId: 'user-id',
      decision: plannerDecision,
      snapshot,
      referenceDate,
    });

    expect(result).toEqual({
      userId: 'user-id',
      decision: plannerDecision,
      snapshot,
      referenceDate,
      explicitArtifactType: 'DAILY_STRUCTURE',
      nutritionEvidence: undefined,
      previousPlan: undefined,
      reviewedPlan: undefined,
      requestedChangeReason: undefined,
    });
    expect(result.decision).toBe(plannerDecision);
    expect(result.snapshot).toBe(snapshot);
    expect(result.referenceDate).toBe(referenceDate);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('applies the explicit DAILY_STRUCTURE product policy to the initial pilot', () => {
    const result = createSubject().build({
      userId: 'user-id',
      decision: decision(CONVERSATION_GOAL.GENERATE_COMBINED_PLANS),
      snapshot,
      referenceDate,
    });

    expect(NUTRITION_V2_INITIAL_PLAN_ARTIFACT_TYPE).toBe('DAILY_STRUCTURE');
    expect(result.explicitArtifactType).toBe('DAILY_STRUCTURE');
  });

  it('preserves an explicit WEEKLY_PLAN request without replacing it with the pilot default', () => {
    const result = createSubject().build({
      userId: 'user-id',
      decision: decision(CONVERSATION_GOAL.GENERATE_DIET_PLAN),
      snapshot,
      referenceDate,
      explicitArtifactType: 'WEEKLY_PLAN',
    });

    expect(result.explicitArtifactType).toBe('WEEKLY_PLAN');
  });

  it('reuses deterministic artifact resolution without adding heuristics', () => {
    const result = createSubject().build({
      userId: 'user-id',
      decision: decision(CONVERSATION_GOAL.GENERAL_GUIDANCE),
      snapshot,
      referenceDate,
    });

    expect(result.explicitArtifactType).toBe('POINT_GUIDANCE');
  });
});
