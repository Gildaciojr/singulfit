import { Injectable } from '@nestjs/common';
import type {
  CoachProfileDatum,
  CoachProfileSnapshot,
} from '../context/coach-profile-snapshot.contract';
import {
  LONGITUDINAL_COACHING_DECISION,
  LONGITUDINAL_COACHING_POLICY_VERSION,
  LONGITUDINAL_COACHING_SCHEMA_VERSION,
  LONGITUDINAL_COACHING_STATE,
  LONGITUDINAL_INTERVENTION_INTENSITY,
  LONGITUDINAL_LEVEL,
  LONGITUDINAL_PRIORITY,
  LONGITUDINAL_STABILITY,
  LONGITUDINAL_TREND,
  LONGITUDINAL_WEIGHT_TREND,
  LongitudinalActivePlanReference,
  LongitudinalAdherenceAssessment,
  LongitudinalCoachingAction,
  LongitudinalCoachingDecision,
  LongitudinalCoachingInput,
  LongitudinalCoachingState,
  LongitudinalDomainPriorities,
  LongitudinalEvidenceStrength,
  LongitudinalFitnessCheckInObservation,
  LongitudinalHistoryObservation,
  LongitudinalInterventionIntensity,
  LongitudinalLevel,
  LongitudinalMotivationAssessment,
  LongitudinalPlanObjective,
  LongitudinalPriority,
  LongitudinalProgressObservation,
  LongitudinalRationaleCode,
  LongitudinalRisk,
  LongitudinalRiskCode,
  LongitudinalSeverity,
  LongitudinalStability,
  LongitudinalTrainingModality,
  LongitudinalTrend,
  LongitudinalTrendProfile,
  LongitudinalWeightTrend,
  PreviousLongitudinalDecisionReference,
} from './longitudinal-coaching.contract';

const DAY_MS = 86_400_000;
const INTERRUPTION_DAYS = 28;
const PLATEAU_DAYS = 28;
const NEW_PLAN_DAYS = 21;

interface TimedValue {
  readonly observedAt: number;
  readonly value: number;
}

interface CanonicalInput {
  readonly referenceDate: Date;
  readonly history: readonly LongitudinalHistoryObservation[];
  readonly progress: readonly LongitudinalProgressObservation[];
  readonly checkIns: readonly LongitudinalFitnessCheckInObservation[];
  readonly plans: readonly LongitudinalActivePlanReference[];
  readonly previousDecisions: readonly PreviousLongitudinalDecisionReference[];
}

interface ProgressContext {
  readonly goal: LongitudinalPlanObjective;
  readonly weightTrend: LongitudinalWeightTrend;
  readonly physicalTrend: LongitudinalTrend;
  readonly nutritionTrend: LongitudinalTrend;
  readonly hydrationTrend: LongitudinalTrend;
  readonly adherence: LongitudinalAdherenceAssessment;
  readonly consistencyTrend: LongitudinalTrend;
  readonly frequencyTrend: LongitudinalTrend;
  readonly trainingTrend: LongitudinalTrend;
  readonly evolutionTrend: LongitudinalTrend;
  readonly motivation: LongitudinalMotivationAssessment;
  readonly evidenceStrength: LongitudinalEvidenceStrength;
  readonly observationSpanDays: number;
  readonly observationCount: number;
  readonly plateau: boolean;
  readonly interrupted: boolean;
  readonly relapseSeverity: Exclude<LongitudinalSeverity, 'CRITICAL'> | null;
  readonly regressionSeverity: LongitudinalSeverity | null;
  readonly modality: LongitudinalTrainingModality;
  readonly clinicalContext: boolean;
}

interface DecisionContext {
  readonly state: LongitudinalCoachingState;
  readonly decision: LongitudinalCoachingAction;
  readonly repeatedAdaptation: boolean;
}

@Injectable()
export class LongitudinalCoachingEngineService {
  decide(input: LongitudinalCoachingInput): LongitudinalCoachingDecision {
    const canonical = this.canonicalize(input);
    const rationale = new OrderedSet<LongitudinalRationaleCode>();
    const risks = new RiskCollector();
    const context = this.assess(input.snapshot, input, canonical, rationale);
    const decision = this.resolveDecision(
      input,
      canonical,
      context,
      rationale,
      risks,
    );
    const trends: LongitudinalTrendProfile = {
      weight: context.weightTrend,
      frequency: context.frequencyTrend,
      adherence: context.adherence.trend,
      hydration: context.hydrationTrend,
      nutrition: context.nutritionTrend,
      training: context.trainingTrend,
      evolution: context.evolutionTrend,
    };
    const stability = this.resolveStability(context, trends);
    const priorities = this.resolvePriorities(input, context, decision.state);
    const interventionIntensity = this.resolveInterventionIntensity(
      input,
      context,
      decision.decision,
    );

    this.collectRationale(context, rationale);
    this.collectRisks(input, context, risks);
    rationale.add('DETERMINISTIC_POLICY');

    return deepFreeze({
      currentState: decision.state,
      trends,
      stability,
      progress: {
        trend: context.physicalTrend,
        evidenceStrength: context.evidenceStrength,
        observationSpanDays: context.observationSpanDays,
        observationCount: context.observationCount,
      },
      regression: {
        detected: context.regressionSeverity !== null,
        severity: context.regressionSeverity,
      },
      relapse: {
        detected: context.relapseSeverity !== null,
        severity: context.relapseSeverity,
      },
      adherence: context.adherence,
      motivation: context.motivation,
      needs: {
        adaptation:
          decision.decision === LONGITUDINAL_COACHING_DECISION.ADAPT_PLAN ||
          decision.decision === LONGITUDINAL_COACHING_DECISION.INCREASE ||
          decision.decision === LONGITUDINAL_COACHING_DECISION.REDUCE,
        reassessment:
          decision.decision === LONGITUDINAL_COACHING_DECISION.REVIEW,
        deload: decision.decision === LONGITUDINAL_COACHING_DECISION.DELOAD,
        maintenance:
          decision.decision === LONGITUDINAL_COACHING_DECISION.KEEP_PLAN,
        information:
          decision.decision === LONGITUDINAL_COACHING_DECISION.ASK_INFORMATION,
      },
      decision: decision.decision,
      priorities,
      risks: risks.values(),
      interventionIntensity,
      rationaleCodes: rationale.values(),
      metadata: {
        schemaVersion: LONGITUDINAL_COACHING_SCHEMA_VERSION,
        policyVersion: LONGITUDINAL_COACHING_POLICY_VERSION,
        referenceDate: canonical.referenceDate.toISOString(),
        historyObservations: canonical.history.length,
        progressObservations: canonical.progress.length,
        checkInObservations: canonical.checkIns.length,
        activePlans: canonical.plans.length,
        previousDecisions: canonical.previousDecisions.length,
        deterministic: true,
      },
    });
  }

