import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  NutritionShadowErrorCategory,
  NutritionShadowOutputKind,
} from '@prisma/client';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { OpenAIGateway } from '../../../ai/openai.gateway';
import { PromptService } from '../../../ai/prompt.service';
import { GenerateNutritionPlanV2InputBuilder } from '../generate-nutrition-plan-v2-input.builder';
import {
  NutritionGenerationExecutionMode,
  NutritionGenerationRunError,
} from '../nutrition-generation-runner-v2.contract';
import { NutritionGenerationRunnerV2Service } from '../nutrition-generation-runner-v2.service';
import type { NutritionGenerationOutputV2 } from '../nutrition-planning-generation.contract';
import type {
  NutritionShadowCompletion,
  NutritionShadowExecutionInput,
  NutritionShadowExecutionResult,
} from './nutrition-shadow.contract';
import {
  NUTRITION_SHADOW_ACTIVE_PLAN_PORT,
  type NutritionShadowActivePlanPort,
} from './nutrition-shadow-active-plan.port';
import {
  NUTRITION_SHADOW_REPOSITORY,
  type NutritionShadowRepository,
} from './nutrition-shadow.repository';

class NutritionShadowPersistenceError extends Error {
  constructor(readonly original: unknown) {
    super(
      original instanceof Error
        ? original.message
        : 'Falha na persistência Nutrition Shadow',
    );
    this.name = 'NutritionShadowPersistenceError';
  }
}

@Injectable()
export class NutritionShadowRunnerService {
  private readonly logger = new Logger(NutritionShadowRunnerService.name);

  constructor(
    private readonly builder: GenerateNutritionPlanV2InputBuilder,
    private readonly generation: NutritionGenerationRunnerV2Service,
    private readonly promptService: PromptService,
    private readonly textExecution: OpenAIGateway,
    @Inject(NUTRITION_SHADOW_REPOSITORY)
    private readonly repository: NutritionShadowRepository,
    @Inject(NUTRITION_SHADOW_ACTIVE_PLAN_PORT)
    private readonly activePlan: NutritionShadowActivePlanPort,
  ) {}

  async executeSafely(
    input: NutritionShadowExecutionInput,
  ): Promise<NutritionShadowExecutionResult> {
    try {
      return await this.execute(input);
    } catch (error: unknown) {
      const operationKey = this.shadowIdentity(input).operationKey;
      this.logger.warn(
        `Execução Nutrition Shadow isolada: ${this.safeMessage(error)}`,
      );
      return Object.freeze({
        status: 'SKIPPED' as const,
        reason: 'SHADOW_STORAGE_UNAVAILABLE' as const,
        operationKey,
      });
    }
  }

