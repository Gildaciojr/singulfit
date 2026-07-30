import {
  ShadowDistributionDelta,
  ShadowMetricDelta,
  ShadowMetricsSnapshot,
  ShadowMetricsVersionComparison,
} from './shadow-evaluation.contract';

export class ShadowMetricsVersionComparator {
  compare(
    previous: ShadowMetricsSnapshot,
    current: ShadowMetricsSnapshot,
  ): ShadowMetricsVersionComparison {
    const agreement = delta(
      previous.metrics.comparator.agreementRate,
      current.metrics.comparator.agreementRate,
    );
    const conflicts = delta(
      previous.metrics.comparator.conflictRate,
      current.metrics.comparator.conflictRate,
    );
    const personalization = delta(
      previous.metrics.indices.personalization,
      current.metrics.indices.personalization,
    );
    const nutritionIntensity = delta(
      previous.metrics.indices.nutritionIntensity,
      current.metrics.indices.nutritionIntensity,
    );
    const workoutIntensity = delta(
      previous.metrics.indices.workoutIntensity,
      current.metrics.indices.workoutIntensity,
    );
    const safety = delta(
      previous.scorecard.safetyScore,
      current.scorecard.safetyScore,
    );
    const comparatorDistribution = distributionDelta(
      previous.metrics.comparator.overall,
      current.metrics.comparator.overall,
    );
    const previousIntensity = average([
      nutritionIntensity.previous,
      workoutIntensity.previous,
    ]);
    const currentIntensity = average([
      nutritionIntensity.current,
      workoutIntensity.current,
    ]);

    return deepFreeze({
      previousVersion: previous.versionLabel,
      currentVersion: current.versionLabel,
      agreement,
      conflicts,
      personalization,
      nutritionIntensity,
      workoutIntensity,
      safety,
      agreementImproved: agreement.absolute > 0,
      conflictsReduced: conflicts.absolute < 0,
      personalizationImproved: personalization.absolute > 0,
      intensityReduced: currentIntensity < previousIntensity,
      safetyImproved: safety.absolute > 0,
      distributionChanged: comparatorDistribution.some(
        (item) => item.percentagePointDelta !== 0,
      ),
      comparatorDistribution,
    });
  }
}

function delta(previous: number, current: number): ShadowMetricDelta {
  const absolute = round(current - previous);
  return Object.freeze({
    previous,
    current,
    absolute,
    direction:
      absolute > 0
        ? ('INCREASED' as const)
        : absolute < 0
          ? ('DECREASED' as const)
          : ('UNCHANGED' as const),
  });
}

function distributionDelta(
  previous: ShadowMetricsSnapshot['metrics']['comparator']['overall'],
  current: ShadowMetricsSnapshot['metrics']['comparator']['overall'],
): readonly ShadowDistributionDelta[] {
  const previousValues = new Map(
    previous.map((entry) => [entry.value, entry.percentage]),
  );
  const currentValues = new Map(
    current.map((entry) => [entry.value, entry.percentage]),
  );
  const values = [
    ...new Set([...previousValues.keys(), ...currentValues.keys()]),
  ].sort();
  return Object.freeze(
    values.map((value) => {
      const previousPercentage = previousValues.get(value) ?? 0;
      const currentPercentage = currentValues.get(value) ?? 0;
      return Object.freeze({
        value,
        previousPercentage,
        currentPercentage,
        percentagePointDelta: round(currentPercentage - previousPercentage),
      });
    }),
  );
}

function average(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value))
    return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}
