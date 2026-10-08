import type {
  WorkoutActivityV2,
  WorkoutBlockV2,
  WorkoutExecutionPrescription,
  WorkoutMetricPrescription,
  WorkoutPlanValidationIssue,
  GeneratedWorkoutPlanV2Candidate,
} from './workout-plan-v2.contract';
import type { WorkoutPlanningContext } from './workout-planning-context.contract';
import type { WorkoutPlanningStrategy } from './workout-planning-strategy.contract';
import type { WorkoutPublicTextConstraints } from './workout-public-text.policy';

function executionFromText(
  activity: WorkoutActivityV2,
): WorkoutExecutionPrescription | null {
  if (!('repetitions' in activity) || !activity.repetitions) return null;
  const dose =
    /^(\d+(?:[.,]\d+)?)(?:\s*[-–a]\s*(\d+(?:[.,]\d+)?))?(?:\s+(reps|repeticoes|toques?|s|segundos?|m))?(?:\s+(por lado|por perna|por braco))?(?:\s+(alternando lados))?$/u.exec(
      normalizeWorkoutExecutionText(activity.repetitions, activity) ??
        normalize(activity.repetitions),
    );
  if (!dose) return null;
  const kind =
    dose[3] === 'm'
      ? 'METERS'
      : ['s', 'segundo', 'segundos'].includes(dose[3])
        ? 'SECONDS'
        : 'COUNT';
  const minimum = Number(dose[1].replace(',', '.'));
  const maximum = Number((dose[2] ?? dose[1]).replace(',', '.'));
  if (
    !Number.isFinite(minimum) ||
    !Number.isFinite(maximum) ||
    minimum <= 0 ||
    maximum < minimum ||
    (kind === 'COUNT' &&
      (!Number.isSafeInteger(minimum) || !Number.isSafeInteger(maximum)))
  )
    return null;
  return {
    kind,
    minimum,
    maximum,
    perSide: Boolean(dose[4]),
    alternating: Boolean(dose[5]),
  };
}

/** V12 only: recover missing redundant values, never create a dose or overwrite a conflict. */
export function reconcileWorkoutPrescriptions(
  candidate: GeneratedWorkoutPlanV2Candidate,
): GeneratedWorkoutPlanV2Candidate {
  const sessions = candidate.sessions.map((session) => {
    const blocks = session.blocks.map((block) => {
      const activities = block.activities.map((activity) => {
        const prescription = activity.prescription;
        const execution = prescription?.execution;
        if (!prescription || !execution) return activity;
        let reconciled: WorkoutExecutionPrescription | null = execution;
        if (activity.kind === 'STRENGTH' || activity.kind === 'MOBILITY') {
          const dose = executionFromText(activity);
          const missingDose =
            execution.minimum === null && execution.maximum === null;
          if (
            dose &&
            (execution.kind === dose.kind ||
              (missingDose &&
                execution.kind === 'COUNT' &&
                dose.kind === 'SECONDS')) &&
            (missingDose ||
              (execution.perSide === dose.perSide &&
                execution.alternating === dose.alternating)) &&
            (execution.minimum === null ||
              execution.minimum === dose.minimum) &&
            (execution.maximum === null ||
              execution.maximum === dose.maximum) &&
            (execution.minimum === null || execution.maximum === null)
          ) {
            reconciled = {
              ...execution,
              kind: dose.kind,
              minimum: dose.minimum,
              maximum: dose.maximum,
              perSide: execution.perSide || dose.perSide,
              alternating: execution.alternating || dose.alternating,
            };
          }
        } else if (!execution.perSide && !execution.alternating) {
          const seconds =
            activity.kind === 'TIMED'
              ? activity.durationSeconds
              : activity.durationMinutes * 60;
          if (
            Number.isSafeInteger(seconds) &&
            seconds > 0 &&
            ((execution.minimum === null &&
              execution.maximum === null &&
              ['COUNT', 'SECONDS'].includes(execution.kind)) ||
              (execution.kind === 'SECONDS' &&
                (execution.minimum === null || execution.minimum === seconds) &&
                (execution.maximum === null || execution.maximum === seconds)))
          )
            reconciled = null;
        }
        return reconciled === execution
          ? activity
          : Object.freeze({
              ...activity,
              prescription: Object.freeze({
                ...prescription,
                execution: reconciled,
              }),
            });
      });
      return activities.some(
        (activity, index) => activity !== block.activities[index],
      )
        ? Object.freeze({ ...block, activities: Object.freeze(activities) })
        : block;
    });
    return blocks.some((block, index) => block !== session.blocks[index])
      ? Object.freeze({ ...session, blocks: Object.freeze(blocks) })
      : session;
  });
  return sessions.some(
    (session, index) => session !== candidate.sessions[index],
  )
    ? Object.freeze({ ...candidate, sessions: Object.freeze(sessions) })
    : candidate;
}

