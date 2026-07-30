import { ConflictException, Injectable } from '@nestjs/common';
import { NutritionShadowRunStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { parseNutritionShadowConversationGoal } from '../shadow-runtime/nutrition-shadow-conversation-goal';
import type { NutritionShadowRunRecord } from './nutrition-shadow.contract';
import type {
  NutritionShadowRepository,
  StartNutritionShadowRunInput,
} from './nutrition-shadow.repository';

@Injectable()
export class PrismaNutritionShadowGateway implements NutritionShadowRepository {
  constructor(private readonly prisma: PrismaService) {}

  start(input: StartNutritionShadowRunInput) {
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        WITH advisory_lock AS (
          SELECT pg_advisory_xact_lock(
            hashtext(${`nutrition-shadow:${input.operationKey}`})
          )
        )
        SELECT true AS "locked" FROM advisory_lock
      `;
      const existing = await transaction.nutritionShadowRun.findUnique({
        where: { operationKey: input.operationKey },
      });
      if (existing) {
        if (existing.inputFingerprint !== input.inputFingerprint)
          throw new ConflictException(
            'Chave Shadow pertence a uma entrada nutricional incompatível',
          );
        if (existing.status === NutritionShadowRunStatus.SUCCEEDED)
          return { run: this.record(existing), reused: true };
        if (existing.status === NutritionShadowRunStatus.RUNNING)
          throw new ConflictException('Execução Shadow já está em andamento');
        const retried = await transaction.nutritionShadowRun.update({
          where: { id: existing.id },
          data: {
            status: NutritionShadowRunStatus.RUNNING,
            attempts: { increment: 1 },
            startedAt: new Date(),
            completedAt: null,
            errorCategory: null,
            errorCode: null,
            errorMessage: null,
          },
        });
        return { run: this.record(retried), reused: false };
      }
      const created = await transaction.nutritionShadowRun.create({
        data: {
          operationKey: input.operationKey,
          inputFingerprint: input.inputFingerprint,
          correlationId: input.correlationId,
          traceId: input.traceId,
          userId: input.userId,
          conversationGoal: input.conversationGoal,
          conversationId: input.conversationId,
          messageId: input.messageId,
          status: NutritionShadowRunStatus.PENDING,
        },
      });
      const running = await transaction.nutritionShadowRun.update({
        where: { id: created.id },
        data: {
          status: NutritionShadowRunStatus.RUNNING,
          attempts: 1,
          startedAt: new Date(),
        },
      });
      return { run: this.record(running), reused: false };
    });
  }

  async succeed(
    id: string,
    completion: Parameters<NutritionShadowRepository['succeed']>[1],
  ): Promise<NutritionShadowRunRecord> {
    const updated = await this.prisma.nutritionShadowRun.updateMany({
      where: { id, status: NutritionShadowRunStatus.RUNNING },
      data: {
        ...completion,
        estimatedCostUsd: completion.estimatedCostUsd
          ? new Prisma.Decimal(completion.estimatedCostUsd)
          : null,
        document: completion.document as Prisma.InputJsonObject,
        status: NutritionShadowRunStatus.SUCCEEDED,
        completedAt: new Date(),
      },
    });
    if (updated.count !== 1)
      throw new ConflictException(
        'Execução Shadow não está disponível para conclusão',
      );
    return this.record(
      await this.prisma.nutritionShadowRun.findUniqueOrThrow({
        where: { id },
      }),
    );
  }

  async fail(
    id: string,
    input: Parameters<NutritionShadowRepository['fail']>[1],
  ): Promise<NutritionShadowRunRecord> {
    await this.prisma.nutritionShadowRun.updateMany({
      where: { id, status: NutritionShadowRunStatus.RUNNING },
      data: {
        status: NutritionShadowRunStatus.FAILED,
        errorCategory: input.category,
        errorCode: input.code,
        errorMessage: input.message,
        totalDurationMs: input.totalDurationMs,
        builderDurationMs: input.builderDurationMs,
        strategyDurationMs: input.strategyDurationMs,
        completedAt: new Date(),
      },
    });
    return this.record(
      await this.prisma.nutritionShadowRun.findUniqueOrThrow({
        where: { id },
      }),
    );
  }

  private record(
    value: Awaited<
      ReturnType<PrismaService['nutritionShadowRun']['findUniqueOrThrow']>
    >,
  ): NutritionShadowRunRecord {
    return Object.freeze({
      id: value.id,
      operationKey: value.operationKey,
      inputFingerprint: value.inputFingerprint,
      conversationGoal: parseNutritionShadowConversationGoal(
        value.conversationGoal,
      ),
      status: value.status,
      artifactType: value.artifactType,
      kind: value.kind,
      documentHash: value.documentHash,
      totalDurationMs: value.totalDurationMs,
      errorCategory: value.errorCategory,
    });
  }
}
