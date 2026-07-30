import type { CoachProfileSnapshot } from '../context/coach-profile-snapshot.contract';
import type {
  UnifiedShadowDecisionPipelineResult,
  UnifiedShadowDomainComparison,
  UnifiedShadowExecutionArtifacts,
} from '../unified-shadow-decision/unified-shadow-decision.contract';
import type { ShadowEvaluationPlatform } from './shadow-evaluation-platform';
import {
  SHADOW_OBSERVATION_SCHEMA_VERSION,
  ShadowObservableDecisionComparison,
  ShadowObservableDomainComparison,
  ShadowObservableNutritionAdapterResult,
  ShadowObservableNutritionReasoning,
  ShadowObservableWorkoutAdapterResult,
  ShadowObservableWorkoutReasoning,
  ShadowObservationEnvelope,
} from './shadow-observation-envelope.contract';

export interface ShadowObservationEmitterInput {
  readonly runId: string;
  readonly snapshot: CoachProfileSnapshot;
  readonly artifacts: UnifiedShadowExecutionArtifacts;
  readonly pipelineResult: UnifiedShadowDecisionPipelineResult;
}

export type ShadowObservationEmissionResult =
  | Readonly<{
      status: 'SKIPPED';
      reason: 'PIPELINE_NOT_COMPLETED';
    }>
  | Readonly<{ status: 'SUCCESS' }>
  | Readonly<{
      status: 'FAILED';
      reason: 'EVALUATION_FAILED';
    }>;

type CompletedPipelineResult = Extract<
  UnifiedShadowDecisionPipelineResult,
  { readonly status: 'COMPLETED' }
>;

export interface CompletedShadowObservationEmitterInput extends Omit<
  ShadowObservationEmitterInput,
  'pipelineResult'
> {
  readonly pipelineResult: CompletedPipelineResult;
}

type ShadowEvaluationPort = Pick<ShadowEvaluationPlatform, 'evaluate'>;

export class ShadowObservationEmitter {
  constructor(private readonly evaluationPlatform: ShadowEvaluationPort) {}

  emit(input: ShadowObservationEmitterInput): ShadowObservationEmissionResult {
    if (input.pipelineResult.status !== 'COMPLETED') {
      return Object.freeze({
        status: 'SKIPPED',
        reason: 'PIPELINE_NOT_COMPLETED',
      });
    }

    try {
      const envelope = this.createEnvelope({
        runId: input.runId,
        snapshot: input.snapshot,
        artifacts: input.artifacts,
        pipelineResult: input.pipelineResult,
      });
      this.evaluationPlatform.evaluate(envelope);
      return Object.freeze({ status: 'SUCCESS' });
    } catch {
      return Object.freeze({
        status: 'FAILED',
        reason: 'EVALUATION_FAILED',
      });
    }
  }

