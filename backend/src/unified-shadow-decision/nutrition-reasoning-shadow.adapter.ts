import { NUTRITION_ARTIFACT_TYPE } from '../diet/v2/nutrition-planning-artifact.contract';
import {
  NUTRITION_REASONING_STRATEGY,
  NutritionReasoningResult,
} from '../nutrition-reasoning/nutrition-reasoning.contract';
import {
  NutritionReasoningShadowStrategy,
  UNIFIED_SHADOW_ADAPTER_VERSION,
} from './unified-shadow-decision.contract';

export class NutritionReasoningShadowAdapter {
  adapt(result: NutritionReasoningResult): NutritionReasoningShadowStrategy {
    const selectedStrategies = result.selectedStrategies
      .map((item) => item.strategy)
      .sort();
    const prohibitedStrategies = result.prohibitedStrategies
      .map((item) => item.strategy)
      .sort();
    const restrictionCodes = result.appliedRestrictions
      .map((item) => item.code)
      .sort();

    return deepFreeze({
      adapterVersion: UNIFIED_SHADOW_ADAPTER_VERSION,
      artifactType: result.metadata.artifactType,
      interventionIntensity: result.interventionIntensity,
      complexity: result.recommendedComplexity,
      personalization: result.personalizationLevel,
      variationPolicy: this.variationPolicy(result),
      detailLevel: this.detailLevel(result),
      trainingAware: selectedStrategies.includes(
        NUTRITION_REASONING_STRATEGY.SPORTS_FUELING,
      ),
      safetyRestricted: result.metadata.safetyRestricted,
      restrictionCodes,
      selectedStrategies,
      prohibitedStrategies,
    });
  }

  private variationPolicy(
    result: NutritionReasoningResult,
  ): NutritionReasoningShadowStrategy['variationPolicy'] {
    if (result.recommendedComplexity === 'MINIMAL') return 'MINIMAL';
    if (result.metadata.artifactType === NUTRITION_ARTIFACT_TYPE.WEEKLY_PLAN) {
      return 'WEEKLY';
    }
    if (
      result.metadata.artifactType ===
        NUTRITION_ARTIFACT_TYPE.DAILY_STRUCTURE ||
      result.metadata.artifactType === NUTRITION_ARTIFACT_TYPE.MEAL_SUGGESTION
    ) {
      return 'DAILY';
    }
    return 'MINIMAL';
  }

  private detailLevel(
    result: NutritionReasoningResult,
  ): NutritionReasoningShadowStrategy['detailLevel'] {
    if (result.recommendedComplexity === 'MINIMAL') return 'BRIEF';
    if (result.recommendedComplexity === 'DETAILED') return 'DETAILED';
    return 'STANDARD';
  }
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}