  private canonicalize(input: LongitudinalCoachingInput): CanonicalInput {
    const referenceDate = this.date(
      input.snapshot.referenceDate,
      'referenceDate',
    );

    this.validateSafetySignals(input);

    return {
      referenceDate,
      history: this.canonicalCollection(input.history, (item) =>
        this.validateHistory(item, referenceDate),
      ),
      progress: this.canonicalCollection(input.progressSnapshots, (item) =>
        this.validateProgress(item, referenceDate),
      ),
      checkIns: this.canonicalCollection(input.fitnessCheckIns, (item) =>
        this.validateCheckIn(item, referenceDate),
      ),
      plans: this.canonicalCollection(input.activePlans, (item) =>
        this.validatePlan(item, referenceDate),
      ),
      previousDecisions: this.canonicalCollection(
        input.previousDecisions,
        (item) => this.validatePreviousDecision(item, referenceDate),
      ),
    };
  }

  private assess(
    snapshot: CoachProfileSnapshot,
    input: LongitudinalCoachingInput,
    canonical: CanonicalInput,
    rationale: OrderedSet<LongitudinalRationaleCode>,
  ): ProgressContext {
    const goal = this.resolveGoal(snapshot, canonical.plans);
    const modality = this.resolveModality(snapshot, canonical.plans);
    const weightTrend = this.weightTrend(canonical.progress);
    const physicalTrend = this.physicalTrend(
      goal,
      canonical.progress,
      weightTrend,
      rationale,
    );
    const adherence = this.adherence(snapshot, canonical);
    const nutritionTrend = this.nutritionTrend(canonical.history);
    const hydrationTrend = this.metricTrend(
      canonical.history.flatMap((item) =>
        item.hydrationScore === undefined
          ? []
          : [this.timed(item.observedAt, item.hydrationScore)],
      ),
      5,
    );
    const frequencyTrend = this.metricTrend(
      canonical.history.flatMap((item) =>
        item.trainingFrequency === undefined
          ? []
          : [this.timed(item.observedAt, item.trainingFrequency)],
      ),
      0.5,
    );
    const trainingTrend = this.metricTrend(
      canonical.history.flatMap((item) =>
        item.trainingCompletionScore === undefined
          ? []
          : [this.timed(item.observedAt, item.trainingCompletionScore)],
      ),
      5,
    );
    const consistencyTrend = this.metricTrend(
      canonical.history.flatMap((item) =>
        item.consistencyScore === undefined
          ? []
          : [this.timed(item.observedAt, item.consistencyScore)],
      ),
      5,
    );
    const calculatedGoalTrend = this.metricTrend(
      canonical.history.flatMap((item) =>
        item.goalProgressScore === undefined
          ? []
          : [this.timed(item.observedAt, item.goalProgressScore)],
      ),
      5,
    );
    const goalTrend =
      calculatedGoalTrend === LONGITUDINAL_TREND.UNKNOWN
        ? this.latestExplicitTrend(canonical.history, 'goalProgressDirection')
        : calculatedGoalTrend;
    const evolutionTrend = this.aggregateTrend([
      physicalTrend,
      nutritionTrend,
      trainingTrend,
      adherence.trend,
      consistencyTrend,
      goalTrend,
    ]);
    const observationDates = [
      ...canonical.history.map((item) => this.timestamp(item.observedAt)),
      ...canonical.progress.map((item) => this.timestamp(item.observedAt)),
      ...canonical.checkIns.map((item) => this.timestamp(item.observedAt)),
    ].sort((left, right) => left - right);
    const observationSpanDays = this.spanDays(observationDates);
    const observationCount = observationDates.length;
    const evidenceStrength = this.evidenceStrength(
      observationCount,
      observationSpanDays,
    );
    const plateau = this.isPlateau(
      goal,
      weightTrend,
      evolutionTrend,
      observationCount,
      observationSpanDays,
    );
    const interrupted = this.isInterrupted(
      observationDates,
      canonical.referenceDate,
    );
    const relapseSeverity = this.relapseSeverity(canonical.history);
    const regressionSeverity = this.regressionSeverity(
      [physicalTrend, nutritionTrend, trainingTrend, adherence.trend],
      relapseSeverity,
    );
    const motivation = this.motivation(snapshot, canonical.checkIns);
    const clinicalContext =
      input.safetySignals.clinicalContext ||
      this.hasKnownItems(snapshot.restrictions.medicalConditions);

    if (modality !== 'UNKNOWN') rationale.add('TRAINING_MODALITY_CONTEXT');

    return {
      goal,
      weightTrend,
      physicalTrend,
      nutritionTrend,
      hydrationTrend,
      adherence,
      consistencyTrend,
      frequencyTrend,
      trainingTrend,
      evolutionTrend,
      motivation,
      evidenceStrength,
      observationSpanDays,
      observationCount,
      plateau,
      interrupted,
      relapseSeverity,
      regressionSeverity,
      modality,
      clinicalContext,
    };
  }

