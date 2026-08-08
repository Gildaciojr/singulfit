import { ConflictException, Injectable, Logger } from '@nestjs/common';
import {
  DietPlanStatus,
  NutritionPlanImplementation,
  NutritionPlanStatus,
  Prisma,
} from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import {
  CANONICAL_NUTRITION_READ_CONFLICT,
  type CurrentNutritionPlan,
  type LegacyCurrentNutritionPlan,
  type NutritionPlanReference,
  type V2CurrentNutritionPlan,
} from './current-nutrition-plan-reader.contract';
import { DIET_PLAN_INCLUDE } from './diet.service';
import { NutritionPlanV2PersistenceValidator } from './v2/persistence/nutrition-plan-v2-persistence.validator';

const DEFAULT_HISTORY_LIMIT = 50;
const MAX_HISTORY_LIMIT = 100;

type LegacyPlanRecord = Prisma.DietPlanGetPayload<{
  include: typeof DIET_PLAN_INCLUDE;
}>;

@Injectable()
export class CurrentNutritionPlanReaderService {
  private readonly logger = new Logger(CurrentNutritionPlanReaderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly v2Validator: NutritionPlanV2PersistenceValidator,
  ) {}

  async getCurrent(userId: string): Promise<CurrentNutritionPlan | null> {
    const ownership = await this.prisma.nutritionPlanOwnership.findUnique({
      where: { userId },
    });
    if (ownership) {
      if (ownership.implementation === NutritionPlanImplementation.LEGACY) {
        const plan = await this.prisma.dietPlan.findFirst({
          where: {
            id: ownership.planId,
            userId,
            profileId: ownership.profileId,
            status: DietPlanStatus.ACTIVE,
          },
          include: DIET_PLAN_INCLUDE,
        });
        if (!plan) throw this.ownershipConflict(userId, 'LEGACY');
        this.logCurrent('LEGACY');
        return this.legacy(plan);
      }
      const plan = await this.prisma.nutritionPlanV2.findFirst({
        where: {
          id: ownership.planId,
          userId,
          profileId: ownership.profileId,
          status: NutritionPlanStatus.ACTIVE,
        },
      });
      if (!plan) throw this.ownershipConflict(userId, 'V2');
      try {
        const current = this.v2(plan);
        this.logCurrent('V2');
        return current;
      } catch {
        throw this.ownershipConflict(userId, 'V2');
      }
    }

    const [legacy, v2] = await Promise.all([
      this.prisma.dietPlan.findMany({
        where: { userId, status: DietPlanStatus.ACTIVE },
        include: DIET_PLAN_INCLUDE,
        orderBy: [{ generatedAt: 'desc' }, { id: 'desc' }],
        take: 2,
      }),
      this.prisma.nutritionPlanV2.findMany({
        where: { userId, status: NutritionPlanStatus.ACTIVE },
        orderBy: [{ generatedAt: 'desc' }, { id: 'desc' }],
        take: 2,
      }),
    ]);

    if (legacy.length > 1 || v2.length > 1 || (legacy[0] && v2[0])) {
      throw this.conflict(userId, legacy.length, v2.length);
    }
    if (legacy[0]) {
      this.logCurrent('LEGACY');
      return this.legacy(legacy[0]);
    }
    if (v2[0]) {
      this.logCurrent('V2');
      return this.v2(v2[0]);
    }
    this.logCurrent('NONE');
    return null;
  }

  async getByReference(
    userId: string,
    reference: NutritionPlanReference,
  ): Promise<CurrentNutritionPlan | null> {
    switch (reference.implementation) {
      case 'LEGACY': {
        const plan = await this.prisma.dietPlan.findFirst({
          where: { id: reference.id, userId },
          include: DIET_PLAN_INCLUDE,
        });
        return plan ? this.legacy(plan) : null;
      }
      case 'V2': {
        const plan = await this.prisma.nutritionPlanV2.findFirst({
          where: { id: reference.id, userId },
        });
        return plan ? this.v2(plan) : null;
      }
    }
  }

  async listHistory(
    userId: string,
    requestedLimit = DEFAULT_HISTORY_LIMIT,
  ): Promise<readonly CurrentNutritionPlan[]> {
    const limit = this.historyLimit(requestedLimit);
    const [legacy, v2] = await Promise.all([
      this.prisma.dietPlan.findMany({
        where: { userId },
        include: DIET_PLAN_INCLUDE,
        orderBy: [{ generatedAt: 'desc' }, { id: 'desc' }],
        take: limit,
      }),
      this.prisma.nutritionPlanV2.findMany({
        where: { userId },
        orderBy: [{ generatedAt: 'desc' }, { id: 'desc' }],
        take: limit,
      }),
    ]);

    const history = Object.freeze(
      [
        ...legacy.map((plan) => this.legacy(plan)),
        ...v2.map((plan) => this.v2(plan)),
      ]
        .sort((left, right) => this.compareHistory(left, right))
        .slice(0, limit),
    );
    this.logger.debug(
      `Canonical nutrition history: ${JSON.stringify({
        historyImplementations: [
          ...new Set(history.map((item) => item.implementation)),
        ],
        itemCount: history.length,
      })}`,
    );
    return history;
  }

