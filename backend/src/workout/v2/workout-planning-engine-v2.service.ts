import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AIJobStatus, AIJobType, Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { AIService } from '../../ai/ai.service';
import { AuditService } from '../../observability/audit.service';
import { WorkoutPromptActivationService } from './workout-prompt-activation.service';
import { modalityExpertise } from './workout-modality-expertise.policy';
import { WORKOUT_PLAN_GENERATION } from '../../entitlements/entitlement.constants';
import { WorkoutArtifactResolverService } from './workout-artifact-resolver.service';
import { freezeWorkoutPlanV2 } from './workout-plan-v2.freeze';
import { WorkoutPlanV2Parser } from './workout-plan-v2.parser';
import { applyWorkoutTargetedMutation } from './workout-targeted-mutation.policy';
import { canonicalizeWorkoutTimedDurations } from './workout-timed-duration.canonicalizer';
import { WorkoutPlanV2Validator } from './workout-plan-v2.validator';
import type {
  GeneratedWorkoutPlanV2Candidate,
  WorkoutPlanV2,
  WorkoutPlanValidationResult,
} from './workout-plan-v2.contract';
import { WorkoutPlanningContextBuilder } from './workout-planning-context.builder';
import type {
  GenerateWorkoutPlanV2Input,
  PreparedWorkoutPlanningV2,
  WorkoutPlanningGenerationResult,
  WorkoutPlanningStoredAIJobResult,
} from './workout-planning-generation.contract';
import { WorkoutPlanningReadinessService } from './workout-planning-readiness.service';
import { WorkoutPlanningSafetyService } from './workout-planning-safety.service';
import { WorkoutPlanningStrategyService } from './workout-planning-strategy.service';
import {
  WORKOUT_PLANNING_V2_PROMPT,
  workoutSchemaForAuthorizedEquipment,
} from './workout-planning-v2.prompt.definition';

export const WORKOUT_PLANNING_V2_EXECUTION_REVISION =
  'timed-clock-canonical-v1' as const;

export class WorkoutPostGenerationValidationError extends BadGatewayException {
  constructor(readonly validation: WorkoutPlanValidationResult) {
    super(
      `Treino V2 reprovado: ${validation.issues.map((issue) => issue.code).join(',')}`,
    );
  }
}

@Injectable()
export class WorkoutPlanningEngineV2Service {
  private readonly parser = new WorkoutPlanV2Parser();
  constructor(
    private readonly resolver: WorkoutArtifactResolverService,
    private readonly readiness: WorkoutPlanningReadinessService,
    private readonly contextBuilder: WorkoutPlanningContextBuilder,
    private readonly strategyBuilder: WorkoutPlanningStrategyService,
    private readonly safety: WorkoutPlanningSafetyService,
    private readonly validator: WorkoutPlanV2Validator,
    private readonly aiService: AIService,
    @Optional() private readonly audit: AuditService | undefined = undefined,
    private readonly promptActivation: WorkoutPromptActivationService,
  ) {}

  prepare(input: GenerateWorkoutPlanV2Input): PreparedWorkoutPlanningV2 {
    const modality =
      input.recognizedContext.modality?.status === 'NOT_SET'
        ? undefined
        : input.recognizedContext.modality?.value;
    const resolution = this.resolver.resolve({
      decision: input.decision,
      explicitArtifactType: input.recognizedContext.artifactType,
      explicitModality: modality,
    });
    if (!resolution.artifactType || !resolution.modality)
      return Object.freeze({
        resolution,
        readiness: null,
        context: null,
        strategy: null,
        safety: null,
      });
    const readiness = this.readiness.evaluate(
      input.snapshot,
      resolution.artifactType,
      resolution.modality,
      input.recognizedContext,
      input.previousPlan !== undefined,
    );
    const context = this.contextBuilder.build({
      snapshot: input.snapshot,
      artifactType: resolution.artifactType,
      modality: resolution.modality,
      recognizedContext: input.recognizedContext,
      referenceDate: input.referenceDate,
      progressEvidence: input.progressEvidence,
      previousPlan: input.previousPlan,
    });
    const strategy = this.strategyBuilder.build(context);
    const safety = this.safety.evaluateBeforeGeneration(
      input.snapshot,
      readiness,
    );
    return Object.freeze({ resolution, readiness, context, strategy, safety });
  }

  async generate(
    input: GenerateWorkoutPlanV2Input,
  ): Promise<WorkoutPlanningGenerationResult> {
    return this.generateCandidate(input);
  }