/** Structural semantics only. No exercise selection or programming tables. */
export function workoutPrescriptionIssues(
  activity: WorkoutActivityV2,
  block: WorkoutBlockV2,
  context: WorkoutPlanningContext,
  strategy: WorkoutPlanningStrategy,
): readonly WorkoutPlanValidationIssue[] {
  const prescription = activity.prescription;
  if (!prescription) return [];
  const issues: WorkoutPlanValidationIssue[] = [];
  const invalid = (): void => {
    issues.push({
      code: 'INVALID_PARAMETER',
      severity: 'ERROR',
      path: `${activity.activityKey}.prescription`,
    });
  };
  const execution = prescription.execution;
  if (execution) {
    // Compare redundant, unambiguous doses; unfamiliar historical text is not rejected.
    if ('repetitions' in activity && activity.repetitions) {
      const dose = executionFromText(activity);
      if (dose) {
        if (
          execution.kind !== dose.kind ||
          execution.minimum !== dose.minimum ||
          (execution.maximum ?? execution.minimum) !== dose.maximum ||
          execution.perSide !== dose.perSide ||
          execution.alternating !== dose.alternating
        )
          invalid();
      }
    }
    const maximum = execution.maximum ?? execution.minimum;
    if (execution.kind === 'MAXIMUM_TECHNICAL_REPS') {
      if (
        execution.minimum !== null ||
        execution.maximum !== null ||
        !(block.work && block.work.durationSeconds > 0) ||
        prescription.effort?.kind !== 'MAXIMUM_TECHNICAL_REPS'
      )
        invalid();
    } else if (
      execution.minimum === null ||
      maximum === null ||
      !Number.isFinite(execution.minimum) ||
      !Number.isFinite(maximum) ||
      (execution.kind === 'COUNT' &&
        (!Number.isSafeInteger(execution.minimum) ||
          !Number.isSafeInteger(maximum))) ||
      execution.minimum <= 0 ||
      maximum < execution.minimum ||
      (execution.kind === 'METERS' && activity.movementPattern !== 'CARRY')
    )
      invalid();
    if (activity.kind !== 'STRENGTH' && activity.kind !== 'MOBILITY') invalid();
    // Load/pace/HR/power never belong in a count field, even with typed execution.
    if (
      'repetitions' in activity &&
      /\b(?:kg|kgs|lb|lbs|1rm|bpm|watts?|mph)\b|%|km\s*\/\s*h/u.test(
        activity.repetitions?.toLowerCase() ?? '',
      )
    )
      invalid();
  }
  const effort = prescription.effort;
  if (effort) {
    if (
      effort.kind === 'MAXIMUM_TECHNICAL_REPS' &&
      !(block.work && block.work.durationSeconds > 0)
    )
      invalid();
    if (
      (effort.kind === 'RPE' &&
        (effort.value === null || effort.value < 1 || effort.value > 10)) ||
      (effort.kind === 'RIR' && (effort.value === null || effort.value < 0)) ||
      (['TECHNICAL_FAILURE', 'MAXIMUM_TECHNICAL_REPS'].includes(effort.kind) &&
        effort.value !== null) ||
      (effort.value !== null && !Number.isFinite(effort.value))
    )
      invalid();
    if (
      effort.kind === 'TECHNICAL_FAILURE' &&
      (!strategy.technicalMovementsAllowed ||
        ['TECHNIQUE', 'SKILL', 'WEIGHTLIFTING', 'GYMNASTICS'].includes(
          block.type,
        ))
    )
      invalid();
    if (
      ['TECHNICAL_FAILURE', 'MAXIMUM_TECHNICAL_REPS'].includes(effort.kind) &&
      context.safetySignals.length > 0
    )
      invalid();
  }
  const metrics = [
    ...(prescription.load ? [prescription.load] : []),
    ...prescription.enduranceMetrics,
  ];
  const text = [activity.name, activity.instruction, ...activity.alerts]
    .join(' ')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
  const textualMetrics: readonly (readonly [
    WorkoutMetricPrescription['kind'],
    RegExp,
  ])[] = [
    ['LOAD_KG', /\b(\d+(?:[.,]\d+)?)\s*kg\b/gu],
    ['PERCENT_1RM', /\b(\d+(?:[.,]\d+)?)\s*%\s*(?:de\s+)?1rm\b/gu],
    ['HEART_RATE_BPM', /\b(\d+(?:[.,]\d+)?)\s*bpm\b/gu],
    ['POWER_WATTS', /\b(\d+(?:[.,]\d+)?)\s*(?:w|watts?)\b/gu],
  ];
  for (const [kind, pattern] of textualMetrics) {
    for (const match of text.matchAll(pattern)) {
      if (
        !metrics.some(
          (metric) =>
            metric.kind === kind &&
            metric.value === Number(match[1].replace(',', '.')),
        )
      )
        invalid();
    }
  }
  for (const match of text.matchAll(/\b(\d+):(\d{2})\s*\/\s*km\b/gu)) {
    if (
      Number(match[2]) >= 60 ||
      !metrics.some(
        (metric) =>
          metric.kind === 'PACE_SECONDS_PER_KM' &&
          metric.value === Number(match[1]) * 60 + Number(match[2]),
      )
    )
      invalid();
  }
  if (new Set(metrics.map((m) => m.kind)).size !== metrics.length) invalid();
  for (const metric of metrics) {
    if (!Number.isFinite(metric.value) || metric.value <= 0) {
      invalid();
      continue;
    }
    // Broad human plausibility bounds, not targets or exercise programming.
    // Evidence cannot authorize a physiologically impossible unit/value.
    if (
      (metric.kind === 'LOAD_KG' && metric.value > 5000) ||
      (metric.kind === 'HEART_RATE_BPM' &&
        (metric.value < 20 || metric.value > 250)) ||
      (metric.kind === 'POWER_WATTS' && metric.value > 5000) ||
      (metric.kind === 'PACE_SECONDS_PER_KM' &&
        (metric.value < 60 ||
          (activity.kind === 'ENDURANCE' &&
            activity.mode === 'WALK' &&
            metric.value < 144)))
    )
      invalid();
    const load = metric.kind === 'LOAD_KG' || metric.kind === 'PERCENT_1RM';
    if (load) {
      if (
        metric !== prescription.load ||
        activity.kind !== 'STRENGTH' ||
        !strategy.intensityPolicy.exactLoadAllowed ||
        !activity.equipment.some((e) =>
          ['BARBELL', 'DUMBBELL', 'KETTLEBELL', 'MACHINE', 'CABLE'].includes(e),
        )
      )
        invalid();
    } else if (
      metric === prescription.load ||
      activity.kind !== 'ENDURANCE' ||
      (metric.kind === 'PACE_SECONDS_PER_KM' &&
        (activity.mode === 'CYCLE' ||
          !strategy.intensityPolicy.exactPaceAllowed)) ||
      (metric.kind === 'POWER_WATTS' &&
        (activity.mode !== 'CYCLE' ||
          !strategy.intensityPolicy.exactPowerAllowed)) ||
      (metric.kind === 'HEART_RATE_BPM' &&
        !strategy.intensityPolicy.exactHeartRateAllowed)
    )
      invalid();
    const evidence = context.metricEvidence?.find(
      (e) => e.id === metric.referenceId,
    );
    if (metric.kind === 'PERCENT_1RM') {
      if (
        metric.value > 100 ||
        metric.basis !== 'ADJUSTABLE_START' ||
        !effort ||
        !['RPE', 'RIR'].includes(effort.kind)
      )
        invalid();
      // A percentage without a known 1RM is an unauthorized exact load,
      // not a malformed dose. Keep it blocking, but allow the existing bounded
      // repair to correct the recommendation without inventing capacity.
      if (
        evidence?.kind !== 'ONE_REP_MAX_KG' ||
        !Number.isFinite(evidence.value) ||
        evidence.value <= 0
      )
        issues.push({
          code: 'UNAUTHORIZED_EXACT_LOAD',
          severity: 'ERROR',
          path: `${activity.activityKey}.prescription.load.referenceId`,
        });
    } else if (metric.basis === 'ADJUSTABLE_START') {
      if (
        !effort ||
        !['RPE', 'RIR'].includes(effort.kind) ||
        context.safetySignals.length > 0
      )
        invalid();
      const experience = context.training.experience;
      const conservative =
        experience.status !== 'CONFIRMED' ||
        experience.value === 'BEGINNER' ||
        (context.training.perceivedConditioning.status === 'CONFIRMED' &&
          context.training.perceivedConditioning.value === 'LOW') ||
        strategy.intensityPolicy.qualitativeLevel === 'LIGHT';
      const conservativeEffort =
        effort?.value !== null &&
        effort?.value !== undefined &&
        ((effort.kind === 'RPE' && effort.value <= (conservative ? 5 : 7)) ||
          (effort.kind === 'RIR' && effort.value >= (conservative ? 4 : 2)));
      if (metric.kind === 'LOAD_KG' || metric.kind === 'HEART_RATE_BPM') {
        // A model-authored recommendation may reuse an exact known value without
        // extrapolating capacity. Validation never converts a reference into a goal.
        const capacityReference =
          metric.referenceId !== null
            ? evidence
            : context.metricEvidence?.find(
                (reference) =>
                  reference.kind === metric.kind &&
                  reference.value === metric.value,
              );
        const anchored =
          capacityReference !== undefined &&
          Number.isFinite(capacityReference.value) &&
          capacityReference.value > 0 &&
          (metric.kind === 'LOAD_KG'
            ? capacityReference.kind === 'LOAD_KG' ||
              capacityReference.kind === 'ONE_REP_MAX_KG'
            : capacityReference.kind === 'HEART_RATE_BPM') &&
          metric.value <= capacityReference.value;
        if (!conservativeEffort) invalid();
        if (metric.kind === 'LOAD_KG') {
          // One exploratory risk budget, not an exercise/load programming table.
          // Above it, experience/RPE alone cannot establish absolute capacity.
          if (
            experience.status !== 'CONFIRMED' ||
            (metric.referenceId === null
              ? !anchored && metric.value > 40
              : !anchored)
          )
            invalid();
        } else if (!anchored || metric.value > 200) {
          // High recorded HR can remain a reference; it is not a safe initial goal.
          invalid();
        }
      } else if (metric.referenceId !== null) invalid();
    } else if (
      !evidence ||
      evidence.source !== metric.basis ||
      evidence.kind !== metric.kind ||
      evidence.value !== metric.value
    )
      invalid();
  }
  return issues;
}

