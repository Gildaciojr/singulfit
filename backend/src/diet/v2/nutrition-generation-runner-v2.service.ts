import {
  BadGatewayException,
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import { AIJobType } from '@prisma/client';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { AIUsageService } from '../../ai/ai-usage.service';
import { NutritionArtifactResolverService } from './nutrition-artifact-resolver.service';
import {
  freezeNutritionConversationalArtifact,
  isNutritionConversationalArtifactType,
  type NutritionConversationalArtifactV1,
} from './nutrition-conversational-artifact.contract';
import { NutritionConversationalArtifactParser } from './nutrition-conversational-artifact.parser';
import { conversationalPrompt } from './nutrition-conversational-artifact.prompt.definition';
import { NutritionConversationalArtifactValidator } from './nutrition-conversational-artifact.validator';
import {
  NutritionGenerationExecutionMode,
  NutritionGenerationRunError,
  type NutritionGenerationDescriptorV2,
  type NutritionGenerationRunResultV2,
  type RunNutritionGenerationV2Input,
} from './nutrition-generation-runner-v2.contract';
import { freezeNutritionPlanV2 } from './nutrition-plan-v2.freeze';
import { NutritionPlanV2Parser } from './nutrition-plan-v2.parser';
import type {
  GeneratedNutritionPlanCandidate,
  NutritionPlanLifecycleReason,
  NutritionPlanV2,
} from './nutrition-plan-v2.contract';
import { NutritionPlanV2Validator } from './nutrition-plan-v2.validator';
import type {
  GenerateNutritionPlanV2Input,
  NutritionGenerationOutputV2,
  PreparedNutritionPlanningV2,
} from './nutrition-planning-generation.contract';
import { NutritionPlanningContextBuilder } from './nutrition-planning-context.builder';
import { NutritionPlanningReadinessService } from './nutrition-planning-readiness.service';
import { NutritionPlanningSafetyService } from './nutrition-planning-safety.service';
import { NutritionPlanningStrategyService } from './nutrition-planning-strategy.service';
import { NUTRITION_PLANNING_V2_PROMPT } from './nutrition-planning-v2.prompt.definition';

@Injectable()
export class NutritionGenerationRunnerV2Service {
  private readonly parser = new NutritionPlanV2Parser();
  private readonly conversationalParser =
    new NutritionConversationalArtifactParser();

  constructor(
    private readonly artifactResolver: NutritionArtifactResolverService,
    private readonly readinessService: NutritionPlanningReadinessService,
    private readonly contextBuilder: NutritionPlanningContextBuilder,
    private readonly strategyService: NutritionPlanningStrategyService,
    private readonly safetyService: NutritionPlanningSafetyService,
    private readonly validator: NutritionPlanV2Validator,
    private readonly conversationalValidator: NutritionConversationalArtifactValidator,
    private readonly usage: AIUsageService,
  ) {}

  prepare(input: GenerateNutritionPlanV2Input): PreparedNutritionPlanningV2 {
    const resolution = this.artifactResolver.resolve({
      decision: input.decision,
      explicitArtifactType: input.explicitArtifactType,
    });
    if (!resolution.artifactType)
      return Object.freeze({
        resolution,
        readiness: null,
        context: null,
        strategy: null,
        safety: null,
      });
    const readiness = this.readinessService.evaluate(
      input.snapshot,
      resolution.artifactType,
      input.previousPlan !== undefined || input.reviewedPlan !== undefined,
    );
    const context = this.contextBuilder.build({
      snapshot: input.snapshot,
      artifactType: resolution.artifactType,
      referenceDate: input.referenceDate,
      nutritionEvidence: input.nutritionEvidence,
      previousPlan: input.reviewedPlan?.plan ?? input.previousPlan,
      requestedChangeReason: input.requestedChangeReason,
    });
    const strategy = this.strategyService.build(context);
    const safety = this.safetyService.evaluateBeforeGeneration(
      input.snapshot,
      readiness,
    );
    return Object.freeze({ resolution, readiness, context, strategy, safety });
  }

  describe(
    input: GenerateNutritionPlanV2Input,
    prepared: PreparedNutritionPlanningV2,
  ): NutritionGenerationDescriptorV2 {
    this.assertGeneratable(input, prepared);
    const artifactType = prepared.resolution.artifactType;
    if (!artifactType || artifactType === 'CURRENT_PLAN_PRESENTATION')
      throw new BadRequestException('Tipo de artifact nutricional ausente');
    const prompt = isNutritionConversationalArtifactType(artifactType)
      ? conversationalPrompt(artifactType)
      : NUTRITION_PLANNING_V2_PROMPT;
    const payload = Object.freeze({
      schemaVersion: 2 as const,
      context: prepared.context,
      strategy: prepared.strategy,
      ...(artifactType === 'PLAN_REVIEW'
        ? { reviewedPlan: input.reviewedPlan }
        : {}),
      safetyPolicy: Object.freeze({
        noDiagnosis: true,
        noMedication: true,
        noClinicalTreatment: true,
        preserveConstraints: true,
      }),
    });
    const canonicalPayload = this.canonicalJson(payload);
    return Object.freeze({
      artifactType,
      promptName: prompt.name,
      promptVersion: prompt.version,
      schema: prompt.schema,
      canonicalPayload,
      operationKey: this.operationKey(
        input.userId,
        prompt.name,
        prompt.version,
        canonicalPayload,
      ),
    });
  }

  async run(
    request: RunNutritionGenerationV2Input,
  ): Promise<NutritionGenerationRunResultV2> {
    const started = performance.now();
    const providerStarted = performance.now();
    let response;
    try {
      response = await request.executeProvider();
    } catch (error: unknown) {
      if (request.mode === NutritionGenerationExecutionMode.SHADOW)
        throw new NutritionGenerationRunError('PROVIDER', error);
      throw error;
    }
    const providerMs = performance.now() - providerStarted;
    const materialized = this.materialize(
      response.outputText,
      request.descriptor.artifactType,
      request.prepared,
      request.input,
      {
        engineVersion: 2,
        promptVersionId: request.promptVersionId,
        aiJobId: request.requestId,
        operationKey: request.descriptor.operationKey,
        model: response.model,
        generatedAt: request.input.referenceDate.toISOString(),
        reused: request.reused,
      },
      request.mode,
    );
    const estimatedCost = this.usage.estimateCost(
      AIJobType.DIET,
      response.promptTokens,
      response.completionTokens,
    );
    return Object.freeze({
      output: materialized.output,
      response: Object.freeze({ ...response }),
      providerMetadata: Object.freeze({
        provider: 'OPENAI' as const,
        model: response.model,
        responseId: response.responseId,
        promptVersionId: request.promptVersionId,
      }),
      usage: Object.freeze({
        promptTokens: response.promptTokens,
        completionTokens: response.completionTokens,
        totalTokens: response.totalTokens,
      }),
      accounting: Object.freeze({
        estimatedCostUsd: estimatedCost.toFixed(8),
        currency: 'USD' as const,
      }),
      attempts: 1,
      timings: Object.freeze({
        providerMs,
        parsingMs: materialized.parsingMs,
        validationMs: materialized.validationMs,
        generationMs: performance.now() - started,
      }),
    });
  }

  materializeStored(
    outputText: string,
    input: GenerateNutritionPlanV2Input,
    prepared: PreparedNutritionPlanningV2,
    descriptor: NutritionGenerationDescriptorV2,
    generation: NutritionPlanV2['generation'],
  ): Exclude<
    NutritionGenerationOutputV2,
    { readonly kind: 'CURRENT_PLAN_PRESENTATION' }
  > {
    return this.materialize(
      outputText,
      descriptor.artifactType,
      prepared,
      input,
      generation,
      NutritionGenerationExecutionMode.PRODUCTION,
    ).output;
  }

  private materialize(
    outputText: string,
    artifactType: NutritionGenerationDescriptorV2['artifactType'],
    prepared: PreparedNutritionPlanningV2,
    input: GenerateNutritionPlanV2Input,
    generation: NutritionPlanV2['generation'],
    mode: NutritionGenerationExecutionMode,
  ): {
    readonly output: Exclude<
      NutritionGenerationOutputV2,
      { readonly kind: 'CURRENT_PLAN_PRESENTATION' }
    >;
    readonly parsingMs: number;
    readonly validationMs: number;
  } {
    const parseStarted = performance.now();
    if (isNutritionConversationalArtifactType(artifactType)) {
      let candidate;
      try {
        candidate = this.conversationalParser.parse(outputText, artifactType);
      } catch (error: unknown) {
        if (mode === NutritionGenerationExecutionMode.SHADOW)
          throw new NutritionGenerationRunError('PARSER', error);
        throw error;
      }
      const parsingMs = performance.now() - parseStarted;
      const common = {
        schemaVersion: '1.0' as const,
        title: candidate.title,
        summary: candidate.summary,
        generatedAt: generation.generatedAt,
      };
      let artifact: NutritionConversationalArtifactV1;
      if (candidate.artifactType === 'POINT_GUIDANCE')
        artifact = { ...common, ...candidate };
      else if (candidate.artifactType === 'MEAL_SUGGESTION')
        artifact = { ...common, ...candidate };
      else {
        if (!input.reviewedPlan)
          throw new BadRequestException(
            'Plano persistente obrigatório para revisão nutricional',
          );
        artifact = {
          ...common,
          ...candidate,
          reviewedPlanId: input.reviewedPlan.id,
        };
      }
      const frozen = freezeNutritionConversationalArtifact(artifact);
      const validationStarted = performance.now();
      try {
        this.conversationalValidator.validate(frozen);
      } catch (error: unknown) {
        if (mode === NutritionGenerationExecutionMode.SHADOW)
          throw new NutritionGenerationRunError('VALIDATION', error);
        throw error;
      }
      return {
        output: Object.freeze({
          kind: 'CONVERSATIONAL_ARTIFACT' as const,
          artifactType,
          artifact: frozen,
        }),
        parsingMs,
        validationMs: performance.now() - validationStarted,
      };
    }
    let candidate;
    try {
      candidate = this.parser.parse(outputText);
    } catch (error: unknown) {
      if (mode === NutritionGenerationExecutionMode.SHADOW)
        throw new NutritionGenerationRunError('PARSER', error);
      throw error;
    }
    const parsingMs = performance.now() - parseStarted;
    const validationStarted = performance.now();
    let plan;
    try {
      plan = this.finalize(candidate, prepared, generation);
    } catch (error: unknown) {
      if (mode === NutritionGenerationExecutionMode.SHADOW)
        throw new NutritionGenerationRunError('VALIDATION', error);
      throw error;
    }
    return {
      output: Object.freeze({
        kind: 'PLAN' as const,
        artifactType: this.operationalType(artifactType),
        plan,
      }),
      parsingMs,
      validationMs: performance.now() - validationStarted,
    };
  }

  private finalize(
    candidate: GeneratedNutritionPlanCandidate,
    prepared: PreparedNutritionPlanningV2,
    generation: NutritionPlanV2['generation'],
  ): NutritionPlanV2 {
    if (!prepared.context || !prepared.strategy)
      throw new BadGatewayException('Contexto nutricional V2 ausente');
    const validation = this.validator.validate(
      candidate,
      prepared.context,
      prepared.strategy,
    );
    const postSafety = this.safetyService.evaluateAfterGeneration(validation);
    if (postSafety.outcome === 'BLOCKED')
      throw new BadGatewayException(
        `Plano nutricional V2 reprovado: ${validation.issues
          .map((issue) => issue.code)
          .join(',')}`,
      );
    return freezeNutritionPlanV2({
      schemaVersion: 2,
      artifactType: candidate.artifactType,
      lifecycleReason: this.lifecycleReason(candidate.artifactType),
      replacesPlanReference: prepared.context.previousPlan
        ? this.previousPlanReference(prepared.context.previousPlan)
        : null,
      title: candidate.title,
      objectiveSummary: candidate.objectiveSummary,
      strategy: prepared.strategy,
      guidance: candidate.guidance,
      days: candidate.days,
      substitutions: candidate.substitutions,
      adaptationRules: candidate.adaptationRules,
      hydrationGuidance: candidate.hydrationGuidance,
      safetyNotes: candidate.safetyNotes,
      generation,
      validation,
    });
  }

  private assertGeneratable(
    input: GenerateNutritionPlanV2Input,
    prepared: PreparedNutritionPlanningV2,
  ): void {
    if (
      !prepared.context ||
      !prepared.strategy ||
      !prepared.readiness ||
      !prepared.safety
    )
      throw new BadRequestException(
        `Artefato nutricional não resolvido: ${prepared.resolution.reason}`,
      );
    if (
      prepared.safety.outcome !== 'ALLOWED' &&
      prepared.safety.outcome !== 'LIMITED_GUIDANCE'
    )
      throw new BadRequestException(
        `Geração nutricional bloqueada: ${prepared.safety.outcome}`,
      );
    if (
      prepared.resolution.artifactType === 'PLAN_REVIEW' &&
      !input.reviewedPlan
    )
      throw new BadRequestException(
        'Plano persistente obrigatório para revisão nutricional',
      );
  }

  private operationalType(
    artifactType: NutritionGenerationDescriptorV2['artifactType'],
  ):
    | 'DAILY_STRUCTURE'
    | 'WEEKLY_PLAN'
    | 'PLAN_ADAPTATION'
    | 'FOOD_SUBSTITUTION' {
    if (
      artifactType === 'DAILY_STRUCTURE' ||
      artifactType === 'WEEKLY_PLAN' ||
      artifactType === 'PLAN_ADAPTATION' ||
      artifactType === 'FOOD_SUBSTITUTION'
    )
      return artifactType;
    throw new BadGatewayException(
      'Tipo de plano nutricional operacional inválido',
    );
  }

  private lifecycleReason(
    artifactType: GeneratedNutritionPlanCandidate['artifactType'],
  ): NutritionPlanLifecycleReason {
    return artifactType === 'PLAN_ADAPTATION' ||
      artifactType === 'FOOD_SUBSTITUTION'
      ? 'ADAPTATION'
      : 'CREATION';
  }

  private operationKey(
    userId: string,
    promptName: string,
    promptVersion: number,
    canonicalPayload: string,
  ): string {
    const digest = createHash('sha256')
      .update(`${userId}:${promptName}:${promptVersion}:${canonicalPayload}`)
      .digest('hex');
    return `nutrition-planning-v2:${digest}`;
  }

  private previousPlanReference(
    previousPlan: NonNullable<
      PreparedNutritionPlanningV2['context']
    >['previousPlan'],
  ): string {
    const digest = createHash('sha256')
      .update(this.canonicalJson(previousPlan))
      .digest('hex');
    return `nutrition-plan-v2:${digest}`;
  }

  canonicalJson(value: unknown): string {
    if (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'boolean'
    )
      return JSON.stringify(value);
    if (typeof value === 'number') {
      if (!Number.isFinite(value))
        throw new BadRequestException(
          'Número não finito no contexto nutricional',
        );
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
      'Valor não serializável no contexto nutricional',
    );
  }

  private isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