  createEnvelope(
    input: CompletedShadowObservationEmitterInput,
  ): ShadowObservationEnvelope {
    const nutritionReasoning = this.nutritionReasoning(
      input.artifacts.nutritionReasoning,
    );
    const workoutReasoning = this.workoutReasoning(
      input.artifacts.workoutReasoning,
    );
    const longitudinal = input.artifacts.longitudinalDecision;

    return deepFreeze({
      schemaVersion: SHADOW_OBSERVATION_SCHEMA_VERSION,
      runId: input.runId,
      snapshot: {
        referenceDate: input.snapshot.referenceDate,
        completion: {
          overall: input.snapshot.completion.overall,
          sections: input.snapshot.completion.sections.map((section) => ({
            section: section.section,
            state: section.state,
            ready: section.ready,
            requiredFields: [...section.requiredFields],
            availableFields: [...section.availableFields],
            missingFields: [...section.missingFields],
            confirmationRequiredFields: [...section.confirmationRequiredFields],
          })),
        },
      },
      artifacts: {
        adaptiveDecision: {
          intent: input.artifacts.adaptiveDecision.intent,
          shouldAsk: input.artifacts.adaptiveDecision.shouldAsk,
          orderedCandidates:
            input.artifacts.adaptiveDecision.orderedCandidates.map(
              (candidate) => ({
                field: candidate.field,
                state: candidate.state,
                knowledgeStatus: candidate.knowledgeStatus,
              }),
            ),
        },
        plannerDecision: {
          recognizedIntent: input.artifacts.plannerDecision.recognizedIntent,
          goal: input.artifacts.plannerDecision.goal,
          targetPlan: input.artifacts.plannerDecision.targetPlan,
          canExecute: input.artifacts.plannerDecision.canExecute,
        },
        longitudinalDecision: {
          currentState: longitudinal.currentState,
          decision: longitudinal.decision,
          priorities: { safety: longitudinal.priorities.safety },
          risks: longitudinal.risks.map((risk) => ({ code: risk.code })),
          interventionIntensity: longitudinal.interventionIntensity,
          metadata: {
            policyVersion: longitudinal.metadata.policyVersion,
            deterministic: longitudinal.metadata.deterministic,
          },
        },
        nutritionReasoning,
        workoutReasoning,
        workoutLegacyStrategy: input.artifacts.workoutLegacyStrategy
          ? {
              objective: clonePlanningValue(
                input.artifacts.workoutLegacyStrategy.objective,
              ),
            }
          : null,
        nutritionShadowStrategy: this.nutritionAdapter(
          input.artifacts.nutritionShadowStrategy,
        ),
        workoutShadowStrategy: this.workoutAdapter(
          input.artifacts.workoutShadowStrategy,
        ),
      },
      pipelineResult: {
        status: 'COMPLETED',
        comparison: this.comparison(input.pipelineResult.comparison),
        auditMetadata: {
          status: input.pipelineResult.auditMetadata.status,
          plannerGoal: input.pipelineResult.auditMetadata.plannerGoal,
          collectorShouldAsk:
            input.pipelineResult.auditMetadata.collectorShouldAsk,
          overallCategory: input.pipelineResult.auditMetadata.overallCategory,
          nutritionCategory:
            input.pipelineResult.auditMetadata.nutritionCategory,
          workoutCategory: input.pipelineResult.auditMetadata.workoutCategory,
          longitudinalCategory:
            input.pipelineResult.auditMetadata.longitudinalCategory,
          nutritionIntensity:
            input.pipelineResult.auditMetadata.nutritionIntensity,
          nutritionComplexity:
            input.pipelineResult.auditMetadata.nutritionComplexity,
          workoutIntensity: input.pipelineResult.auditMetadata.workoutIntensity,
          workoutComplexity:
            input.pipelineResult.auditMetadata.workoutComplexity,
          workoutProgression:
            input.pipelineResult.auditMetadata.workoutProgression,
          longitudinalDecision:
            input.pipelineResult.auditMetadata.longitudinalDecision,
          differenceDimensions: [
            ...input.pipelineResult.auditMetadata.differenceDimensions,
          ],
          nutritionStrategyCodes: [
            ...input.pipelineResult.auditMetadata.nutritionStrategyCodes,
          ],
          workoutStrategyCodes: [
            ...input.pipelineResult.auditMetadata.workoutStrategyCodes,
          ],
          latency: { ...input.pipelineResult.auditMetadata.latency },
          versions: { ...input.pipelineResult.auditMetadata.versions },
        },
        auditPersisted: input.pipelineResult.auditPersisted,
      },
      safetyIndicators: {
        nutritionRestricted:
          nutritionReasoning?.metadata.safetyRestricted ?? false,
        workoutRestricted: workoutReasoning?.metadata.safetyRestricted ?? false,
        longitudinalCritical: longitudinal.priorities.safety === 'CRITICAL',
        mandatoryReview:
          longitudinal.decision === 'REVIEW' ||
          workoutReasoning?.progressionDecision === 'REASSESS',
        mandatoryDeload:
          longitudinal.decision === 'DELOAD' ||
          workoutReasoning?.progressionDecision === 'DELOAD',
        paused: workoutReasoning?.progressionDecision === 'PAUSE',
        clinicalBoundary: longitudinal.risks.some(
          (risk) => risk.code === 'CLINICAL_BOUNDARY',
        ),
      },
    });
  }

  private nutritionReasoning(
    reasoning: UnifiedShadowExecutionArtifacts['nutritionReasoning'],
  ): ShadowObservableNutritionReasoning | null {
    if (!reasoning) return null;
    return {
      packageDecisions: reasoning.packageDecisions.map((decision) => ({
        packageId: decision.packageId,
        disposition: decision.disposition,
      })),
      resolvedConflicts: reasoning.resolvedConflicts.map((conflict) => ({
        conflict: conflict.conflict,
      })),
      selectedStrategies: reasoning.selectedStrategies.map((strategy) => ({
        strategy: strategy.strategy,
      })),
      prohibitedStrategies: reasoning.prohibitedStrategies.map((strategy) => ({
        strategy: strategy.strategy,
      })),
      interventionIntensity: reasoning.interventionIntensity,
      personalizationLevel: reasoning.personalizationLevel,
      recommendedComplexity: reasoning.recommendedComplexity,
      priorities: { ...reasoning.priorities },
      metadata: {
        strategyVersion: reasoning.metadata.strategyVersion,
        deterministic: reasoning.metadata.deterministic,
        safetyRestricted: reasoning.metadata.safetyRestricted,
      },
    };
  }

