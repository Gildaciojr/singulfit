import {
  WORKOUT_REASONING_PROHIBITION,
  WORKOUT_REASONING_STRATEGY,
  WorkoutReasoningResult,
} from '../workout-reasoning/workout-reasoning.contract';
import type { WorkoutBlockType } from '../workout/v2/workout-planning-strategy.contract';
import {
  ShadowPersonalizationLevel,
  UNIFIED_SHADOW_ADAPTER_VERSION,
  WorkoutReasoningShadowStrategy,
} from './unified-shadow-decision.contract';

const BLOCK_ORDER: readonly WorkoutBlockType[] = Object.freeze([
  'WARM_UP',
  'MOBILITY',
  'TECHNIQUE',
  'STRENGTH',
  'HYPERTROPHY',
  'SKILL',
  'CONDITIONING',
  'INTERVAL',
  'ENDURANCE',
  'CORE',
  'COOLDOWN',
  'RECOVERY',
]);

export class WorkoutReasoningShadowAdapter {
  adapt(result: WorkoutReasoningResult): WorkoutReasoningShadowStrategy {
    const selectedStrategies = result.selectedStrategies
      .map((item) => item.strategy)
      .sort();
    const prohibitedStrategies = result.prohibitedStrategies
      .map((item) => item.prohibition)
      .sort();
    const constraintCodes = result.appliedConstraints
      .map((item) => item.code)
      .sort();

    return deepFreeze({
      adapterVersion: UNIFIED_SHADOW_ADAPTER_VERSION,
      artifactType: result.metadata.artifactType,
      modality: result.modality.resolved,
      objective: result.primaryObjective,
      interventionIntensity: result.interventionIntensity,
      complexity: result.authorizedComplexity,
      personalization: this.personalization(result),
      progression: result.progressionDecision,
      requiredBlocks: this.requiredBlocks(result, selectedStrategies),
      maximumActivitiesPerSession: this.maximumActivities(
        result.authorizedComplexity,
      ),
      technicalMovementsAllowed: this.technicalMovementsAllowed(
        result,
        prohibitedStrategies,
      ),
      safetyRestricted: result.metadata.safetyRestricted,
      constraintCodes,
      selectedStrategies,
      prohibitedStrategies,
    });
  }

  private requiredBlocks(
    result: WorkoutReasoningResult,
    strategies: readonly string[],
  ): readonly WorkoutBlockType[] {
    const blocks = new Set<WorkoutBlockType>();
    if (strategies.includes(WORKOUT_REASONING_STRATEGY.REQUIRED_WARM_UP)) {
      blocks.add('WARM_UP');
    }
    if (strategies.includes(WORKOUT_REASONING_STRATEGY.REQUIRED_MOBILITY)) {
      blocks.add('MOBILITY');
    }
    if (
      strategies.includes(WORKOUT_REASONING_STRATEGY.TECHNIQUE_PRIORITY) ||
      strategies.includes(WORKOUT_REASONING_STRATEGY.TECHNIQUE_BEFORE_INTENSITY)
    ) {
      blocks.add('TECHNIQUE');
    }
    if (result.primaryObjective === 'STRENGTH') blocks.add('STRENGTH');
    if (result.primaryObjective === 'HYPERTROPHY') blocks.add('HYPERTROPHY');
    if (result.primaryObjective === 'ENDURANCE') blocks.add('ENDURANCE');
    if (result.primaryObjective === 'CONDITIONING') blocks.add('CONDITIONING');
    if (result.primaryObjective === 'MOBILITY') blocks.add('MOBILITY');
    if (result.primaryObjective === 'ACTIVE_RECOVERY') blocks.add('RECOVERY');
    if (strategies.includes(WORKOUT_REASONING_STRATEGY.AUTHORIZED_INTERVALS)) {
      blocks.add('INTERVAL');
    }
    if (strategies.includes(WORKOUT_REASONING_STRATEGY.REQUIRED_COOLDOWN)) {
      blocks.add('COOLDOWN');
    }
    return BLOCK_ORDER.filter((block) => blocks.has(block));
  }

  private maximumActivities(
    complexity: WorkoutReasoningResult['authorizedComplexity'],
  ): number {
    const values: Readonly<
      Record<WorkoutReasoningResult['authorizedComplexity'], number>
    > = Object.freeze({
      RESTRICTED: 2,
      MINIMAL: 4,
      SIMPLE: 6,
      STANDARD: 8,
      DETAILED: 10,
      ADVANCED: 12,
    });
    return values[complexity];
  }

  private technicalMovementsAllowed(
    result: WorkoutReasoningResult,
    prohibitions: readonly string[],
  ): boolean {
    return (
      !result.metadata.safetyRestricted &&
      (result.metadata.experience === 'INTERMEDIATE' ||
        result.metadata.experience === 'ADVANCED') &&
      (result.authorizedComplexity === 'DETAILED' ||
        result.authorizedComplexity === 'ADVANCED') &&
      !prohibitions.includes(
        WORKOUT_REASONING_PROHIBITION.ADVANCED_MOVEMENTS_FOR_BEGINNER,
      )
    );
  }

  private personalization(
    result: WorkoutReasoningResult,
  ): ShadowPersonalizationLevel {
    const evidence =
      result.activeFactors.length +
      result.appliedConstraints.length +
      result.resolvedConflicts.length;
    return evidence >= 8 ? 'HIGH' : evidence >= 3 ? 'CONTEXTUAL' : 'BASIC';
  }
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}