  private resolveDecision(
    input: LongitudinalCoachingInput,
    canonical: CanonicalInput,
    context: ProgressContext,
    rationale: OrderedSet<LongitudinalRationaleCode>,
    risks: RiskCollector,
  ): DecisionContext {
    const safetyBlocked =
      context.clinicalContext ||
      input.safetySignals.acutePain ||
      input.safetySignals.fever ||
      input.safetySignals.rehabilitation ||
      input.safetySignals.physicalIncapacity;
    const repeatedAdaptation =
      canonical.previousDecisions
        .slice(-3)
        .filter(
          (item) =>
            item.decision === LONGITUDINAL_COACHING_DECISION.ADAPT_PLAN ||
            item.decision === LONGITUDINAL_COACHING_DECISION.REVIEW ||
            item.decision === LONGITUDINAL_COACHING_DECISION.REDUCE,
        ).length >= 2;

    if (safetyBlocked) {
      if (context.clinicalContext) rationale.add('CLINICAL_CONTEXT');
      if (input.safetySignals.acutePain) rationale.add('ACUTE_PAIN');
      if (input.safetySignals.fever) rationale.add('FEVER');
      if (input.safetySignals.rehabilitation) {
        rationale.add('REHABILITATION_CONTEXT');
      }
      if (input.safetySignals.physicalIncapacity) {
        rationale.add('PHYSICAL_INCAPACITY');
      }
      rationale.add('SAFETY_PRECEDENCE');
      rationale.add('NO_AUTOMATIC_ADAPTATION');
      return {
        state:
          context.evidenceStrength === 'INSUFFICIENT'
            ? LONGITUDINAL_COACHING_STATE.UNKNOWN
            : this.stateFromContext(context),
        decision: LONGITUDINAL_COACHING_DECISION.REVIEW,
        repeatedAdaptation,
      };
    }

    if (context.evidenceStrength === 'INSUFFICIENT') {
      rationale.add('INSUFFICIENT_HISTORY');
      risks.add('INSUFFICIENT_DATA', 'MEDIUM', 'GENERAL');
      const newPlan = this.hasNewPlan(canonical.plans, canonical.referenceDate);
      if (newPlan) rationale.add('NEW_ACTIVE_PLAN');
      return {
        state: LONGITUDINAL_COACHING_STATE.UNKNOWN,
        decision: newPlan
          ? LONGITUDINAL_COACHING_DECISION.WAIT
          : LONGITUDINAL_COACHING_DECISION.ASK_INFORMATION,
        repeatedAdaptation,
      };
    }

    rationale.add('SUFFICIENT_HISTORY');

    if (context.interrupted) {
      rationale.add('LONG_INTERRUPTION');
      return {
        state: LONGITUDINAL_COACHING_STATE.REGRESSING,
        decision: LONGITUDINAL_COACHING_DECISION.REDUCE,
        repeatedAdaptation,
      };
    }

    if (input.safetySignals.poorRecovery) {
      rationale.add('POOR_RECOVERY');
      return {
        state: this.stateFromContext(context),
        decision: repeatedAdaptation
          ? LONGITUDINAL_COACHING_DECISION.REVIEW
          : LONGITUDINAL_COACHING_DECISION.DELOAD,
        repeatedAdaptation,
      };
    }

    if (context.regressionSeverity !== null) {
      rationale.add('REGRESSION_DETECTED');
      if (repeatedAdaptation) {
        rationale.add('REPEATED_ADAPTATION');
        return {
          state: LONGITUDINAL_COACHING_STATE.REGRESSING,
          decision: LONGITUDINAL_COACHING_DECISION.REVIEW,
          repeatedAdaptation,
        };
      }

      return {
        state: LONGITUDINAL_COACHING_STATE.REGRESSING,
        decision:
          context.adherence.level === LONGITUDINAL_LEVEL.LOW
            ? LONGITUDINAL_COACHING_DECISION.ADAPT_PLAN
            : LONGITUDINAL_COACHING_DECISION.REVIEW,
        repeatedAdaptation,
      };
    }

    if (context.plateau) {
      rationale.add('PROLONGED_PLATEAU');
      if (repeatedAdaptation) {
        rationale.add('REPEATED_ADAPTATION');
        return {
          state: LONGITUDINAL_COACHING_STATE.PLATEAU,
          decision: LONGITUDINAL_COACHING_DECISION.REVIEW,
          repeatedAdaptation,
        };
      }

      const progressiveTrainingContext =
        context.goal === 'HYPERTROPHY' &&
        context.adherence.level === LONGITUDINAL_LEVEL.HIGH &&
        context.motivation.level !== LONGITUDINAL_LEVEL.LOW &&
        canonical.plans.some((plan) => plan.domain === 'WORKOUT');
      return {
        state: LONGITUDINAL_COACHING_STATE.PLATEAU,
        decision: progressiveTrainingContext
          ? LONGITUDINAL_COACHING_DECISION.INCREASE
          : LONGITUDINAL_COACHING_DECISION.ADAPT_PLAN,
        repeatedAdaptation,
      };
    }

    if (context.adherence.level === LONGITUDINAL_LEVEL.LOW) {
      rationale.add('LOW_ADHERENCE');
      return {
        state: this.stateFromContext(context),
        decision: LONGITUDINAL_COACHING_DECISION.ADAPT_PLAN,
        repeatedAdaptation,
      };
    }

    return {
      state: this.stateFromContext(context),
      decision: LONGITUDINAL_COACHING_DECISION.KEEP_PLAN,
      repeatedAdaptation,
    };
  }