  private workoutReasoning(
    reasoning: UnifiedShadowExecutionArtifacts['workoutReasoning'],
  ): ShadowObservableWorkoutReasoning | null {
    if (!reasoning) return null;
    return {
      primaryObjective: reasoning.primaryObjective,
      modality: { resolved: reasoning.modality.resolved },
      knowledgeDecisions: reasoning.knowledgeDecisions.map((decision) => ({
        packageId: decision.packageId,
        disposition: decision.disposition,
      })),
      resolvedConflicts: reasoning.resolvedConflicts.map((conflict) => ({
        conflict: conflict.conflict,
      })),
      selectedStrategies: reasoning.selectedStrategies.map((strategy) => ({
        strategy: strategy.strategy,
      })),
      prohibitedStrategies: reasoning.prohibitedStrategies.map((strategy) => ({
        prohibition: strategy.prohibition,
      })),
      interventionIntensity: reasoning.interventionIntensity,
      authorizedComplexity: reasoning.authorizedComplexity,
      progressionDecision: reasoning.progressionDecision,
      priorities: { ...reasoning.priorities },
      metadata: {
        strategyVersion: reasoning.metadata.strategyVersion,
        deterministic: reasoning.metadata.deterministic,
        safetyRestricted: reasoning.metadata.safetyRestricted,
      },
    };
  }

  private nutritionAdapter(
    strategy: UnifiedShadowExecutionArtifacts['nutritionShadowStrategy'],
  ): ShadowObservableNutritionAdapterResult | null {
    if (!strategy) return null;
    return {
      adapterVersion: strategy.adapterVersion,
      artifactType: strategy.artifactType,
      interventionIntensity: strategy.interventionIntensity,
      complexity: strategy.complexity,
      personalization: strategy.personalization,
      variationPolicy: strategy.variationPolicy,
      detailLevel: strategy.detailLevel,
      trainingAware: strategy.trainingAware,
      safetyRestricted: strategy.safetyRestricted,
      restrictionCodes: [...strategy.restrictionCodes],
      selectedStrategies: [...strategy.selectedStrategies],
      prohibitedStrategies: [...strategy.prohibitedStrategies],
    };
  }

  private workoutAdapter(
    strategy: UnifiedShadowExecutionArtifacts['workoutShadowStrategy'],
  ): ShadowObservableWorkoutAdapterResult | null {
    if (!strategy) return null;
    return {
      adapterVersion: strategy.adapterVersion,
      artifactType: strategy.artifactType,
      modality: strategy.modality,
      objective: strategy.objective,
      interventionIntensity: strategy.interventionIntensity,
      complexity: strategy.complexity,
      personalization: strategy.personalization,
      progression: strategy.progression,
      requiredBlocks: [...strategy.requiredBlocks],
      maximumActivitiesPerSession: strategy.maximumActivitiesPerSession,
      technicalMovementsAllowed: strategy.technicalMovementsAllowed,
      safetyRestricted: strategy.safetyRestricted,
      constraintCodes: [...strategy.constraintCodes],
      selectedStrategies: [...strategy.selectedStrategies],
      prohibitedStrategies: [...strategy.prohibitedStrategies],
    };
  }

  private comparison(
    comparison: CompletedPipelineResult['comparison'],
  ): ShadowObservableDecisionComparison {
    return {
      comparatorVersion: comparison.comparatorVersion,
      nutrition: this.optionalDomainComparison(comparison.nutrition),
      workout: this.optionalDomainComparison(comparison.workout),
      longitudinal: this.domainComparison(comparison.longitudinal),
      overallCategory: comparison.overallCategory,
    };
  }

  private optionalDomainComparison(
    comparison: UnifiedShadowDomainComparison | null,
  ): ShadowObservableDomainComparison | null {
    return comparison ? this.domainComparison(comparison) : null;
  }

  private domainComparison(
    comparison: UnifiedShadowDomainComparison,
  ): ShadowObservableDomainComparison {
    return {
      category: comparison.category,
      exact: comparison.exact,
      differences: comparison.differences.map((difference) => ({
        domain: difference.domain,
        dimension: difference.dimension,
      })),
    };
  }
}

function clonePlanningValue<T>(
  value:
    | Readonly<{
        status: 'CONFIRMED' | 'INFERRED' | 'REQUIRES_CONFIRMATION';
        value: T;
      }>
    | Readonly<{ status: 'NOT_SET' }>,
) {
  return value.status === 'NOT_SET'
    ? { status: value.status }
    : { status: value.status, value: value.value };
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}