  async execute(
    input: NutritionShadowExecutionInput,
  ): Promise<NutritionShadowExecutionResult> {
    const totalStarted = performance.now();
    const identity = this.shadowIdentity(input);
    const started = await this.repository.start({
      operationKey: identity.operationKey,
      inputFingerprint: identity.fingerprint,
      correlationId: this.identifier(input.correlationId, 'correlationId'),
      traceId: input.traceId,
      userId: input.source.userId,
      conversationGoal: input.source.decision.goal,
      conversationId: input.conversationId,
      messageId: input.messageId,
    });
    if (started.reused) return this.reusedResult(started.run);

    let phase: 'BUILDER' | 'STRATEGY' | 'PROVIDER' | 'ACTIVE_PLAN' = 'BUILDER';
    let builderDurationMs = 0;
    let strategyDurationMs = 0;
    try {
      const builderStarted = performance.now();
      const generationInput = this.builder.build(input.source);
      builderDurationMs = performance.now() - builderStarted;

      phase = 'STRATEGY';
      const strategyStarted = performance.now();
      const prepared = this.generation.prepare(generationInput);
      strategyDurationMs = performance.now() - strategyStarted;
      if (prepared.resolution.artifactType === 'CURRENT_PLAN_PRESENTATION') {
        phase = 'ACTIVE_PLAN';
        return await this.presentation(
          started.run.id,
          generationInput.userId,
          builderDurationMs,
          strategyDurationMs,
          totalStarted,
        );
      }

      const descriptor = this.generation.describe(generationInput, prepared);
      const prompt = await this.promptService.getActive(descriptor.promptName);
      phase = 'PROVIDER';
      const run = await this.generation.run({
        mode: NutritionGenerationExecutionMode.SHADOW,
        input: generationInput,
        prepared,
        descriptor,
        promptVersionId: prompt.id,
        requestId: `shadow-run:${started.run.id}`,
        reused: false,
        executeProvider: () =>
          this.textExecution.createTextResponse({
            instructions: prompt.prompt,
            input: descriptor.canonicalPayload,
            requestId: started.run.id,
            jsonSchema: descriptor.schema,
          }),
      });
      const document = this.document(run.output);
      const canonical = this.generation.canonicalJson(document);
      const completion: NutritionShadowCompletion = {
        artifactType: run.output.artifactType,
        kind: this.kind(run.output),
        provider: run.providerMetadata.provider,
        model: run.providerMetadata.model,
        promptVersionId: run.providerMetadata.promptVersionId,
        promptTokens: run.usage.promptTokens,
        completionTokens: run.usage.completionTokens,
        totalTokens: run.usage.totalTokens,
        estimatedCostUsd: run.accounting.estimatedCostUsd,
        costCurrency: run.accounting.currency,
        builderDurationMs: this.ms(builderDurationMs),
        strategyDurationMs: this.ms(strategyDurationMs),
        providerDurationMs: this.ms(run.timings.providerMs),
        parsingDurationMs: this.ms(run.timings.parsingMs),
        validationDurationMs: this.ms(run.timings.validationMs),
        persistenceDurationMs: null,
        totalDurationMs: this.ms(performance.now() - totalStarted),
        document,
        documentHash: this.hash(canonical),
        resultSummary: this.summary(run.output),
        activePlanReference: null,
      };
      const persisted = await this.persistSuccess(started.run.id, completion);
      return Object.freeze({
        status: 'SUCCEEDED' as const,
        shadowRunId: persisted.id,
        artifactType: completion.artifactType,
        kind: completion.kind,
        documentHash: completion.documentHash,
        durationMs: completion.totalDurationMs,
        reused: false,
      });
    } catch (error: unknown) {
      const category = this.category(error, phase);
      const duration = this.ms(performance.now() - totalStarted);
      const failed = await this.repository.fail(started.run.id, {
        category,
        code: error instanceof Error ? error.name.slice(0, 120) : null,
        message: this.safeMessage(error),
        totalDurationMs: duration,
        builderDurationMs: this.ms(builderDurationMs),
        strategyDurationMs: this.ms(strategyDurationMs),
      });
      return Object.freeze({
        status: 'FAILED' as const,
        shadowRunId: failed.id,
        errorCategory: category,
        durationMs: duration,
      });
    }
  }

  private async presentation(
    runId: string,
    userId: string,
    builderDurationMs: number,
    strategyDurationMs: number,
    totalStarted: number,
  ): Promise<NutritionShadowExecutionResult> {
    const plan = await this.activePlan.find(userId);
    const document = Object.freeze({
      kind: 'CURRENT_PLAN_PRESENTATION' as const,
      artifactType: 'CURRENT_PLAN_PRESENTATION' as const,
      activePlanReference: plan?.id ?? null,
      activePlanArtifactType: plan?.artifactType ?? null,
      activePlanGeneratedAt: plan?.generatedAt.toISOString() ?? null,
    });
    const canonical = this.generation.canonicalJson(document);
    const completion: NutritionShadowCompletion = {
      artifactType: 'CURRENT_PLAN_PRESENTATION',
      kind: NutritionShadowOutputKind.CURRENT_PLAN_PRESENTATION,
      provider: null,
      model: null,
      promptVersionId: null,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      estimatedCostUsd: null,
      costCurrency: null,
      builderDurationMs: this.ms(builderDurationMs),
      strategyDurationMs: this.ms(strategyDurationMs),
      providerDurationMs: 0,
      parsingDurationMs: 0,
      validationDurationMs: 0,
      persistenceDurationMs: null,
      totalDurationMs: this.ms(performance.now() - totalStarted),
      document,
      documentHash: this.hash(canonical),
      resultSummary: plan
        ? `Apresentação Shadow do plano ${plan.id}`
        : 'Apresentação Shadow sem plano V2 ativo',
      activePlanReference: plan?.id ?? null,
    };
    const persisted = await this.persistSuccess(runId, completion);
    return Object.freeze({
      status: 'SUCCEEDED' as const,
      shadowRunId: persisted.id,
      artifactType: completion.artifactType,
      kind: completion.kind,
      documentHash: completion.documentHash,
      durationMs: completion.totalDurationMs,
      reused: false,
    });
  }

  private reusedResult(
    run: Awaited<ReturnType<NutritionShadowRepository['start']>>['run'],
  ): NutritionShadowExecutionResult {
    if (!run.artifactType || !run.kind || !run.documentHash)
      throw new Error('Resultado Shadow concluído está inconsistente');
    return Object.freeze({
      status: 'SUCCEEDED' as const,
      shadowRunId: run.id,
      artifactType: run.artifactType,
      kind: run.kind,
      documentHash: run.documentHash,
      durationMs: run.totalDurationMs ?? 0,
      reused: true,
    });
  }

