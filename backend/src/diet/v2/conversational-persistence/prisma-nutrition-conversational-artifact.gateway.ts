import { Injectable } from '@nestjs/common';
import type { NutritionConversationalArtifact, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  ConversationalArtifactOwnershipRecord,
  CreateConversationalArtifactRecord,
  NutritionConversationalArtifactRepository,
} from './nutrition-conversational-artifact.repository';

@Injectable()
export class PrismaNutritionConversationalArtifactGateway implements NutritionConversationalArtifactRepository {
  constructor(private readonly prisma: PrismaService) {}
  inTransaction<T>(
    operation: (transaction: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(operation, {
      maxWait: 5_000,
      timeout: 15_000,
    });
  }
  async acquireUserLock(
    transaction: Prisma.TransactionClient,
    userId: string,
  ): Promise<void> {
    await transaction.$queryRaw`
      WITH advisory_lock AS (
        SELECT pg_advisory_xact_lock(hashtext(${`nutrition-conversational-artifact:${userId}`}))
      )
      SELECT true AS "locked" FROM advisory_lock
    `;
  }
  async findOwnership(
    transaction: Prisma.TransactionClient,
    input: {
      readonly userId: string;
      readonly aiJobId: string;
      readonly reviewedPlanId: string | null;
    },
  ): Promise<ConversationalArtifactOwnershipRecord> {
    const [user, aiJob, reviewedPlan] = await Promise.all([
      transaction.user.findUnique({
        where: { id: input.userId },
        select: { id: true },
      }),
      transaction.aIJob.findUnique({
        where: { id: input.aiJobId },
        select: {
          id: true,
          userId: true,
          type: true,
          status: true,
          operationKey: true,
        },
      }),
      input.reviewedPlanId
        ? transaction.nutritionPlanV2.findUnique({
            where: { id: input.reviewedPlanId },
            select: { id: true, userId: true },
          })
        : Promise.resolve(null),
    ]);
    return { userExists: user !== null, aiJob, reviewedPlan };
  }
  findExisting(
    transaction: Prisma.TransactionClient,
    aiJobId: string,
    operationKey: string,
  ): Promise<NutritionConversationalArtifact | null> {
    return transaction.nutritionConversationalArtifact.findFirst({
      where: { OR: [{ aiJobId }, { operationKey }] },
    });
  }
  create(
    transaction: Prisma.TransactionClient,
    input: CreateConversationalArtifactRecord,
  ): Promise<NutritionConversationalArtifact> {
    return transaction.nutritionConversationalArtifact.create({ data: input });
  }
}