  private stateFromContext(
    context: ProgressContext,
  ): LongitudinalCoachingState {
    if (context.regressionSeverity !== null || context.interrupted) {
      return LONGITUDINAL_COACHING_STATE.REGRESSING;
    }
    if (context.plateau) return LONGITUDINAL_COACHING_STATE.PLATEAU;
    if (context.evolutionTrend === LONGITUDINAL_TREND.IMPROVING) {
      return LONGITUDINAL_COACHING_STATE.IMPROVING;
    }
    if (context.evolutionTrend === LONGITUDINAL_TREND.STABLE) {
      return LONGITUDINAL_COACHING_STATE.STABLE;
    }
    return LONGITUDINAL_COACHING_STATE.UNKNOWN;
  }

  private resolveStability(
    context: ProgressContext,
    trends: LongitudinalTrendProfile,
  ): LongitudinalStability {
    if (context.evidenceStrength === 'INSUFFICIENT') {
      return LONGITUDINAL_STABILITY.UNKNOWN;
    }

    const directional = [
      trends.frequency,
      trends.adherence,
      trends.hydration,
      trends.nutrition,
      trends.training,
      context.consistencyTrend,
    ].filter((trend) => trend !== LONGITUDINAL_TREND.UNKNOWN);
    const improving = directional.filter(
      (trend) => trend === LONGITUDINAL_TREND.IMPROVING,
    ).length;
    const declining = directional.filter(
      (trend) => trend === LONGITUDINAL_TREND.DECLINING,
    ).length;

    if (improving > 0 && declining > 0) return LONGITUDINAL_STABILITY.UNSTABLE;
    if (
      context.adherence.trend !== LONGITUDINAL_TREND.STABLE &&
      context.adherence.trend !== LONGITUDINAL_TREND.UNKNOWN
    ) {
      return LONGITUDINAL_STABILITY.VARIABLE;
    }
    return LONGITUDINAL_STABILITY.STABLE;
  }

  private resolvePriorities(
    input: LongitudinalCoachingInput,
    context: ProgressContext,
    state: LongitudinalCoachingState,
  ): LongitudinalDomainPriorities {
    const safetyBlocked =
      context.clinicalContext ||
      input.safetySignals.acutePain ||
      input.safetySignals.fever ||
      input.safetySignals.rehabilitation ||
      input.safetySignals.physicalIncapacity;
    const nutritionRelevant =
      context.goal === 'WEIGHT_LOSS' ||
      context.goal === 'HYPERTROPHY' ||
      context.goal === 'MAINTENANCE' ||
      context.nutritionTrend === LONGITUDINAL_TREND.DECLINING;
    const trainingRelevant =
      context.modality !== 'UNKNOWN' ||
      input.activePlans.some((plan) => plan.domain === 'WORKOUT');
    const behaviorRelevant =
      context.adherence.level === LONGITUDINAL_LEVEL.LOW ||
      context.motivation.level === LONGITUDINAL_LEVEL.LOW ||
      context.relapseSeverity !== null;

    return {
      nutrition: this.priority(
        nutritionRelevant,
        context.nutritionTrend === LONGITUDINAL_TREND.DECLINING,
      ),
      training: this.priority(
        trainingRelevant,
        context.trainingTrend === LONGITUDINAL_TREND.DECLINING ||
          state === LONGITUDINAL_COACHING_STATE.REGRESSING,
      ),
      behavioral: this.priority(true, behaviorRelevant),
      safety: safetyBlocked
        ? LONGITUDINAL_PRIORITY.CRITICAL
        : input.safetySignals.poorRecovery
          ? LONGITUDINAL_PRIORITY.HIGH
          : LONGITUDINAL_PRIORITY.LOW,
    };
  }

  private resolveInterventionIntensity(
    input: LongitudinalCoachingInput,
    context: ProgressContext,
    decision: LongitudinalCoachingAction,
  ): LongitudinalInterventionIntensity {
    if (
      context.clinicalContext ||
      input.safetySignals.acutePain ||
      input.safetySignals.fever ||
      input.safetySignals.rehabilitation ||
      input.safetySignals.physicalIncapacity
    ) {
      return LONGITUDINAL_INTERVENTION_INTENSITY.RESTRICTED;
    }

    switch (decision) {
      case LONGITUDINAL_COACHING_DECISION.ASK_INFORMATION:
      case LONGITUDINAL_COACHING_DECISION.WAIT:
        return LONGITUDINAL_INTERVENTION_INTENSITY.MINIMAL;
      case LONGITUDINAL_COACHING_DECISION.KEEP_PLAN:
      case LONGITUDINAL_COACHING_DECISION.REDUCE:
        return LONGITUDINAL_INTERVENTION_INTENSITY.LOW;
      case LONGITUDINAL_COACHING_DECISION.ADAPT_PLAN:
      case LONGITUDINAL_COACHING_DECISION.DELOAD:
      case LONGITUDINAL_COACHING_DECISION.REVIEW:
        return LONGITUDINAL_INTERVENTION_INTENSITY.MODERATE;
      case LONGITUDINAL_COACHING_DECISION.INCREASE:
        return LONGITUDINAL_INTERVENTION_INTENSITY.HIGH;
    }
  }

