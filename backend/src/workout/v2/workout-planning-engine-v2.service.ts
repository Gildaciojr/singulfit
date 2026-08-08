import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AIJobStatus, AIJobType, Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { AIService } from '../../ai/ai.service';
import { WorkoutArtifactResolverService } from './workout-artifact-resolver.service';
import { freezeWorkoutPlanV2 } from './workout-plan-v2.freeze';
import { WorkoutPlanV2Parser } from './workout-plan-v2.parser';
import { WorkoutPlanV2Validator } from './workout-plan-v2.validator';
import type {
  GeneratedWorkoutPlanV2Candidate,
  WorkoutPlanV2,
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
import { WORKOUT_PLANNING_V2_PROMPT } from './workout-planning-v2.prompt.definition';

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
    const payload = Object.freeze({
      schemaVersion: 2 as const,
      context: prepared.context,
      strategy: prepared.strategy,
      safetyPolicy: Object.freeze({
        noDiagnosis: true,
        noRehabilitation: true,
        noExactLoad: true,
        noExactPace: true,
        noExactPower: true,
      }),
    });
    const canonical = this.canonicalJson(payload);
    const operationKey = `workout-planning-v2:${createHash('sha256').update(`${input.userId}:${WORKOUT_PLANNING_V2_PROMPT.version}:${canonical}`).digest('hex')}`;
    const job = await this.aiService.createStandaloneJob({
      userId: input.userId,
      type: AIJobType.WORKOUT,
      promptName: WORKOUT_PLANNING_V2_PROMPT.name,
      operationKey,
    });
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
        jsonSchema: WORKOUT_PLANNING_V2_PROMPT.schema,
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
      await this.aiService.failJob(job.id, error, response);
      throw error;
    }
  }

  private finalize(
    candidate: GeneratedWorkoutPlanV2Candidate,
    prepared: PreparedWorkoutPlanningV2,
    generationMetadata: WorkoutPlanV2['generationMetadata'],
  ): WorkoutPlanV2 {
    if (!prepared.context || !prepared.strategy || !prepared.readiness)
      throw new BadGatewayException('Contexto de treino V2 ausente');
    const validation = this.validator.validate(
      candidate,
      prepared.context,
      prepared.strategy,
    );
    if (this.safety.evaluateAfterGeneration(validation).outcome === 'BLOCKED')
      throw new BadGatewayException(
        `Treino V2 reprovado: ${validation.issues.map((issue) => issue.code).join(',')}`,
      );
    const reference = prepared.context.previousPlan
      ? `workout-plan-v2:${createHash('sha256').update(this.canonicalJson(prepared.context.previousPlan)).digest('hex')}`
      : null;
    return freezeWorkoutPlanV2({
      schemaVersion: 2,
      artifactType: candidate.artifactType,
      modality: candidate.modality,
      objective: candidate.objective,
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
