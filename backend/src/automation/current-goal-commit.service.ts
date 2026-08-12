import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { CurrentGoalResolution } from './user-goal-engine.service';

export type CurrentGoalCommitResult =
  | 'NOT_APPLICABLE'
  | 'APPLIED'
  | 'REPLAY'
  | 'STALE';

export interface CurrentGoalCommitInput {
  readonly userId: string;
  readonly operationKey: string;
  readonly referenceDate: Date;
  readonly resolution: CurrentGoalResolution | undefined;
}

export class CurrentGoalPersistenceError extends Error {
  constructor(cause: unknown) {
    super(
      cause instanceof Error && cause.message.trim()
        ? `Falha ao persistir objetivo atual: ${cause.message.trim()}`
        : 'Falha ao persistir objetivo atual',
    );
    this.name = CurrentGoalPersistenceError.name;
  }
}

@Injectable()
export class CurrentGoalCommitService {
  constructor(private readonly prisma: PrismaService) {}

  async commit(
    input: CurrentGoalCommitInput,
  ): Promise<CurrentGoalCommitResult> {
    if (input.resolution?.status !== 'RESOLVED') return 'NOT_APPLICABLE';

    try {
      return await this.prisma.$transaction(async (transaction) => {
        await this.acquireLock(transaction, input.userId);
        return this.commitInTransaction(transaction, input);
      });
    } catch (error: unknown) {
      throw new CurrentGoalPersistenceError(error);
    }
  }

  async acquireLock(
    transaction: Prisma.TransactionClient,
    userId: string,
  ): Promise<void> {
    await transaction.$queryRaw`
      WITH advisory_lock AS (
        SELECT pg_advisory_xact_lock(hashtext(${`current-goal:${userId}`}))
      )
      SELECT true AS "locked"
      FROM advisory_lock
    `;
  }

  async commitInTransaction(
    transaction: Prisma.TransactionClient,
    input: CurrentGoalCommitInput,
  ): Promise<CurrentGoalCommitResult> {
    const resolution = input.resolution;
    if (resolution?.status !== 'RESOLVED') return 'NOT_APPLICABLE';

    const current = await transaction.userGoalClassification.findUnique({
      where: { userId: input.userId },
      select: { classifiedAt: true, evidence: true },
    });
    if (
      current &&
      this.goalOperationKey(current.evidence) === input.operationKey
    ) {
      return 'REPLAY';
    }
    if (current && current.classifiedAt >= input.referenceDate) return 'STALE';

    await transaction.fitnessProfile.updateMany({
      where: { userId: input.userId },
      data: { goal: resolution.primaryGoal },
    });
    await transaction.nutritionProfile.updateMany({
      where: { userId: input.userId },
      data: { goal: resolution.primaryGoal },
    });
    await transaction.userGoalClassification.upsert({
      where: { userId: input.userId },
      update: {
        goal: resolution.classificationGoal,
        confidence: new Prisma.Decimal(resolution.confidence),
        evidence: this.currentGoalEvidence(resolution, input.operationKey),
        classifiedAt: input.referenceDate,
      },
      create: {
        userId: input.userId,
        goal: resolution.classificationGoal,
        confidence: new Prisma.Decimal(resolution.confidence),
        evidence: this.currentGoalEvidence(resolution, input.operationKey),
        classifiedAt: input.referenceDate,
      },
    });
    return 'APPLIED';
  }

  private currentGoalEvidence(
    resolution: Extract<CurrentGoalResolution, { status: 'RESOLVED' }>,
    operationKey: string,
  ): Prisma.InputJsonObject {
    return {
      source: 'EXPLICIT_CURRENT_MESSAGE',
      operationKey,
      primaryGoal: resolution.primaryGoal,
      declaredOutcome: resolution.declaredOutcome,
    };
  }

  private goalOperationKey(evidence: Prisma.JsonValue): string | null {
    if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
      return null;
    }
    const operationKey = Reflect.get(evidence, 'operationKey');
    return typeof operationKey === 'string' ? operationKey : null;
  }
}