  private collectRationale(
    context: ProgressContext,
    rationale: OrderedSet<LongitudinalRationaleCode>,
  ): void {
    if (context.adherence.level === LONGITUDINAL_LEVEL.HIGH) {
      rationale.add('HIGH_ADHERENCE');
    } else if (context.adherence.level === LONGITUDINAL_LEVEL.LOW) {
      rationale.add('LOW_ADHERENCE');
    }
    if (context.adherence.trend === LONGITUDINAL_TREND.IMPROVING) {
      rationale.add('ADHERENCE_IMPROVING');
    } else if (context.adherence.trend === LONGITUDINAL_TREND.DECLINING) {
      rationale.add('ADHERENCE_DECLINING');
    }
    if (context.motivation.level === LONGITUDINAL_LEVEL.LOW) {
      rationale.add('LOW_MOTIVATION');
    }
    if (context.nutritionTrend === LONGITUDINAL_TREND.IMPROVING) {
      rationale.add('NUTRITION_IMPROVING');
    } else if (context.nutritionTrend === LONGITUDINAL_TREND.DECLINING) {
      rationale.add('NUTRITION_DECLINING');
    }
    if (context.hydrationTrend === LONGITUDINAL_TREND.DECLINING) {
      rationale.add('HYDRATION_DECLINING');
    }
    if (context.trainingTrend === LONGITUDINAL_TREND.IMPROVING) {
      rationale.add('TRAINING_IMPROVING');
    } else if (context.trainingTrend === LONGITUDINAL_TREND.DECLINING) {
      rationale.add('TRAINING_DECLINING');
    }
    if (context.evolutionTrend === LONGITUDINAL_TREND.IMPROVING) {
      rationale.add('CONSISTENT_IMPROVEMENT');
    } else if (context.evolutionTrend === LONGITUDINAL_TREND.STABLE) {
      rationale.add('STABLE_EVOLUTION');
    }
    if (context.relapseSeverity !== null) rationale.add('RELAPSE_DETECTED');
  }

  private collectRisks(
    input: LongitudinalCoachingInput,
    context: ProgressContext,
    risks: RiskCollector,
  ): void {
    if (context.evidenceStrength === 'INSUFFICIENT') {
      risks.add('INSUFFICIENT_DATA', 'MEDIUM', 'GENERAL');
    }
    if (context.adherence.level === LONGITUDINAL_LEVEL.LOW) {
      risks.add('LOW_ADHERENCE', 'HIGH', 'BEHAVIOR');
    }
    if (context.adherence.trend === LONGITUDINAL_TREND.DECLINING) {
      risks.add('ADHERENCE_DECLINE', 'MEDIUM', 'BEHAVIOR');
    }
    if (context.interrupted) {
      risks.add('PROLONGED_INTERRUPTION', 'HIGH', 'GENERAL');
    }
    if (context.plateau) risks.add('PLATEAU', 'MEDIUM', 'GENERAL');
    if (context.regressionSeverity !== null) {
      risks.add('REGRESSION', context.regressionSeverity, 'GENERAL');
    }
    if (context.relapseSeverity !== null) {
      risks.add('RELAPSE', context.relapseSeverity, 'BEHAVIOR');
    }
    if (input.safetySignals.poorRecovery) {
      risks.add('POOR_RECOVERY', 'HIGH', 'TRAINING');
    }
    if (context.clinicalContext) {
      risks.add('CLINICAL_BOUNDARY', 'CRITICAL', 'SAFETY');
    }
    if (input.safetySignals.acutePain) {
      risks.add('ACUTE_PAIN', 'CRITICAL', 'SAFETY');
    }
    if (input.safetySignals.fever) risks.add('FEVER', 'CRITICAL', 'SAFETY');
    if (input.safetySignals.rehabilitation) {
      risks.add('REHABILITATION', 'CRITICAL', 'SAFETY');
    }
    if (input.safetySignals.physicalIncapacity) {
      risks.add('PHYSICAL_INCAPACITY', 'CRITICAL', 'SAFETY');
    }
  }

  private adherence(
    snapshot: CoachProfileSnapshot,
    canonical: CanonicalInput,
  ): LongitudinalAdherenceAssessment {
    const samples = [
      ...canonical.history.flatMap((item) =>
        item.adherenceScore === undefined
          ? []
          : [this.timed(item.observedAt, item.adherenceScore)],
      ),
      ...canonical.checkIns.map((item) =>
        this.timed(item.observedAt, item.adherenceScore),
      ),
    ].sort((left, right) => left.observedAt - right.observedAt);
    const snapshotValue = this.datumValue(snapshot.longitudinal.adherenceScore);
    const recent = samples.slice(-6);
    const score =
      recent.length > 0
        ? this.average(recent.map((item) => item.value))
        : snapshotValue;

    return {
      level: this.level(score),
      score: score === undefined ? null : this.round(score),
      trend: this.metricTrend(samples, 5),
    };
  }

  private motivation(
    snapshot: CoachProfileSnapshot,
    checkIns: readonly LongitudinalFitnessCheckInObservation[],
  ): LongitudinalMotivationAssessment {
    const samples = checkIns.map((item) =>
      this.timed(
        item.observedAt,
        item.energyLevel === 'HIGH'
          ? 90
          : item.energyLevel === 'MEDIUM'
            ? 60
            : 25,
      ),
    );
    const recent = samples.slice(-4);

    if (recent.length > 0) {
      const score = this.average(recent.map((item) => item.value));
      return {
        level: this.level(score),
        trend: this.metricTrend(samples, 10),
      };
    }

    const stage = this.datumValue(snapshot.conversation.behavioralStage);
    const level: LongitudinalLevel =
      stage === 'ACTION' || stage === 'MAINTENANCE'
        ? LONGITUDINAL_LEVEL.HIGH
        : stage === 'PREPARATION'
          ? LONGITUDINAL_LEVEL.MODERATE
          : stage === 'CONTEMPLATION' || stage === 'PRE_CONTEMPLATION'
            ? LONGITUDINAL_LEVEL.LOW
            : LONGITUDINAL_LEVEL.UNKNOWN;
    return { level, trend: LONGITUDINAL_TREND.UNKNOWN };
  }