  private legacy(plan: LegacyPlanRecord): LegacyCurrentNutritionPlan {
    return Object.freeze({
      implementation: 'LEGACY',
      id: plan.id,
      userId: plan.userId,
      profileId: plan.profileId,
      aiJobId: plan.aiJobId,
      title: plan.title,
      status: plan.status,
      objective: plan.objective,
      dailyCaloriesTarget: plan.dailyCaloriesTarget.toNumber(),
      proteinTarget: plan.proteinTarget.toNumber(),
      carbsTarget: plan.carbsTarget.toNumber(),
      fatTarget: plan.fatTarget.toNumber(),
      generatedAt: plan.generatedAt.toISOString(),
      createdAt: plan.createdAt.toISOString(),
      updatedAt: plan.updatedAt.toISOString(),
      meals: Object.freeze(
        plan.meals.map((meal) =>
          Object.freeze({
            id: meal.id,
            name: meal.name,
            order: meal.order,
            caloriesTarget: meal.caloriesTarget.toNumber(),
            notes: meal.notes,
            items: Object.freeze(
              meal.items.map((item) =>
                Object.freeze({
                  id: item.id,
                  foodName: item.foodName,
                  quantity: item.quantity,
                  calories: item.calories.toNumber(),
                  protein: item.protein.toNumber(),
                  carbs: item.carbs.toNumber(),
                  fat: item.fat.toNumber(),
                  substitutionGroup: item.substitutionGroup,
                }),
              ),
            ),
          }),
        ),
      ),
    });
  }

  private v2(
    plan: Prisma.NutritionPlanV2GetPayload<object>,
  ): V2CurrentNutritionPlan {
    const aggregate = this.v2Validator.reconstruct(plan);
    return Object.freeze({
      implementation: 'V2',
      id: aggregate.id,
      userId: aggregate.userId,
      profileId: aggregate.profileId,
      aiJobId: aggregate.aiJobId,
      title: aggregate.document.title,
      status: aggregate.status,
      schemaVersion: aggregate.schemaVersion,
      engineVersion: aggregate.engineVersion,
      artifactType: aggregate.artifactType,
      lifecycleReason: aggregate.lifecycleReason,
      replacesPlanReference: aggregate.replacesPlanReference,
      objectiveSummary: aggregate.document.objectiveSummary,
      document: aggregate.document,
      generatedAt: aggregate.generatedAt.toISOString(),
      createdAt: aggregate.createdAt.toISOString(),
      updatedAt: aggregate.updatedAt.toISOString(),
    });
  }

  private compareHistory(
    left: CurrentNutritionPlan,
    right: CurrentNutritionPlan,
  ): number {
    return (
      right.generatedAt.localeCompare(left.generatedAt) ||
      right.updatedAt.localeCompare(left.updatedAt) ||
      right.createdAt.localeCompare(left.createdAt) ||
      right.id.localeCompare(left.id) ||
      right.implementation.localeCompare(left.implementation)
    );
  }

  private historyLimit(value: number): number {
    if (!Number.isInteger(value) || value < 1 || value > MAX_HISTORY_LIMIT) {
      throw new ConflictException('Limite do histórico nutricional inválido');
    }
    return value;
  }

  private conflict(
    userId: string,
    legacyActiveCount: number,
    v2ActiveCount: number,
  ): ConflictException {
    this.logger.warn(
      `Canonical nutrition read conflict: ${JSON.stringify({
        readerConflict: true,
        subject: this.subject(userId),
        legacyActiveCount,
        v2ActiveCount,
      })}`,
    );
    return new ConflictException({
      statusCode: 409,
      error: CANONICAL_NUTRITION_READ_CONFLICT,
      message:
        'Não foi possível determinar o owner canônico do plano nutricional atual',
      context: {
        subject: this.subject(userId),
        legacyActiveCount,
        v2ActiveCount,
      },
    });
  }

  private ownershipConflict(
    userId: string,
    implementation: 'LEGACY' | 'V2',
  ): ConflictException {
    this.logger.warn(
      `Canonical nutrition ownership inconsistency: ${JSON.stringify({
        readerConflict: true,
        subject: this.subject(userId),
        implementation,
      })}`,
    );
    return new ConflictException({
      statusCode: 409,
      error: CANONICAL_NUTRITION_READ_CONFLICT,
      message: 'Ownership canônico aponta para um plano nutricional inválido',
      context: { subject: this.subject(userId), implementation },
    });
  }

  private subject(userId: string): string {
    return createHash('sha256').update(userId).digest('hex').slice(0, 12);
  }

  private logCurrent(implementation: 'LEGACY' | 'V2' | 'NONE'): void {
    this.logger.debug(
      `Canonical nutrition current: ${JSON.stringify({
        nutritionCurrentImplementation: implementation,
      })}`,
    );
  }
}