export function workoutPrescriptionTextConstraints(
  activity: WorkoutActivityV2,
): WorkoutPublicTextConstraints {
  const metrics = [
    ...(activity.prescription?.load ? [activity.prescription.load] : []),
    ...(activity.prescription?.enduranceMetrics ?? []),
  ];
  return {
    equipmentReferenceText: activity.name,
    authorizedEquipment: activity.equipment,
    intensityPolicy: {
      exactLoadAllowed: metrics.some((m) =>
        ['LOAD_KG', 'PERCENT_1RM'].includes(m.kind),
      ),
      exactPaceAllowed: metrics.some((m) => m.kind === 'PACE_SECONDS_PER_KM'),
      exactPowerAllowed: metrics.some((m) => m.kind === 'POWER_WATTS'),
      exactHeartRateAllowed: metrics.some((m) => m.kind === 'HEART_RATE_BPM'),
    },
  };
}

export function presentWorkoutExecution(
  execution: WorkoutExecutionPrescription,
): string {
  if (execution.kind === 'MAXIMUM_TECHNICAL_REPS')
    return 'máximo de repetições mantendo técnica';
  const range = `${execution.minimum}${execution.maximum !== null && execution.maximum !== execution.minimum ? `-${execution.maximum}` : ''}`;
  return `${range}${execution.kind === 'SECONDS' ? ' s' : execution.kind === 'METERS' ? ' m' : ''}${execution.perSide ? ' por lado' : ''}${execution.alternating ? ' alternando lados' : ''}`;
}