  private weightTrend(
    progress: readonly LongitudinalProgressObservation[],
  ): LongitudinalWeightTrend {
    if (progress.length < 2) return LONGITUDINAL_WEIGHT_TREND.UNKNOWN;
    const first = progress[0];
    const last = progress[progress.length - 1];
    const threshold = Math.max(0.5, first.weightKg * 0.005);
    const delta = last.weightKg - first.weightKg;
    if (delta >= threshold) return LONGITUDINAL_WEIGHT_TREND.INCREASING;
    if (delta <= -threshold) return LONGITUDINAL_WEIGHT_TREND.DECREASING;
    return LONGITUDINAL_WEIGHT_TREND.STABLE;
  }

  private physicalTrend(
    goal: LongitudinalPlanObjective,
    progress: readonly LongitudinalProgressObservation[],
    weightTrend: LongitudinalWeightTrend,
    rationale: OrderedSet<LongitudinalRationaleCode>,
  ): LongitudinalTrend {
    if (progress.length < 2) return LONGITUDINAL_TREND.UNKNOWN;
    const first = progress[0];
    const last = progress[progress.length - 1];

    if (goal === 'WEIGHT_LOSS') {
      if (weightTrend === LONGITUDINAL_WEIGHT_TREND.DECREASING) {
        rationale.add('WEIGHT_GOAL_ALIGNED');
        return LONGITUDINAL_TREND.IMPROVING;
      }
      if (weightTrend === LONGITUDINAL_WEIGHT_TREND.INCREASING) {
        rationale.add('WEIGHT_GOAL_DIVERGING');
        return LONGITUDINAL_TREND.DECLINING;
      }
      return LONGITUDINAL_TREND.STABLE;
    }

    if (goal === 'HYPERTROPHY') {
      if (first.muscleMassKg !== undefined && last.muscleMassKg !== undefined) {
        const delta = last.muscleMassKg - first.muscleMassKg;
        if (delta >= 0.3) {
          rationale.add('MUSCLE_PROGRESS');
          return LONGITUDINAL_TREND.IMPROVING;
        }
        if (delta <= -0.3) return LONGITUDINAL_TREND.DECLINING;
      }
      return weightTrend === LONGITUDINAL_WEIGHT_TREND.INCREASING
        ? LONGITUDINAL_TREND.IMPROVING
        : weightTrend === LONGITUDINAL_WEIGHT_TREND.DECREASING
          ? LONGITUDINAL_TREND.DECLINING
          : LONGITUDINAL_TREND.STABLE;
    }

    if (goal === 'MAINTENANCE') {
      if (weightTrend === LONGITUDINAL_WEIGHT_TREND.STABLE) {
        rationale.add('MAINTENANCE_ALIGNED');
        return LONGITUDINAL_TREND.STABLE;
      }
      return LONGITUDINAL_TREND.DECLINING;
    }

    return LONGITUDINAL_TREND.UNKNOWN;
  }

  private nutritionTrend(
    history: readonly LongitudinalHistoryObservation[],
  ): LongitudinalTrend {
    const calculated = this.metricTrend(
      history.flatMap((item) =>
        item.nutritionScore === undefined
          ? []
          : [this.timed(item.observedAt, item.nutritionScore)],
      ),
      5,
    );
    if (calculated !== LONGITUDINAL_TREND.UNKNOWN) return calculated;

    return this.latestExplicitTrend(history, 'nutritionDirection');
  }

  private latestExplicitTrend(
    history: readonly LongitudinalHistoryObservation[],
    field: 'nutritionDirection' | 'goalProgressDirection',
  ): LongitudinalTrend {
    for (let index = history.length - 1; index >= 0; index -= 1) {
      const value = history[index][field];
      if (value !== undefined) return value;
    }
    return LONGITUDINAL_TREND.UNKNOWN;
  }

  private aggregateTrend(
    trends: readonly LongitudinalTrend[],
  ): LongitudinalTrend {
    const known = trends.filter(
      (trend) => trend !== LONGITUDINAL_TREND.UNKNOWN,
    );
    if (known.length === 0) return LONGITUDINAL_TREND.UNKNOWN;
    const improving = known.filter(
      (trend) => trend === LONGITUDINAL_TREND.IMPROVING,
    ).length;
    const declining = known.filter(
      (trend) => trend === LONGITUDINAL_TREND.DECLINING,
    ).length;
    if (improving > declining) return LONGITUDINAL_TREND.IMPROVING;
    if (declining > improving) return LONGITUDINAL_TREND.DECLINING;
    return LONGITUDINAL_TREND.STABLE;
  }

  private metricTrend(
    samples: readonly TimedValue[],
    threshold: number,
  ): LongitudinalTrend {
    if (samples.length < 2) return LONGITUDINAL_TREND.UNKNOWN;
    const sorted = [...samples].sort(
      (left, right) => left.observedAt - right.observedAt,
    );
    const split = Math.ceil(sorted.length / 2);
    const first = sorted.slice(0, Math.max(1, sorted.length - split));
    const second = sorted.slice(split === sorted.length ? split - 1 : split);
    const delta =
      this.average(second.map((item) => item.value)) -
      this.average(first.map((item) => item.value));
    if (delta >= threshold) return LONGITUDINAL_TREND.IMPROVING;
    if (delta <= -threshold) return LONGITUDINAL_TREND.DECLINING;
    return LONGITUDINAL_TREND.STABLE;
  }