  private document(
    output: Exclude<
      NutritionGenerationOutputV2,
      { kind: 'CURRENT_PLAN_PRESENTATION' }
    >,
  ): object {
    return output.kind === 'PLAN'
      ? Object.freeze({
          kind: output.kind,
          artifactType: output.artifactType,
          plan: output.plan,
        })
      : Object.freeze({
          kind: output.kind,
          artifactType: output.artifactType,
          artifact: output.artifact,
        });
  }

  private kind(
    output: Exclude<
      NutritionGenerationOutputV2,
      { kind: 'CURRENT_PLAN_PRESENTATION' }
    >,
  ): NutritionShadowOutputKind {
    return output.kind === 'PLAN'
      ? NutritionShadowOutputKind.PLAN
      : NutritionShadowOutputKind.CONVERSATIONAL_ARTIFACT;
  }

  private summary(
    output: Exclude<
      NutritionGenerationOutputV2,
      { kind: 'CURRENT_PLAN_PRESENTATION' }
    >,
  ): string {
    return (output.kind === 'PLAN' ? output.plan.title : output.artifact.title)
      .trim()
      .slice(0, 500);
  }

  private category(
    error: unknown,
    phase: 'BUILDER' | 'STRATEGY' | 'PROVIDER' | 'ACTIVE_PLAN',
  ): NutritionShadowErrorCategory {
    if (error instanceof NutritionShadowPersistenceError)
      return NutritionShadowErrorCategory.SHADOW_PERSISTENCE_ERROR;
    if (error instanceof NutritionGenerationRunError) {
      if (error.stage === 'PROVIDER')
        return NutritionShadowErrorCategory.PROVIDER_ERROR;
      if (error.stage === 'PARSER')
        return NutritionShadowErrorCategory.PARSER_ERROR;
      return NutritionShadowErrorCategory.VALIDATION_ERROR;
    }
    if (phase === 'BUILDER') return NutritionShadowErrorCategory.BUILDER_ERROR;
    if (phase === 'STRATEGY')
      return NutritionShadowErrorCategory.STRATEGY_ERROR;
    if (phase === 'ACTIVE_PLAN')
      return NutritionShadowErrorCategory.ACTIVE_PLAN_RESOLUTION_ERROR;
    return NutritionShadowErrorCategory.UNKNOWN_ERROR;
  }

  private shadowIdentity(input: NutritionShadowExecutionInput): {
    readonly operationKey: string;
    readonly fingerprint: string;
  } {
    const canonical = this.canonicalSource(input);
    const fingerprint = this.hash(canonical);
    return {
      operationKey: `nutrition-shadow-v2:${fingerprint}`,
      fingerprint,
    };
  }

  private canonicalSource(input: NutritionShadowExecutionInput): string {
    return this.canonicalValue({
      source: input.source,
      conversationId: input.conversationId ?? null,
      messageId: input.messageId ?? null,
    });
  }

  private canonicalValue(value: unknown): string {
    if (value instanceof Date) return JSON.stringify(value.toISOString());
    if (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'boolean' ||
      typeof value === 'number'
    )
      return JSON.stringify(value);
    if (Array.isArray(value))
      return `[${value.map((item) => this.canonicalValue(item)).join(',')}]`;
    if (typeof value === 'object') {
      const record = value as Readonly<{ [key: string]: unknown }>;
      return `{${Object.keys(record)
        .sort()
        .map(
          (key) => `${JSON.stringify(key)}:${this.canonicalValue(record[key])}`,
        )
        .join(',')}}`;
    }
    throw new Error('Entrada Shadow não serializável');
  }

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private identifier(value: string, label: string): string {
    const normalized = value.trim();
    if (!normalized || normalized.length > 255)
      throw new Error(`${label} Shadow inválido`);
    return normalized;
  }

  private safeMessage(error: unknown): string {
    return (
      error instanceof Error && error.message.trim()
        ? error.message.trim()
        : 'Falha Shadow não identificada'
    ).slice(0, 1_000);
  }

  private ms(value: number): number {
    return Math.max(0, Math.round(value));
  }

  private async persistSuccess(
    runId: string,
    completion: NutritionShadowCompletion,
  ) {
    try {
      return await this.repository.succeed(runId, completion);
    } catch (error: unknown) {
      throw new NutritionShadowPersistenceError(error);
    }
  }
}
