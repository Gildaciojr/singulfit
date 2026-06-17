import { Injectable, NotFoundException } from '@nestjs/common';
import {
  MealAnalysisStatus,
  OutboxEvent,
  Prisma,
  Severity,
} from '@prisma/client';
import { EventBusService } from '../event-bus/event-bus.service';
import { INTERNAL_EVENT } from '../event-bus/event-bus.constants';
import { AuditService } from '../observability/audit.service';
import { EventService } from '../observability/event.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  CONTEXT_AGGREGATE,
  CONTEXT_AUDIT_ACTION,
  CONTEXT_AUDIT_ENTITY,
  CONTEXT_SOURCE,
} from './context.constants';
import { ContextStatistics, MemoryService } from './memory.service';

interface RefreshContextInput {
  userId: string;
  refreshKey: string;
  attempt: number;
}

@Injectable()
export class ContextSnapshotService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly memoryService: MemoryService,
    private readonly eventBus: EventBusService,
    private readonly eventService: EventService,
    private readonly auditService: AuditService,
  ) {}

  async refreshFromEvent(
    event: Pick<OutboxEvent, 'id' | 'aggregateId' | 'attempts' | 'payload'>,
  ) {
    const input: RefreshContextInput = {
      userId: this.requiredString(event.payload, 'userId'),
      refreshKey: event.aggregateId,
      attempt: event.attempts,
    };
    const existing = await this.prisma.userContextSnapshot.findUnique({
      where: {
        refreshKey: input.refreshKey,
      },
    });

    if (existing) {
      return existing;
    }

    await this.recordStarted(input, event.id);

    try {
      return await this.generate(input, event.id);
    } catch (error: unknown) {
      await this.recordFailed(input, event.id, error);
      throw error;
    }
  }

  async getStatistics(
    userId: string,
    at = new Date(),
  ): Promise<ContextStatistics> {
    const sevenDaysAgo = new Date(at.getTime() - 7 * 86_400_000);
    const thirtyDaysAgo = new Date(at.getTime() - 30 * 86_400_000);
    const messageWhere = {
      conversation: {
        userId,
      },
    } satisfies Prisma.MessageWhereInput;
    const [
      lastConversation,
      messagesLast7Days,
      messagesLast30Days,
      nutritionAnalysesCount,
      latestCheckIn,
    ] = await Promise.all([
      this.prisma.conversation.findFirst({
        where: {
          userId,
          lastMessageAt: {
            not: null,
          },
        },
        select: {
          lastMessageAt: true,
        },
        orderBy: {
          lastMessageAt: 'desc',
        },
      }),
      this.prisma.message.count({
        where: {
          ...messageWhere,
          timestamp: {
            gte: sevenDaysAgo,
            lte: at,
          },
        },
      }),
      this.prisma.message.count({
        where: {
          ...messageWhere,
          timestamp: {
            gte: thirtyDaysAgo,
            lte: at,
          },
        },
      }),
      this.prisma.mealAnalysis.count({
        where: {
          status: MealAnalysisStatus.COMPLETED,
          meal: {
            userId,
          },
        },
      }),
      this.prisma.fitnessCheckIn.findFirst({
        where: {
          userId,
        },
        select: {
          adherenceScore: true,
        },
        orderBy: {
          createdAt: 'desc',
        },
      }),
    ]);

    return {
      lastInteractionAt: lastConversation?.lastMessageAt ?? null,
      messagesLast7Days,
      messagesLast30Days,
      nutritionAnalysesCount,
      adherenceScore: latestCheckIn?.adherenceScore ?? null,
    };
  }

  private async generate(input: RefreshContextInput, outboxEventId: string) {
    const user = await this.prisma.user.findUnique({
      where: {
        id: input.userId,
      },
      select: {
        id: true,
        fitnessProfile: {
          include: {
            foodRestrictions: {
              orderBy: {
                id: 'asc',
              },
            },
          },
        },
        nutritionProfile: true,
      },
    });

    if (!user) {
      throw new NotFoundException('Usuário do contexto não encontrado');
    }

    const generatedAt = new Date();
    const statistics = await this.getStatistics(user.id, generatedAt);
    const projectedProfile = user.fitnessProfile
      ? {
          goal: user.fitnessProfile.goal,
          activityLevel: user.fitnessProfile.activityLevel,
          currentWeightKg: user.fitnessProfile.currentWeightKg,
          targetWeightKg: user.fitnessProfile.targetWeightKg,
        }
      : user.nutritionProfile;
    const preparedMemory = await this.memoryService.prepareLongTermMemory(
      user.id,
      statistics,
      projectedProfile,
      generatedAt,
    );

    return this.prisma.$transaction(
      async (transaction) => {
        await transaction.$queryRaw`
          WITH advisory_lock AS (
            SELECT pg_advisory_xact_lock(
              hashtext(${`context-refresh:${user.id}`})
            )
          )
          SELECT true AS "locked"
          FROM advisory_lock
        `;
        const existing = await transaction.userContextSnapshot.findUnique({
          where: {
            refreshKey: input.refreshKey,
          },
        });

        if (existing) {
          return existing;
        }

        if (user.fitnessProfile) {
          await this.synchronizeNutritionProfile(
            transaction,
            user.id,
            user.fitnessProfile,
          );
        }

        await transaction.userPreferences.upsert({
          where: {
            userId: user.id,
          },
          update: {},
          create: {
            userId: user.id,
          },
        });
        await this.memoryService.persistLongTermInTransaction(
          transaction,
          user.id,
          preparedMemory,
        );
        const snapshot = await transaction.userContextSnapshot.create({
          data: {
            userId: user.id,
            refreshKey: input.refreshKey,
            weightKg: projectedProfile?.currentWeightKg,
            goal: projectedProfile?.goal,
            activityLevel: projectedProfile?.activityLevel,
            lastInteractionAt: statistics.lastInteractionAt,
            messagesLast7Days: statistics.messagesLast7Days,
            messagesLast30Days: statistics.messagesLast30Days,
            nutritionAnalysesCount: statistics.nutritionAnalysesCount,
            adherenceScore: statistics.adherenceScore,
            generatedAt,
          },
        });

        await this.eventService.recordInTransaction(transaction, {
          source: CONTEXT_SOURCE,
          severity: Severity.INFO,
          eventType: INTERNAL_EVENT.USER_CONTEXT_REFRESH_COMPLETED,
          message: 'Refresh de contexto concluído',
          metadata: this.metadata(input, outboxEventId, {
            snapshotId: snapshot.id,
          }),
        });
        await this.auditService.recordInTransaction(transaction, {
          userId: user.id,
          action: CONTEXT_AUDIT_ACTION.REFRESH_COMPLETED,
          entityType: CONTEXT_AUDIT_ENTITY.USER_CONTEXT,
          entityId: user.id,
          metadata: {
            refreshKey: input.refreshKey,
            snapshotId: snapshot.id,
            outboxEventId,
          },
        });
        await this.eventBus.publish(
          {
            eventType: INTERNAL_EVENT.USER_CONTEXT_REFRESH_COMPLETED,
            aggregateType: CONTEXT_AGGREGATE.REFRESH,
            aggregateId: input.refreshKey,
            payload: {
              userId: user.id,
              refreshKey: input.refreshKey,
              snapshotId: snapshot.id,
            },
          },
          transaction,
        );

        return snapshot;
      },
      {
        maxWait: 5_000,
        timeout: 15_000,
      },
    );
  }

  private async synchronizeNutritionProfile(
    transaction: Prisma.TransactionClient,
    userId: string,
    profile: {
      gender: 'MALE' | 'FEMALE';
      birthDate: Date;
      heightCm: number;
      currentWeightKg: Prisma.Decimal;
      targetWeightKg: Prisma.Decimal;
      activityLevel: 'SEDENTARY' | 'LIGHT' | 'MODERATE' | 'HIGH' | 'ATHLETE';
      goal: 'WEIGHT_LOSS' | 'MUSCLE_GAIN' | 'MAINTENANCE';
      foodRestrictions: Array<{
        type: string;
        description: string;
      }>;
    },
  ): Promise<void> {
    const restrictions: Prisma.InputJsonArray = profile.foodRestrictions.map(
      (restriction) => ({
        type: restriction.type,
        description: restriction.description,
      }),
    );

    await transaction.nutritionProfile.upsert({
      where: {
        userId,
      },
      update: {
        sex: profile.gender,
        birthDate: profile.birthDate,
        heightCm: profile.heightCm,
        currentWeightKg: profile.currentWeightKg,
        targetWeightKg: profile.targetWeightKg,
        activityLevel: profile.activityLevel,
        goal: profile.goal,
        restrictions,
      },
      create: {
        userId,
        sex: profile.gender,
        birthDate: profile.birthDate,
        heightCm: profile.heightCm,
        currentWeightKg: profile.currentWeightKg,
        targetWeightKg: profile.targetWeightKg,
        activityLevel: profile.activityLevel,
        goal: profile.goal,
        restrictions,
        allergies: [],
        medicalConditions: [],
      },
    });
  }

  private recordStarted(
    input: RefreshContextInput,
    outboxEventId: string,
  ): Promise<unknown> {
    return this.prisma.$transaction(async (transaction) => {
      await this.eventService.recordInTransaction(transaction, {
        source: CONTEXT_SOURCE,
        severity: Severity.INFO,
        eventType: INTERNAL_EVENT.USER_CONTEXT_REFRESH_REQUESTED,
        message: 'Refresh de contexto iniciado',
        metadata: this.metadata(input, outboxEventId),
      });
      await this.auditService.recordInTransaction(transaction, {
        userId: input.userId,
        action: CONTEXT_AUDIT_ACTION.REFRESH_STARTED,
        entityType: CONTEXT_AUDIT_ENTITY.USER_CONTEXT,
        entityId: input.userId,
        metadata: {
          refreshKey: input.refreshKey,
          attempt: input.attempt,
          outboxEventId,
        },
      });
    });
  }

  private recordFailed(
    input: RefreshContextInput,
    outboxEventId: string,
    error: unknown,
  ): Promise<unknown> {
    const lastError = this.safeError(error);

    return this.prisma.$transaction(async (transaction) => {
      await this.eventService.recordInTransaction(transaction, {
        source: CONTEXT_SOURCE,
        severity: Severity.ERROR,
        eventType: INTERNAL_EVENT.USER_CONTEXT_REFRESH_FAILED,
        message: 'Refresh de contexto falhou',
        metadata: this.metadata(input, outboxEventId, {
          lastError,
        }),
      });
      await this.auditService.recordInTransaction(transaction, {
        userId: input.userId,
        action: CONTEXT_AUDIT_ACTION.REFRESH_FAILED,
        entityType: CONTEXT_AUDIT_ENTITY.USER_CONTEXT,
        entityId: input.userId,
        metadata: {
          refreshKey: input.refreshKey,
          attempt: input.attempt,
          outboxEventId,
          lastError,
        },
      });
      await this.eventBus.publish(
        {
          eventType: INTERNAL_EVENT.USER_CONTEXT_REFRESH_FAILED,
          aggregateType: CONTEXT_AGGREGATE.REFRESH,
          aggregateId: `${input.refreshKey}:${input.attempt}`,
          payload: {
            userId: input.userId,
            refreshKey: input.refreshKey,
            attempt: input.attempt,
          },
        },
        transaction,
      );
    });
  }

  private metadata(
    input: RefreshContextInput,
    outboxEventId: string,
    extra: Prisma.InputJsonObject = {},
  ): Prisma.InputJsonObject {
    return {
      userId: input.userId,
      refreshKey: input.refreshKey,
      attempt: input.attempt,
      outboxEventId,
      ...extra,
    };
  }

  private requiredString(payload: Prisma.JsonValue, key: string): string {
    if (
      typeof payload !== 'object' ||
      payload === null ||
      Array.isArray(payload) ||
      typeof payload[key] !== 'string' ||
      !payload[key].trim()
    ) {
      throw new Error(`Payload do refresh sem ${key}`);
    }

    return payload[key].trim();
  }

  private safeError(error: unknown): string {
    if (error instanceof Error && error.message.trim()) {
      return error.message.trim().slice(0, 2_000);
    }

    return 'Falha não identificada no refresh de contexto';
  }
}