  private regressionSeverity(
    trends: readonly LongitudinalTrend[],
    relapse: Exclude<LongitudinalSeverity, 'CRITICAL'> | null,
  ): LongitudinalSeverity | null {
    const declining = trends.filter(
      (trend) => trend === LONGITUDINAL_TREND.DECLINING,
    ).length;
    if (relapse === 'HIGH' || declining >= 3) return 'HIGH';
    if (relapse === 'MEDIUM' || declining >= 2) return 'MEDIUM';
    if (relapse === 'LOW' || declining === 1) return 'LOW';
    return null;
  }

  private relapseSeverity(
    history: readonly LongitudinalHistoryObservation[],
  ): Exclude<LongitudinalSeverity, 'CRITICAL'> | null {
    const latest = [...history]
      .reverse()
      .find((item) => item.relapseSeverity !== undefined);
    return latest?.relapseSeverity ?? null;
  }

  private isPlateau(
    goal: LongitudinalPlanObjective,
    weight: LongitudinalWeightTrend,
    evolution: LongitudinalTrend,
    count: number,
    spanDays: number,
  ): boolean {
    return (
      goal !== 'MAINTENANCE' &&
      count >= 4 &&
      spanDays >= PLATEAU_DAYS &&
      evolution === LONGITUDINAL_TREND.STABLE &&
      weight === LONGITUDINAL_WEIGHT_TREND.STABLE
    );
  }

  private isInterrupted(
    observationDates: readonly number[],
    referenceDate: Date,
  ): boolean {
    if (observationDates.length === 0) return false;
    const latest = observationDates[observationDates.length - 1];
    return (
      Math.floor((referenceDate.getTime() - latest) / DAY_MS) >=
      INTERRUPTION_DAYS
    );
  }

  private evidenceStrength(
    count: number,
    spanDays: number,
  ): LongitudinalEvidenceStrength {
    if (count < 2 || spanDays < 7) return 'INSUFFICIENT';
    if (count < 4 || spanDays < 14) return 'LIMITED';
    if (count < 8 || spanDays < 42) return 'SUFFICIENT';
    return 'STRONG';
  }

  private resolveGoal(
    snapshot: CoachProfileSnapshot,
    plans: readonly LongitudinalActivePlanReference[],
  ): LongitudinalPlanObjective {
    const active = plans.find((plan) => plan.objective !== 'OTHER');
    if (active) return active.objective;
    const nutritionGoal = this.datumValue(snapshot.nutrition.primaryGoal);
    const trainingGoal = this.datumValue(snapshot.training.primaryGoal);
    const goal = nutritionGoal ?? trainingGoal;
    return goal === 'WEIGHT_LOSS'
      ? 'WEIGHT_LOSS'
      : goal === 'MUSCLE_GAIN'
        ? 'HYPERTROPHY'
        : goal === 'MAINTENANCE'
          ? 'MAINTENANCE'
          : 'OTHER';
  }

  private resolveModality(
    snapshot: CoachProfileSnapshot,
    plans: readonly LongitudinalActivePlanReference[],
  ): LongitudinalTrainingModality {
    const planModality = plans.find(
      (plan) => plan.domain === 'WORKOUT' && plan.modality !== undefined,
    )?.modality;
    if (planModality) return planModality;

    const value = this.datumValue(snapshot.training.preferredModality);
    if (!value) return 'UNKNOWN';
    const normalized = this.normalize(value);
    if (this.includes(normalized, ['corrida', 'running'])) return 'RUNNING';
    if (this.includes(normalized, ['caminhada', 'walking'])) return 'WALKING';
    if (this.includes(normalized, ['ciclismo', 'bike', 'cycling'])) {
      return 'CYCLING';
    }
    if (normalized.includes('crossfit')) return 'CROSSFIT';
    if (normalized.includes('funcional')) return 'FUNCTIONAL';
    if (normalized.includes('calisten')) return 'CALISTHENICS';
    if (normalized.includes('mobilidade')) return 'MOBILITY';
    if (normalized.includes('recuperacao')) return 'ACTIVE_RECOVERY';
    if (this.includes(normalized, ['musculacao', 'academia', 'forca'])) {
      return 'STRENGTH_TRAINING';
    }
    if (this.includes(normalized, ['fitness', 'geral']))
      return 'GENERAL_FITNESS';
    return 'UNKNOWN';
  }

  private priority(relevant: boolean, elevated: boolean): LongitudinalPriority {
    return elevated
      ? LONGITUDINAL_PRIORITY.HIGH
      : relevant
        ? LONGITUDINAL_PRIORITY.MEDIUM
        : LONGITUDINAL_PRIORITY.NONE;
  }

  private level(score: number | undefined): LongitudinalLevel {
    if (score === undefined) return LONGITUDINAL_LEVEL.UNKNOWN;
    if (score >= 75) return LONGITUDINAL_LEVEL.HIGH;
    if (score >= 50) return LONGITUDINAL_LEVEL.MODERATE;
    return LONGITUDINAL_LEVEL.LOW;
  }

  private hasNewPlan(
    plans: readonly LongitudinalActivePlanReference[],
    referenceDate: Date,
  ): boolean {
    return plans.some(
      (plan) =>
        (referenceDate.getTime() - this.timestamp(plan.generatedAt)) / DAY_MS <=
        NEW_PLAN_DAYS,
    );
  }

  private hasKnownItems<T>(datum: CoachProfileDatum<readonly T[]>): boolean {
    const value = this.datumValue(datum);
    return value !== undefined && value.length > 0;
  }

  private datumValue<T>(datum: CoachProfileDatum<T>): T | undefined {
    return 'value' in datum ? datum.value : undefined;
  }

