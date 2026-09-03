import type { CoachPlanningExecutionResult } from './coach-planning-execution.contract';

export function isNutritionPlanningRealizerEligible(
  execution: CoachPlanningExecutionResult,
): boolean {
  return (
    execution.selectedSource === 'LEGACY' &&
    execution.dispatch.executor === 'DIET_LEGACY' &&
    (execution.decision === null || execution.decision.targetPlan === 'DIET')
  );
}