  async generateCandidate(
    input: GenerateWorkoutPlanV2Input,
  ): Promise<WorkoutPlanningGenerationResult> {
    const prepared = this.prepare(input);
    if (!prepared.context || !prepared.strategy || !prepared.safety)
      throw new BadRequestException(
        `Artefato de treino não resolvido: ${prepared.resolution.reason}`,
      );
    if (
      prepared.safety.outcome !== 'ALLOWED' &&
      prepared.safety.outcome !== 'LIMITED'
    )
      throw new BadRequestException(
        `Geração de treino bloqueada: ${prepared.safety.outcome}`,
      );
    await this.promptActivation.ensureActive();
    const payload = Object.freeze({
      schemaVersion: 2 as const,
      context: prepared.context,
      strategy: prepared.strategy,
      modalityExpertise: modalityExpertise[prepared.strategy.modality],
      safetyPolicy: Object.freeze({
        noDiagnosis: true,
        noRehabilitation: true,
        noExactLoad: true,
        noExactPace: true,
        noExactPower: true,
      }),
    });
    const canonical = this.canonicalJson(payload);
    const operationKey = `workout-planning-v2:${createHash('sha256').update(`${input.userId}:${WORKOUT_PLANNING_V2_PROMPT.version}:${WORKOUT_PLANNING_V2_EXECUTION_REVISION}:${canonical}`).digest('hex')}`;
    const job = await this.aiService.createStandaloneJob({
      userId: input.userId,
      type: AIJobType.WORKOUT,
      promptName: WORKOUT_PLANNING_V2_PROMPT.name,
      operationKey,
      ...(prepared.context.artifactType === 'WEEKLY_PLAN'
        ? { usageEntitlementCode: WORKOUT_PLAN_GENERATION }
        : {}),
    });
    if (
      job.promptVersion?.version !== WORKOUT_PLANNING_V2_PROMPT.version ||
      job.promptVersion?.name !== WORKOUT_PLANNING_V2_PROMPT.name
    ) {
      const error = new ServiceUnavailableException(
        'WORKOUT_PROMPT_VERSION_MISMATCH',
      );
      await this.aiService.failJob(job.id, error);
      throw error;
    }
    if (job.status === AIJobStatus.COMPLETED) {
      const stored = this.stored(job.result);
      if (!stored)
        throw new ServiceUnavailableException(
          'Resultado idempotente do treino V2 indisponível',
        );
      const output = this.finalize(
        this.parser.parse(stored.candidateOutput),
        prepared,
        {
          engineVersion: 2,
          promptVersionId: job.promptVersionId,
          aiJobId: job.id,
          operationKey,
          model: stored.model,
          generatedAt: input.referenceDate.toISOString(),
          reused: true,
        },
        input,
      );
      return Object.freeze({
        status: 'ALREADY_COMPLETED' as const,
        output,
        aiJobId: job.id,
        operationKey,
        storedResult: stored,
        reused: true as const,
        completion: null,
      });
    }
    if (job.status === AIJobStatus.FAILED)
      throw new ServiceUnavailableException(
        'Operação idempotente do treino V2 já falhou',
      );
    if (job.status === AIJobStatus.PROCESSING)
      throw new ServiceUnavailableException(
        'Operação idempotente do treino V2 em andamento',
      );
    let response: Awaited<ReturnType<AIService['runTextJob']>> | undefined;
    try {
      response = await this.aiService.runTextJob(job.id, {
        input: canonical,
        jsonSchema: workoutSchemaForAuthorizedEquipment(
          prepared.strategy.authorizedEquipment,
        ),
      });
      const output = this.finalize(
        this.parser.parse(response.outputText),
        prepared,
        {
          engineVersion: 2,
          promptVersionId: job.promptVersionId,
          aiJobId: job.id,
          operationKey,
          model: response.model,
          generatedAt: input.referenceDate.toISOString(),
          reused: false,
        },
        input,
      );
      const storedResult: WorkoutPlanningStoredAIJobResult = Object.freeze({
        candidateOutput: response.outputText,
        model: response.model,
      });
      return Object.freeze({
        status: 'PENDING_COMPLETION' as const,
        output,
        aiJobId: job.id,
        operationKey,
        storedResult,
        reused: false as const,
        completion: Object.freeze({
          userId: input.userId,
          aiJobId: job.id,
          jobType: AIJobType.WORKOUT,
          response,
          result: storedResult,
        }),
      });
    } catch (error: unknown) {
      if (response && error instanceof WorkoutPostGenerationValidationError) {
        await this.aiService.failJob(job.id, error, response, undefined, {
          candidateOutput: response.outputText,
          model: response.model,
          rejection: {
            stage: 'POST_GENERATION_VALIDATION',
            issues: error.validation.issues.map((issue) => ({ ...issue })),
          },
        });
      } else {
        await this.aiService.failJob(job.id, error, response);
      }
      throw error;
    }
  }

