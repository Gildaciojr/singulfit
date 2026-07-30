import { Injectable } from '@nestjs/common';
import { NutritionShadowRunStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import type { NutritionShadowComparisonSnapshot } from '../shadow-comparison/nutrition-shadow-comparison.contract';
import type { NutritionShadowRuntimeResultReader } from './nutrition-shadow-runtime-result.reader';
import { parseNutritionShadowConversationGoal } from './nutrition-shadow-conversation-goal';

@Injectable()
export class PrismaNutritionShadowRuntimeResultReader implements NutritionShadowRuntimeResultReader {
  constructor(private readonly prisma: PrismaService) {}

  async findSucceeded(
    shadowRunId: string,
  ): Promise<NutritionShadowComparisonSnapshot | null> {
    const run = await this.prisma.nutritionShadowRun.findFirst({
      where: {
        id: shadowRunId,
        status: NutritionShadowRunStatus.SUCCEEDED,
      },
      select: {
        id: true,
        conversationGoal: true,
        artifactType: true,
        kind: true,
        document: true,
        documentHash: true,
        totalDurationMs: true,
        provider: true,
        model: true,
        totalTokens: true,
        estimatedCostUsd: true,
        attempts: true,
      },
    });

    if (!run) return null;
    if (
      !run.artifactType ||
      !run.kind ||
      !run.documentHash ||
      run.totalDurationMs === null ||
      run.totalTokens === null
    )
      throw new Error('NutritionShadowRun concluído está incompleto');

    return Object.freeze({
      shadowRunId: run.id,
      conversationGoal: parseNutritionShadowConversationGoal(
        run.conversationGoal,
      ),
      artifactType: run.artifactType,
      kind: run.kind,
      document: this.document(run.document),
      documentHash: run.documentHash,
      durationMs: run.totalDurationMs,
      provider: run.provider,
      model: run.model,
      totalTokens: run.totalTokens,
      estimatedCostUsd: run.estimatedCostUsd?.toFixed(8) ?? null,
      attempts: run.attempts,
      parserSucceeded: true,
      validationSucceeded: true,
    });
  }

  private document(value: unknown): object {
    if (typeof value !== 'object' || value === null || Array.isArray(value))
      throw new Error('Documento Shadow concluído está inválido');
    return value;
  }
}
