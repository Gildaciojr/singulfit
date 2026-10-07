import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AIJobStatus, AIJobType, Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { AIService, AITextOperationError } from '../../ai/ai.service';
import type { WorkoutApplicationExecutionInputV2 } from './execution/workout-application-execution.contract';
import {
  durableTextOperation,
  DurableTextPendingError,
} from '../../ai/durable-text-operation.contract';
import { AuditService } from '../../observability/audit.service';
import { WorkoutPromptActivationService } from './workout-prompt-activation.service';
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
  WORKOUT_PLANNING_V2_PROMPT_V9,
  WORKOUT_PLANNING_V2_PROMPT_V11,
  WORKOUT_PLANNING_V2_PROMPT_V10,
  workoutSchemaForAuthorizedEquipment,
} from './workout-planning-v2.prompt.definition';

export const WORKOUT_PLANNING_V2_EXECUTION_REVISION =
  'ai-first-v10-weekday-v1' as const;

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
  private readonly preparedInputs = new WeakMap<
    GenerateWorkoutPlanV2Input,
    PreparedWorkoutPlanningV2
  >();
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
    const context = this.frozenCopy(
      this.contextBuilder.build({
        snapshot: input.snapshot,
        artifactType: resolution.artifactType,
        modality: resolution.modality,
        recognizedContext: input.recognizedContext,
        referenceDate: input.referenceDate,
        progressEvidence: input.progressEvidence,
        previousPlan: input.previousPlan,
      }),
    );
    const strategy = this.strategyBuilder.build(context);
    const safety = this.safety.evaluateBeforeGeneration(
      input.snapshot,
      readiness,
    );
    const prepared = Object.freeze({
      resolution,
      readiness,
      context,
      strategy,
      safety,
    });
    this.preparedInputs.set(input, prepared);
    return prepared;
  }

  async generate(
    input: GenerateWorkoutPlanV2Input,
  ): Promise<WorkoutPlanningGenerationResult> {
    return this.generateCandidate(input);
  }

  async deferCandidatePersistence(
    generation: WorkoutPlanningGenerationResult,
  ): Promise<void> {
    // A failed publish is also recoverable from the persisted durable context.
    await this.aiService
      .enqueueWorkoutCompletion(generation.aiJobId)
      .catch(() => undefined);
  }

  async failCandidate(
    generation: WorkoutPlanningGenerationResult,
    error: unknown,
  ): Promise<void> {
    if (generation.completion)
      await this.aiService.failJob(
        generation.aiJobId,
        error,
        generation.completion.response,
        undefined,
        generation.storedResult,
      );
  }

  async generateCandidate(
    input: GenerateWorkoutPlanV2Input,
    preflightPrepared?: PreparedWorkoutPlanningV2,
    continuation?: {
      readonly applicationInput: WorkoutApplicationExecutionInputV2;
      readonly pollWindowMs?: number;
    },
  ): Promise<WorkoutPlanningGenerationResult> {
    if (
      preflightPrepared &&
      this.preparedInputs.get(input) !== preflightPrepared
    )
      throw new BadRequestException(
        'Prepared workout context does not belong to input',
      );
    let prepared = preflightPrepared ?? this.prepare(input);
    let effectiveInput = input;
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
    let payload = Object.freeze({
      schemaVersion: 2 as const,
      currentRequest: this.frozenCopy(input.currentRequest ?? { text: '' }),
      context: prepared.context,
      strategy: prepared.strategy,
      safetyPolicy: Object.freeze({
        noDiagnosis: true,
        noRehabilitation: true,
        noExactLoad: !prepared.strategy.intensityPolicy.exactLoadAllowed,
        noExactPace: !prepared.strategy.intensityPolicy.exactPaceAllowed,
        noExactPower: !prepared.strategy.intensityPolicy.exactPowerAllowed,
      }),
    });
    let canonical = this.canonicalJson(payload);
    const identity = input.currentRequest?.requestId
      ? `request:${input.currentRequest.requestId}`
      : canonical;
    const legacyPrepared =
      !input.currentRequest?.requestId && input.legacyV9RecognizedContext
        ? this.prepare({
            ...input,
            recognizedContext: input.legacyV9RecognizedContext,
          })
        : prepared;
    // Historical operation identities retain the pre-capability envelope. This
    // changes version selection only, never durable state, claims or attempts.
    const historicalPayload = {
      ...payload,
      strategy: {
        ...prepared.strategy,
        intensityPolicy: {
          scale: prepared.strategy.intensityPolicy.scale,
          minimum: prepared.strategy.intensityPolicy.minimum,
          maximum: prepared.strategy.intensityPolicy.maximum,
          qualitativeLevel: prepared.strategy.intensityPolicy.qualitativeLevel,
          exactLoadAllowed: false,
          exactPaceAllowed: false,
          exactPowerAllowed: false,
        },
      },
      safetyPolicy: {
        noDiagnosis: true,
        noRehabilitation: true,
        noExactLoad: true,
        noExactPace: true,
        noExactPower: true,
      },
    };
    const historicalIdentity = input.currentRequest?.requestId
      ? identity
      : this.canonicalJson(historicalPayload);
    const legacyIdentity = input.currentRequest?.requestId
      ? identity
      : this.canonicalJson({
          ...historicalPayload,
          context: legacyPrepared.context,
          strategy: legacyPrepared.strategy
            ? {
                ...legacyPrepared.strategy,
                intensityPolicy: {
                  scale: legacyPrepared.strategy.intensityPolicy.scale,
                  minimum: legacyPrepared.strategy.intensityPolicy.minimum,
                  maximum: legacyPrepared.strategy.intensityPolicy.maximum,
                  qualitativeLevel:
                    legacyPrepared.strategy.intensityPolicy.qualitativeLevel,
                  exactLoadAllowed: false,
                  exactPaceAllowed: false,
                  exactPowerAllowed: false,
                },
              }
            : null,
        });
    const legacyKey = `workout-planning-v2:${createHash('sha256').update(`${input.userId}:9:ai-first-v9-bounded-repair-v1:${legacyIdentity}`).digest('hex')}`;
    const v11Key = `workout-planning-v2:${createHash('sha256').update(`${input.userId}:11:${WORKOUT_PLANNING_V2_EXECUTION_REVISION}:${historicalIdentity}`).digest('hex')}`;
    const v11 =
      typeof this.aiService.findWorkoutOperation === 'function'
        ? await this.aiService.findWorkoutOperation(input.userId, v11Key)
        : null;
    const v10Key = `workout-planning-v2:${createHash('sha256').update(`${input.userId}:10:${WORKOUT_PLANNING_V2_EXECUTION_REVISION}:${historicalIdentity}`).digest('hex')}`;
    const v10 =
      !v11 && typeof this.aiService.findWorkoutOperation === 'function'
        ? await this.aiService.findWorkoutOperation(input.userId, v10Key)
        : null;
    const legacy =
      !v11 && !v10 && typeof this.aiService.findWorkoutOperation === 'function'
        ? await this.aiService.findWorkoutOperation(input.userId, legacyKey)
        : null;
    const definition = v11
      ? WORKOUT_PLANNING_V2_PROMPT_V11
      : v10
        ? WORKOUT_PLANNING_V2_PROMPT_V10
        : legacy
          ? WORKOUT_PLANNING_V2_PROMPT_V9
          : WORKOUT_PLANNING_V2_PROMPT;
    if (legacy) {
      prepared = legacyPrepared;
      if (!prepared.context || !prepared.strategy || !prepared.safety)
        throw new ServiceUnavailableException(
          'Legacy workout context unavailable',
        );
      effectiveInput = {
        ...input,
        recognizedContext:
          input.legacyV9RecognizedContext ?? input.recognizedContext,
      };
      payload = {
        ...payload,
        context: prepared.context,
        strategy: prepared.strategy,
      };
      canonical = this.canonicalJson(payload);
    }
    const operationKey = v11
      ? v11Key
      : v10
        ? v10Key
        : legacy
          ? legacyKey
          : `workout-planning-v2:${createHash('sha256').update(`${input.userId}:${definition.version}:${WORKOUT_PLANNING_V2_EXECUTION_REVISION}:${identity}`).digest('hex')}`;
    const job =
      v11 ??
      v10 ??
      legacy ??
      (await this.aiService.createStandaloneJob({
        userId: input.userId,
        type: AIJobType.WORKOUT,
        promptName: definition.name,
        operationKey,
        ...(prepared.context?.artifactType === 'WEEKLY_PLAN'
          ? { usageEntitlementCode: WORKOUT_PLAN_GENERATION }
          : {}),
      }));
    if (
      job.promptVersion?.version !== definition.version ||
      job.promptVersion?.name !== definition.name
    ) {
      const error = new ServiceUnavailableException(
        'WORKOUT_PROMPT_VERSION_MISMATCH',
      );
      await this.aiService.failJob(job.id, error);
      throw error;
    }
    const durable = durableTextOperation(job.result);
    if (durable) {
      const frozen = JSON.parse(durable.executionContext) as {
        prepared: PreparedWorkoutPlanningV2;
        recognizedContext: GenerateWorkoutPlanV2Input['recognizedContext'];
        previousPlan: WorkoutPlanV2 | null;
      };
      if (
        !frozen.prepared?.context ||
        !frozen.prepared.strategy ||
        !frozen.prepared.safety
      )
        throw new ServiceUnavailableException(
          'Frozen workout execution context unavailable',
        );
      prepared = this.frozenCopy(frozen.prepared);
      effectiveInput = {
        ...input,
        recognizedContext: frozen.recognizedContext,
        previousPlan: frozen.previousPlan ?? undefined,
      };
      canonical = durable.requestInput;
      payload = JSON.parse(canonical) as typeof payload;
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
        effectiveInput,
        definition.version >= 10,
        definition.version >= 12,
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
    if (
      job.status === AIJobStatus.PROCESSING &&
      (!durable || (job.leaseExpiresAt && job.leaseExpiresAt > new Date()))
    )
      throw durable
        ? new DurableTextPendingError()
        : new ServiceUnavailableException(
            'Operação idempotente do treino V2 em andamento',
          );
    let response: Awaited<ReturnType<AIService['runTextJob']>> | undefined;
    const resolvedStrategy = prepared.strategy;
    if (!resolvedStrategy)
      throw new ServiceUnavailableException('Workout strategy unavailable');
    let initialOutput: WorkoutPlanV2 | undefined;
    let initialValidation: WorkoutPlanValidationResult | undefined;
    let repairAttempted = Boolean(
      durable?.initialValidated && durable.repairInput !== null,
    );
    let attemptedProviderCalls = 0;
    const metadata = (model: string): WorkoutPlanV2['generationMetadata'] => ({
      engineVersion: 2,
      promptVersionId: job.promptVersionId,
      aiJobId: job.id,
      operationKey,
      model,
      generatedAt: input.referenceDate.toISOString(),
      reused: false,
    });
    try {
      response = await this.aiService.runTextJob(job.id, {
        pollWindowMs: continuation?.pollWindowMs,
        input: canonical,
        initialValidationIssues: () => initialValidation?.issues ?? [],
        executionContext: JSON.stringify({
          prepared,
          recognizedContext: effectiveInput.recognizedContext,
          previousPlan: effectiveInput.previousPlan ?? null,
          applicationInput: continuation?.applicationInput,
        }),
        jsonSchema: workoutSchemaForAuthorizedEquipment(
          resolvedStrategy.authorizedEquipment,
          definition,
        ),
        repairInput: (initial) => {
          const originalCandidate = this.parser.parse(initial.outputText);
          try {
            initialOutput = this.finalize(
              originalCandidate,
              prepared,
              metadata(initial.model),
              effectiveInput,
              definition.version >= 10,
              definition.version >= 12,
            );
            initialValidation = initialOutput.validation;
            return null;
          } catch (error: unknown) {
            if (!(error instanceof WorkoutPostGenerationValidationError))
              throw error;
            initialValidation = error.validation;
            const errors = error.validation.issues.filter(
              (issue) => issue.severity === 'ERROR',
            );
            const repairable: ReadonlySet<string> = new Set([
              'ENDURANCE_MODE_CONFLICT',
              'TIMED_DURATION_IMPOSSIBLE',
              'EMPTY_BLOCK',
              'DUPLICATE_KEY',
              'ACTIVITY_NAME_INVALID',
              'SUBSTITUTION_REFERENCE_INVALID',
              'WEEKDAY_REQUIRED',
              'WEEKDAY_UNAVAILABLE',
              'DUPLICATE_WEEKDAY',
              'UNAUTHORIZED_EQUIPMENT_REFERENCE',
              'UNAUTHORIZED_EXACT_LOAD',
              'UNAUTHORIZED_EXACT_PACE',
              'UNAUTHORIZED_EXACT_POWER',
              'UNAUTHORIZED_EXACT_HEART_RATE',
              'PUBLIC_IDENTITY_REQUIRED',
              'PUBLIC_IDENTITY_INCOMPLETE',
              'PUBLIC_REPETITIONS_REQUIRED',
              'WORK_STRUCTURE_INVALID',
              'SUBSTITUTION_FUNCTION_MISMATCH',
              'SESSION_DURATION_EXCEEDED',
            ]);
            if (
              !errors.length ||
              !errors.every((issue) => repairable.has(issue.code))
            )
              throw error;
            repairAttempted = true;
            return this.canonicalJson({
              ...payload,
              repair: {
                originalCandidate,
                validationIssues: error.validation.issues,
                immutableFields: [
                  'currentRequest',
                  'context',
                  'strategy',
                  'safetyPolicy',
                  'ownership',
                ],
                instruction:
                  'Correct only the reported issues. Preserve all resolved constraints. Return the complete candidate.',
              },
            });
          }
        },
      });
      const output =
        initialOutput ??
        this.finalize(
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
          effectiveInput,
          definition.version >= 10,
          definition.version >= 12,
        );
      const storedResult: WorkoutPlanningStoredAIJobResult = Object.freeze({
        candidateOutput: response.outputText,
        model: response.model,
        ...(response.durableTextOperation
          ? {
              durableTextOperation: JSON.parse(
                JSON.stringify(response.durableTextOperation),
              ) as Prisma.InputJsonObject,
            }
          : {}),
        executionAudit: {
          providerCalls:
            response.providerCalls ??
            response.providerAttempts?.length ??
            (repairAttempted ? 2 : 1),
          repairAttempted,
          initialValidation: initialValidation
            ? {
                status: initialValidation.status,
                issues: initialValidation.issues.map((issue) => ({ ...issue })),
              }
            : null,
          finalValidation: {
            status: output.validation.status,
            issues: output.validation.issues.map((issue) => ({ ...issue })),
          },
          attempts: (response.providerAttempts ?? [response]).map(
            (attempt) => ({
              responseId: attempt.responseId,
              model: attempt.model,
              promptTokens: attempt.promptTokens,
              completionTokens: attempt.completionTokens,
              totalTokens: attempt.totalTokens,
            }),
          ),
        },
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
    } catch (caught: unknown) {
      let error: unknown = caught;
      if (
        error instanceof DurableTextPendingError &&
        continuation?.applicationInput.generationInput.currentRequest?.requestId
      ) {
        // Recovery also enqueues from the durable ledger after an interrupted publish.
        await this.aiService
          .enqueueWorkoutCompletion(job.id)
          .catch(() => undefined);
      }
      // Losing the atomic claim does not authorize failing another worker's job.
      if (
        error instanceof ConflictException ||
        error instanceof DurableTextPendingError
      )
        throw error;
      if (error instanceof AITextOperationError) {
        response = error.response;
        attemptedProviderCalls = error.providerCalls;
        error = error.operationCause;
      }
      if (response && error instanceof WorkoutPostGenerationValidationError) {
        await this.aiService.failJob(job.id, error, response, undefined, {
          candidateOutput: response.outputText,
          model: response.model,
          rejection: {
            stage: 'POST_GENERATION_VALIDATION',
            issues: error.validation.issues.map((issue) => ({ ...issue })),
          },
          executionAudit: {
            repairAttempted,
            providerCalls:
              response.providerCalls ??
              response.providerAttempts?.length ??
              (repairAttempted ? 2 : 1),
            initialValidation: initialValidation
              ? {
                  status: initialValidation.status,
                  issues: initialValidation.issues.map((issue) => ({
                    ...issue,
                  })),
                }
              : null,
          },
        });
      } else {
        await this.aiService.failJob(job.id, error, response, undefined, {
          executionAudit: {
            providerCalls:
              attemptedProviderCalls || response?.providerCalls || 1,
            repairAttempted,
            finalOutcome: 'FAILED',
            initialValidation: initialValidation
              ? {
                  status: initialValidation.status,
                  issues: initialValidation.issues.map((issue) => ({
                    ...issue,
                  })),
                }
              : null,
          },
        });
      }
      throw error;
    }
  }

  private finalize(
    candidate: GeneratedWorkoutPlanV2Candidate,
    prepared: PreparedWorkoutPlanningV2,
    generationMetadata: WorkoutPlanV2['generationMetadata'],
    input: GenerateWorkoutPlanV2Input,
    requireWeekdays = false,
    requireTypedExecution = false,
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
      requireWeekdays &&
        input.recognizedContext?.mutation?.kind !== 'EXERCISE_SUBSTITUTION',
      requireWeekdays,
      requireTypedExecution,
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
  private frozenCopy<T>(value: T): T {
    const copy = structuredClone(value);
    const freeze = (nested: unknown): void => {
      if (typeof nested !== 'object' || nested === null) return;
      for (const child of Object.values(nested)) freeze(child);
      Object.freeze(nested);
    };
    freeze(copy);
    return copy;
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