  private finalize(
    candidate: GeneratedWorkoutPlanV2Candidate,
    prepared: PreparedWorkoutPlanningV2,
    generationMetadata: WorkoutPlanV2['generationMetadata'],
    input: GenerateWorkoutPlanV2Input,
  ): WorkoutPlanV2 {
    if (!prepared.context || !prepared.strategy || !prepared.readiness)
      throw new BadGatewayException('Contexto de treino V2 ausente');
    if (
      input.previousPlan &&
      input.recognizedContext?.mutation?.kind === 'EXERCISE_SUBSTITUTION' &&
      input.recognizedContext.mutation.sourceActivityKey
    )
      candidate = applyWorkoutTargetedMutation(
        candidate,
        input.previousPlan,
        input.recognizedContext.mutation.sourceActivityKey,
      );
    candidate = canonicalizeWorkoutTimedDurations(candidate);
    const validation = this.validator.validate(
      candidate,
      prepared.context,
      prepared.strategy,
    );
    if (this.audit)
      void this.audit
        .record({
          userId: input.userId,
          action: 'WORKOUT_MODALITY_VALIDATED',
          entityType: 'AI_JOB',
          entityId: generationMetadata.aiJobId,
          metadata: {
            requestedWorkoutModality:
              prepared.context.modalityResolution?.modality ?? null,
            resolvedWorkoutModality: prepared.strategy.modality,
            modalityResolutionSource:
              prepared.context.modalityResolution?.source ?? 'PROFILE_FALLBACK',
            modalityConfidence:
              prepared.context.modalityResolution?.confidence ??
              (prepared.context.modality.status === 'CONFIRMED'
                ? 'HIGH'
                : 'LOW'),
            modalityValidationOutcome: validation.status,
            modalityViolationCode:
              validation.issues.find(
                (issue) =>
                  issue.code === 'MODALITY_ACTIVITY_CONFLICT' ||
                  issue.code === 'MODALITY_MISMATCH',
              )?.code ?? null,
          },
        })
        .catch(() => undefined);
    if (this.safety.evaluateAfterGeneration(validation).outcome === 'BLOCKED')
      throw new WorkoutPostGenerationValidationError(validation);
    const reference = prepared.context.previousPlan
      ? `workout-plan-v2:${createHash('sha256').update(this.canonicalJson(prepared.context.previousPlan)).digest('hex')}`
      : null;
    return freezeWorkoutPlanV2({
      schemaVersion: 2,
      artifactType: candidate.artifactType,
      modality: candidate.modality,
      objective: candidate.objective,
      secondaryObjectives: Object.freeze([
        ...(candidate.secondaryObjectives ??
          prepared.strategy.secondaryObjectives),
      ]),
      lifecycleReason: prepared.context.lifecyclePurpose,
      replacesPlanReference: reference,
      title: candidate.title,
      referenceDate: prepared.context.referenceDate,
      strategy: prepared.strategy,
      sessions: candidate.sessions,
      progression: candidate.progression,
      substitutions: candidate.substitutions,
      adaptationRules: candidate.adaptationRules,
      appliedConstraints: prepared.strategy.appliedConstraints,
      personalizationFactors: prepared.strategy.personalizationFactors,
      safetyFlags: Object.freeze([
        ...new Set([
          ...prepared.readiness.safetyFlags,
          ...candidate.safetyFlags,
        ]),
      ]),
      generationMetadata,
      validation,
    });
  }
  private stored(
    value: Prisma.JsonValue | null,
  ): WorkoutPlanningStoredAIJobResult | null {
    if (
      !this.isRecord(value) ||
      typeof value.candidateOutput !== 'string' ||
      typeof value.model !== 'string'
    )
      return null;
    return Object.freeze({
      candidateOutput: value.candidateOutput,
      model: value.model,
    });
  }
  private canonicalJson(value: unknown): string {
    if (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'boolean'
    )
      return JSON.stringify(value);
    if (typeof value === 'number') {
      if (!Number.isFinite(value))
        throw new BadRequestException('Número inválido no contexto de treino');
      return JSON.stringify(value);
    }
    if (Array.isArray(value))
      return `[${value.map((item) => this.canonicalJson(item)).join(',')}]`;
    if (this.isRecord(value))
      return `{${Object.keys(value)
        .sort()
        .map(
          (key) => `${JSON.stringify(key)}:${this.canonicalJson(value[key])}`,
        )
        .join(',')}}`;
    throw new BadRequestException(
      'Valor não serializável no contexto de treino',
    );
  }
  private isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