  private canonicalCollection<T extends object>(
    values: readonly T[],
    validate: (value: T) => void,
  ): readonly T[] {
    const unique = new Map<string, T>();
    for (const value of values) {
      validate(value);
      unique.set(stableSerialize(value), value);
    }
    return [...unique.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([, value]) => value)
      .sort(
        (left, right) =>
          this.timestamp(this.temporalValue(left)) -
          this.timestamp(this.temporalValue(right)),
      );
  }

  private temporalValue(value: object): string {
    if ('observedAt' in value && typeof value.observedAt === 'string') {
      return value.observedAt;
    }
    if ('generatedAt' in value && typeof value.generatedAt === 'string') {
      return value.generatedAt;
    }
    if ('decidedAt' in value && typeof value.decidedAt === 'string') {
      return value.decidedAt;
    }
    throw new Error('Registro longitudinal sem referência temporal');
  }

  private validateHistory(
    item: LongitudinalHistoryObservation,
    referenceDate: Date,
  ): void {
    this.pastDate(item.observedAt, referenceDate, 'history.observedAt');
    this.optionalScore(item.adherenceScore, 'history.adherenceScore');
    this.optionalScore(item.consistencyScore, 'history.consistencyScore');
    this.optionalScore(item.hydrationScore, 'history.hydrationScore');
    this.optionalScore(item.nutritionScore, 'history.nutritionScore');
    this.optionalScore(
      item.trainingCompletionScore,
      'history.trainingCompletionScore',
    );
    this.optionalScore(item.goalProgressScore, 'history.goalProgressScore');
    if (
      item.trainingFrequency !== undefined &&
      (!Number.isFinite(item.trainingFrequency) ||
        item.trainingFrequency < 0 ||
        item.trainingFrequency > 21)
    ) {
      throw new Error('history.trainingFrequency fora do intervalo permitido');
    }
  }

  private validateProgress(
    item: LongitudinalProgressObservation,
    referenceDate: Date,
  ): void {
    this.pastDate(item.observedAt, referenceDate, 'progress.observedAt');
    this.positive(item.weightKg, 'progress.weightKg');
    this.optionalPositive(item.bodyFatPercent, 'progress.bodyFatPercent');
    this.optionalPositive(item.muscleMassKg, 'progress.muscleMassKg');
    this.optionalPositive(item.bmi, 'progress.bmi');
  }

  private validateCheckIn(
    item: LongitudinalFitnessCheckInObservation,
    referenceDate: Date,
  ): void {
    this.pastDate(item.observedAt, referenceDate, 'checkIn.observedAt');
    this.optionalScore(item.adherenceScore, 'checkIn.adherenceScore');
  }

  private validatePlan(
    item: LongitudinalActivePlanReference,
    referenceDate: Date,
  ): void {
    this.pastDate(item.generatedAt, referenceDate, 'plan.generatedAt');
  }

  private validatePreviousDecision(
    item: PreviousLongitudinalDecisionReference,
    referenceDate: Date,
  ): void {
    this.pastDate(item.decidedAt, referenceDate, 'decision.decidedAt');
  }

  private validateSafetySignals(input: LongitudinalCoachingInput): void {
    for (const value of Object.values(input.safetySignals)) {
      if (typeof value !== 'boolean') {
        throw new Error('Sinal de segurança longitudinal inválido');
      }
    }
  }

  private optionalScore(value: number | undefined, field: string): void {
    if (
      value !== undefined &&
      (!Number.isFinite(value) || value < 0 || value > 100)
    ) {
      throw new Error(`${field} fora do intervalo permitido`);
    }
  }

  private positive(value: number, field: string): void {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`${field} deve ser positivo`);
    }
  }

  private optionalPositive(value: number | undefined, field: string): void {
    if (value !== undefined) this.positive(value, field);
  }

  private pastDate(value: string, referenceDate: Date, field: string): void {
    const parsed = this.date(value, field);
    if (parsed.getTime() > referenceDate.getTime()) {
      throw new Error(`${field} não pode estar no futuro`);
    }
  }

  private date(value: string, field: string): Date {
    const parsed = new Date(value);
    if (!value || Number.isNaN(parsed.getTime())) {
      throw new Error(`${field} inválida`);
    }
    return parsed;
  }

  private timed(observedAt: string, value: number): TimedValue {
    return { observedAt: this.timestamp(observedAt), value };
  }

  private timestamp(value: string): number {
    return new Date(value).getTime();
  }

  private spanDays(values: readonly number[]): number {
    if (values.length < 2) return 0;
    return Math.floor((values[values.length - 1] - values[0]) / DAY_MS);
  }

  private average(values: readonly number[]): number {
    return values.length === 0
      ? 0
      : values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  private round(value: number): number {
    return Math.round(value * 100) / 100;
  }

  private normalize(value: string): string {
    return value
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLocaleLowerCase('pt-BR')
      .replace(/[^a-z0-9 ]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private includes(value: string, terms: readonly string[]): boolean {
    return terms.some((term) => value.includes(term));
  }
}

class OrderedSet<T extends string> {
  private readonly entries = new Set<T>();

  add(value: T): void {
    this.entries.add(value);
  }

  values(): readonly T[] {
    return [...this.entries];
  }
}

class RiskCollector {
  private readonly entries = new Map<LongitudinalRiskCode, LongitudinalRisk>();

  add(
    code: LongitudinalRiskCode,
    severity: LongitudinalSeverity,
    domain: LongitudinalRisk['domain'],
  ): void {
    if (!this.entries.has(code))
      this.entries.set(code, { code, severity, domain });
  }

  values(): readonly LongitudinalRisk[] {
    return [...this.entries.values()];
  }
}

function stableSerialize(value: object): string {
  return JSON.stringify(sortRecord(value));
}

function sortRecord(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortRecord);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, sortRecord(nested)]),
  );
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}
