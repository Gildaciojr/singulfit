import { ConflictException, Injectable } from '@nestjs/common';
import {
  NutritionShadowRuntimeDecisionType,
  Prisma,
  type NutritionShadowRuntimeSkipReason,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { requireNutritionShadowConversationGoal } from './nutrition-shadow-conversation-goal';
import type {
  ClaimNutritionShadowRuntimeDecisionInput,
  ClaimNutritionShadowRuntimeDecisionResult,
  NutritionShadowRuntimeDecisionRecord,
  NutritionShadowRuntimeDecisionRepository,
  NutritionShadowRuntimeOwnership,
} from './nutrition-shadow-runtime-decision.repository';

export const NUTRITION_SHADOW_RUNTIME_OWNERSHIP_LEASE_MS = 120_000;

@Injectable()
export class PrismaNutritionShadowRuntimeDecisionGateway implements NutritionShadowRuntimeDecisionRepository {
  constructor(private readonly prisma: PrismaService) {}

  claim(
    input: ClaimNutritionShadowRuntimeDecisionInput,
  ): Promise<ClaimNutritionShadowRuntimeDecisionResult> {
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        WITH advisory_lock AS (
          SELECT pg_advisory_xact_lock(
            hashtext(${`nutrition-shadow-runtime:${input.operationKey}`})
          )
        )
        SELECT true AS "locked" FROM advisory_lock
      `;
      const now = await this.databaseNow(transaction);
      const ownership = this.ownership(input.ownershipToken, now);
      const existing =
        await transaction.nutritionShadowRuntimeDecision.findUnique({
          where: { operationKey: input.operationKey },
        });
      if (existing) {
        if (existing.inputFingerprint !== input.inputFingerprint)
          throw new ConflictException(
            'Chave de decisão Nutrition Shadow pertence a uma entrada incompatível',
          );
        const decision = this.record(existing);
        if (existing.decision !== NutritionShadowRuntimeDecisionType.PENDING)
          return Object.freeze({
            kind: 'TERMINAL_REUSED' as const,
            decision,
          });
        if (!existing.ownershipClaimedAt || !existing.ownershipExpiresAt)
          throw new ConflictException(
            'Ownership da decisão Nutrition Shadow pendente está inconsistente',
          );
        if (existing.ownershipExpiresAt.getTime() > now.getTime())
          return Object.freeze({
            kind: 'OWNERSHIP_ACTIVE' as const,
            decision,
            ownershipClaimedAt: existing.ownershipClaimedAt,
            ownershipExpiresAt: existing.ownershipExpiresAt,
          });
        const recovered =
          await transaction.nutritionShadowRuntimeDecision.update({
            where: { id: existing.id },
            data: this.ownershipData(ownership),
          });
        return Object.freeze({
          kind: 'OWNERSHIP_RECOVERED' as const,
          decision: this.record(recovered),
          ownership,
          previousOwnershipExpiresAt: existing.ownershipExpiresAt,
        });
      }
      const created = await transaction.nutritionShadowRuntimeDecision.create({
        data: {
          id: input.id,
          operationKey: input.operationKey,
          inputFingerprint: input.inputFingerprint,
          userId: input.userId,
          conversationId: input.conversationId,
          messageId: input.messageId,
          correlationId: input.correlationId,
          traceId: input.traceId,
          conversationGoal: input.conversationGoal,
          ...this.ownershipData(ownership),
        },
      });
      return Object.freeze({
        kind: 'OWNERSHIP_CREATED' as const,
        decision: this.record(created),
        ownership,
      });
    });
  }

  async completeStarted(
    id: string,
    ownershipToken: string,
    shadowRunId: string,
  ): Promise<NutritionShadowRuntimeDecisionRecord> {
    const completed = await this.prisma.$transaction(async (transaction) => {
      const now = await this.databaseNow(transaction);
      const updated =
        await transaction.nutritionShadowRuntimeDecision.updateMany({
          where: {
            id,
            decision: NutritionShadowRuntimeDecisionType.PENDING,
            ownershipToken,
            ownershipExpiresAt: { gt: now },
          },
          data: {
            decision: NutritionShadowRuntimeDecisionType.STARTED,
            shadowRunId,
            ownershipToken: null,
            decisionAt: now,
          },
        });
      return updated.count === 1
        ? this.record(
            await transaction.nutritionShadowRuntimeDecision.findUniqueOrThrow({
              where: { id },
            }),
          )
        : null;
    });
    if (completed) return completed;
    const existing = await this.find(id);
    if (
      existing.decision === NutritionShadowRuntimeDecisionType.STARTED &&
      existing.shadowRunId === shadowRunId
    )
      return existing;
    throw new ConflictException(
      'Decisão Nutrition Shadow não pode ser concluída como STARTED',
    );
  }

  async completeSkipped(
    id: string,
    ownershipToken: string,
    reason: NutritionShadowRuntimeSkipReason,
  ): Promise<NutritionShadowRuntimeDecisionRecord> {
    const completed = await this.prisma.$transaction(async (transaction) => {
      const now = await this.databaseNow(transaction);
      const updated =
        await transaction.nutritionShadowRuntimeDecision.updateMany({
          where: {
            id,
            decision: NutritionShadowRuntimeDecisionType.PENDING,
            ownershipToken,
            ownershipExpiresAt: { gt: now },
          },
          data: {
            decision: NutritionShadowRuntimeDecisionType.SKIPPED,
            skipReason: reason,
            ownershipToken: null,
            decisionAt: now,
          },
        });
      return updated.count === 1
        ? this.record(
            await transaction.nutritionShadowRuntimeDecision.findUniqueOrThrow({
              where: { id },
            }),
          )
        : null;
    });
    if (completed) return completed;
    const existing = await this.find(id);
    if (
      existing.decision === NutritionShadowRuntimeDecisionType.SKIPPED &&
      existing.skipReason === reason
    )
      return existing;
    throw new ConflictException(
      'Decisão Nutrition Shadow não pode ser concluída como SKIPPED',
    );
  }

  private async find(
    id: string,
  ): Promise<NutritionShadowRuntimeDecisionRecord> {
    return this.record(
      await this.prisma.nutritionShadowRuntimeDecision.findUniqueOrThrow({
        where: { id },
      }),
    );
  }

  private record(value: {
    readonly id: string;
    readonly inputFingerprint: string;
    readonly conversationGoal: string;
    readonly decision: NutritionShadowRuntimeDecisionType;
    readonly skipReason: NutritionShadowRuntimeSkipReason | null;
    readonly shadowRunId: string | null;
    readonly ownershipClaimedAt: Date | null;
    readonly ownershipExpiresAt: Date | null;
  }): NutritionShadowRuntimeDecisionRecord {
    return Object.freeze({
      id: value.id,
      inputFingerprint: value.inputFingerprint,
      conversationGoal: requireNutritionShadowConversationGoal(
        value.conversationGoal,
      ),
      decision: value.decision,
      skipReason: value.skipReason,
      shadowRunId: value.shadowRunId,
      ownershipClaimedAt: value.ownershipClaimedAt,
      ownershipExpiresAt: value.ownershipExpiresAt,
    });
  }

  private ownership(
    token: string,
    claimedAt: Date,
  ): NutritionShadowRuntimeOwnership {
    return Object.freeze({
      token,
      claimedAt,
      expiresAt: new Date(
        claimedAt.getTime() + NUTRITION_SHADOW_RUNTIME_OWNERSHIP_LEASE_MS,
      ),
    });
  }

  private ownershipData(ownership: NutritionShadowRuntimeOwnership) {
    return {
      ownershipToken: ownership.token,
      ownershipClaimedAt: ownership.claimedAt,
      ownershipExpiresAt: ownership.expiresAt,
    };
  }

  private async databaseNow(
    transaction: Prisma.TransactionClient,
  ): Promise<Date> {
    const [databaseClock] = await transaction.$queryRaw<
      readonly { readonly now: Date }[]
    >`SELECT CURRENT_TIMESTAMP AS "now"`;
    if (!databaseClock)
      throw new ConflictException(
        'Relógio transacional da ownership Nutrition Shadow indisponível',
      );
    return databaseClock.now;
  }
}