export function presentWorkoutMetric(
  metric: WorkoutMetricPrescription,
): string {
  const values = {
    LOAD_KG: `${metric.value} kg`,
    PERCENT_1RM: `${metric.value}% de 1RM`,
    PACE_SECONDS_PER_KM: `${Math.floor(metric.value / 60)}:${String(metric.value % 60).padStart(2, '0')}/km`,
    HEART_RATE_BPM: `${metric.value} bpm`,
    POWER_WATTS: `${metric.value} W`,
  };
  return `${values[metric.kind]}${metric.basis === 'ADJUSTABLE_START' ? ' — ponto inicial ajustável conforme técnica e esforço' : ''}`;
}

const normalize = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/gu, ' ')
    .trim();
export function normalizeWorkoutExecutionText(
  value: string | null,
  context?: Pick<WorkoutActivityV2, 'movementPattern'>,
): string | null {
  if (!value) return null;
  const countedMovement =
    /^([1-9]\d*)(?:\s*[-–]\s*([1-9]\d*))?\s+(toques?|alternando lados|m(?:\s+por lado)?)$/u.exec(
      normalize(value),
    );
  if (countedMovement) {
    const minimum = Number(countedMovement[1]);
    const maximum = countedMovement[2] ? Number(countedMovement[2]) : minimum;
    const unit = countedMovement[3];
    if (
      !Number.isSafeInteger(minimum) ||
      !Number.isSafeInteger(maximum) ||
      maximum < minimum ||
      (unit.startsWith('m') && context?.movementPattern !== 'CARRY')
    )
      return null;
    const publicUnit = unit === 'toque' ? 'toques' : unit;
    return `${countedMovement[1]}${countedMovement[2] ? `-${countedMovement[2]}` : ''} ${publicUnit}`;
  }
  const timed =
    /^([1-9]\d*)(?:\s*[-–]\s*([1-9]\d*))?\s+(?:s|segundos?)(?:\s+(por lado))?$/u.exec(
      normalize(value),
    );
  if (timed) {
    const minimum = Number(timed[1]);
    const maximum = timed[2] ? Number(timed[2]) : minimum;
    if (
      !Number.isSafeInteger(minimum) ||
      !Number.isSafeInteger(maximum) ||
      maximum < minimum
    )
      return null;
    return `${timed[1]}${timed[2] ? `-${timed[2]}` : ''} s${timed[3] ? ` ${timed[3]}` : ''}`;
  }
  const match =
    /^(\d+(?:\s*[-–a]\s*\d+)?)(?:\s*(?:repeticoes|reps))?(?:\s*\(?((?:por|de cada|cada) (?:lado|perna|braco))\)?)?$/u.exec(
      normalize(value),
    );
  if (!match) return null;
  return `${match[1]}${match[2] ? ` ${match[2].replace(/^(?:de cada|cada)/u, 'por')}` : ''}`;
}
