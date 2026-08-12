import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { AIJobStatus, AIJobType, Prisma } from '@prisma/client';
import { AIService } from '../../ai/ai.service';
import { NutritionGenerationExecutionMode } from './nutrition-generation-runner-v2.contract';
import { NutritionGenerationRunnerV2Service } from './nutrition-generation-runner-v2.service';
import type {
  GenerateNutritionPlanV2Input,
  NutritionPlanningGenerationResult,
  NutritionPlanningStoredAIJobResult,
  PreparedNutritionPlanningV2,
} from './nutrition-planning-generation.contract';

@Injectable()
export class NutritionPlanningEngineV2Service {
  constructor(
    private readonly runner: NutritionGenerationRunnerV2Service,
    private readonly aiService: AIService,
  ) {}

  prepare(input: GenerateNutritionPlanV2Input): PreparedNutritionPlanningV2 {
    return this.runner.prepare(input);
  }

  async generate(
    input: GenerateNutritionPlanV2Input,
  ): Promise<NutritionPlanningGenerationResult> {
    return this.generateCandidate(input);
  }

  async generateCandidate(
    input: GenerateNutritionPlanV2Input,
    identity?: {
      readonly operationKeyOverride?: string;
      readonly recoverExpiredOperation?: boolean;
    },
  ): Promise<NutritionPlanningGenerationResult> {
    const prepared = this.runner.prepare(input);
    if (prepared.resolution.artifactType === 'CURRENT_PLAN_PRESENTATION')
      return Object.freeze({
        status: 'NO_GENERATION' as const,
        output: Object.freeze({
          kind: 'CURRENT_PLAN_PRESENTATION' as const,
          artifactType: 'CURRENT_PLAN_PRESENTATION' as const,
        }),
      });

    const descriptor = this.runner.describe(
      input,
      prepared,
      identity?.operationKeyOverride,
    );
    const job = await this.aiService.createStandaloneJob({
      userId: input.userId,
      type: AIJobType.DIET,
      promptName: descriptor.promptName,
      operationKey: descriptor.operationKey,
      recoverExpiredOperation: identity?.recoverExpiredOperation,
    });

    if (job.status === AIJobStatus.COMPLETED) {
      const storedResult = this.completedStoredResult(job.result);
      if (!storedResult)
        throw new ServiceUnavailableException(
          'Resultado idempotente do plano nutricional V2 indisponível',
        );
      const output = this.runner.materializeStored(
        storedResult.candidateOutput,
        input,
        prepared,
        descriptor,
        {
          engineVersion: 2,
          promptVersionId: job.promptVersionId,
          aiJobId: job.id,
          operationKey: descriptor.operationKey,
          model: storedResult.model,
          generatedAt: input.referenceDate.toISOString(),
          reused: true,
        },
      );
      return Object.freeze({
        status: 'ALREADY_COMPLETED' as const,
        output,
        aiJobId: job.id,
        operationKey: descriptor.operationKey,
        storedResult,
        reused: true as const,
        completion: null,
      });
    }
    if (job.status === AIJobStatus.FAILED)
      throw new ServiceUnavailableException(
        'Operação idempotente do plano nutricional V2 já falhou',
      );
    if (job.status === AIJobStatus.PROCESSING)
      throw new ServiceUnavailableException(
        'Operação idempotente do plano nutricional V2 em andamento',
      );

    let response: Awaited<ReturnType<AIService['runTextJob']>> | undefined;
    try {
      const run = await this.runner.run({
        mode: NutritionGenerationExecutionMode.PRODUCTION,
        input,
        prepared,
        descriptor,
        promptVersionId: job.promptVersionId,
        requestId: job.id,
        reused: false,
        executeProvider: async () => {
          response = await this.aiService.runTextJob(job.id, {
            input: descriptor.canonicalPayload,
            jsonSchema: descriptor.schema,
          });
          return response;
        },
      });
      const storedResult: NutritionPlanningStoredAIJobResult = Object.freeze({
        candidateOutput: run.response.outputText,
        model: run.response.model,
      });
      return Object.freeze({
        status: 'PENDING_COMPLETION' as const,
        output: run.output,
        aiJobId: job.id,
        operationKey: descriptor.operationKey,
        storedResult,
        reused: false as const,
        completion: Object.freeze({
          userId: input.userId,
          aiJobId: job.id,
          jobType: AIJobType.DIET,
          response: run.response,
          result: storedResult,
        }),
      });
    } catch (error: unknown) {
      await this.aiService.failJob(job.id, error, response);
      throw error;
    }
  }

  private completedStoredResult(
    value: Prisma.JsonValue | null,
  ): NutritionPlanningStoredAIJobResult | null {
    if (!this.isRecord(value)) return null;
    if (
      typeof value.candidateOutput !== 'string' ||
      !value.candidateOutput.trim() ||
      typeof value.model !== 'string' ||
      !value.model.trim()
    )
      return null;
    return Object.freeze({
      candidateOutput: value.candidateOutput,
      model: value.model,
    });
  }

  private isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
