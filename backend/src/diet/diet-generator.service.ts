import {
  BadGatewayException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AIJobType,
  DietPlanStatus,
  FitnessGoal,
  MealAnalysisStatus,
  Prisma,
  WorkoutStatus,
} from '@prisma/client';
import { AIService } from '../ai/ai.service';
import { OpenAIResponseResult } from '../ai/interfaces/openai.interface';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import {
  DIET_JSON_SCHEMA,
  DIET_JSON_SCHEMA_NAME,
  DIET_PROMPT_BY_GOAL,
} from './diet.constants';
import { DIET_PLAN_INCLUDE } from './diet.service';
import {
  GeneratedDietMeal,
  GeneratedDietMealItem,
  GeneratedDietPlan,
} from './interfaces/generated-diet.interface';
import { AuditService } from '../observability/audit.service';
import {
  AUDIT_ACTION,
  AUDIT_ENTITY,
} from '../observability/observability.constants';

const MAX_MEASUREMENTS_IN_CONTEXT = 12;
const MAX_PROGRESS_SNAPSHOTS_IN_CONTEXT = 12;
const MAX_MEALS_IN_CONTEXT = 20;

@Injectable()
export class DietGeneratorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly aiService: AIService,
    private readonly auditService: AuditService,
  ) {}

  async generate(userId: string) {
    await this.subscriptionsService.getProfileSubscription(userId);
    const [profile, nutritionHistory, progressHistory, currentWorkout] =
      await Promise.all([
        this.prisma.fitnessProfile.findUnique({
          where: {
            userId,
          },
          include: {
            foodRestrictions: {
              orderBy: {
                id: 'asc',
              },
            },
            bodyMeasurements: {
              orderBy: {
                measuredAt: 'desc',
              },
              take: MAX_MEASUREMENTS_IN_CONTEXT,
            },
          },
        }),
        this.prisma.meal.findMany({
          where: {
            userId,
            analysis: {
              is: {
                status: MealAnalysisStatus.COMPLETED,
              },
            },
          },
          include: {
            analysis: {
              include: {
                items: {
                  orderBy: {
                    id: 'asc',
                  },
                },
              },
            },
          },
          orderBy: {
            createdAt: 'desc',
          },
          take: MAX_MEALS_IN_CONTEXT,
        }),
        this.prisma.progressSnapshot.findMany({
          where: {
            userId,
          },
          include: {
            insights: {
              orderBy: {
                createdAt: 'asc',
              },
            },
          },
          orderBy: {
            createdAt: 'desc',
          },
          take: MAX_PROGRESS_SNAPSHOTS_IN_CONTEXT,
        }),
        this.prisma.workoutPlan.findFirst({
          where: {
            userId,
            status: WorkoutStatus.ACTIVE,
          },
          include: {
            days: {
              orderBy: {
                dayNumber: 'asc',
              },
              include: {
                exercises: {
                  orderBy: {
                    id: 'asc',
                  },
                },
              },
            },
          },
          orderBy: {
            generatedAt: 'desc',
          },
        }),
      ]);

    if (!profile) {
      throw new NotFoundException(
        'Complete o perfil fitness antes de gerar uma dieta',
      );
    }

    const job = await this.aiService.createStandaloneJob({
      userId,
      type: AIJobType.DIET,
      promptName: DIET_PROMPT_BY_GOAL[profile.goal],
    });
    let response: OpenAIResponseResult | undefined;

    try {
      response = await this.aiService.runTextJob(job.id, {
        input: JSON.stringify({
          profile: {
            gender: profile.gender,
            birthDate: profile.birthDate.toISOString().slice(0, 10),
            heightCm: profile.heightCm,
            currentWeightKg: profile.currentWeightKg.toNumber(),
            targetWeightKg: profile.targetWeightKg.toNumber(),
            activityLevel: profile.activityLevel,
            goal: profile.goal,
          },
          foodRestrictions: profile.foodRestrictions.map((restriction) => ({
            type: restriction.type,
            description: restriction.description,
          })),
          measurements: profile.bodyMeasurements.map((measurement) => ({
            weightKg: measurement.weightKg.toNumber(),
            bodyFatPercent: measurement.bodyFatPercent?.toNumber() ?? null,
            muscleMassKg: measurement.muscleMassKg?.toNumber() ?? null,
            measuredAt: measurement.measuredAt.toISOString(),
          })),
          nutritionHistory: nutritionHistory.map((meal) => ({
            createdAt: meal.createdAt.toISOString(),
            totalCalories: meal.analysis?.totalCalories?.toNumber() ?? null,
            protein: meal.analysis?.totalProtein?.toNumber() ?? null,
            carbs: meal.analysis?.totalCarbs?.toNumber() ?? null,
            fat: meal.analysis?.totalFat?.toNumber() ?? null,
            foods:
              meal.analysis?.items.map((item) => ({
                foodName: item.foodName,
                estimatedGrams: item.estimatedGrams.toNumber(),
              })) ?? [],
          })),
          progress: progressHistory.map((snapshot) => ({
            weightKg: snapshot.weightKg.toNumber(),
            bodyFatPercent: snapshot.bodyFatPercent?.toNumber() ?? null,
            muscleMassKg: snapshot.muscleMassKg?.toNumber() ?? null,
            bmi: snapshot.bmi.toNumber(),
            createdAt: snapshot.createdAt.toISOString(),
            insights: snapshot.insights.map((insight) => insight.insight),
          })),
          currentWorkout: currentWorkout
            ? {
                title: currentWorkout.title,
                objective: currentWorkout.objective,
                generatedAt: currentWorkout.generatedAt.toISOString(),
                days: currentWorkout.days.map((day) => ({
                  dayNumber: day.dayNumber,
                  title: day.title,
                  exercises: day.exercises.map((exercise) => ({
                    exerciseName: exercise.exerciseName,
                    sets: exercise.sets,
                    reps: exercise.reps,
                  })),
                })),
              }
            : null,
        }),
        jsonSchema: {
          name: DIET_JSON_SCHEMA_NAME,
          description:
            'Plano alimentar brasileiro personalizado com metas, refeições, itens e substituições.',
          schema: DIET_JSON_SCHEMA,
        },
      });
      const generatedDiet = this.parseResponse(response.outputText);

      return await this.completeGeneration(
        userId,
        profile.id,
        profile.goal,
        job.id,
        response,
        generatedDiet,
      );
    } catch (error: unknown) {
      await this.aiService.failJob(job.id, error, response);
      throw error;
    }
  }

  private completeGeneration(
    userId: string,
    profileId: string,
    objective: FitnessGoal,
    aiJobId: string,
    response: OpenAIResponseResult,
    generatedDiet: GeneratedDietPlan,
  ) {
    const generatedAt = new Date();

    return this.prisma.$transaction(
      async (transaction) => {
        await transaction.$queryRaw`
          WITH advisory_lock AS (
            SELECT pg_advisory_xact_lock(hashtext(${`diet:${userId}`}))
          )
          SELECT true AS "locked"
          FROM advisory_lock
        `;

        await transaction.dietPlan.updateMany({
          where: {
            userId,
            status: DietPlanStatus.ACTIVE,
          },
          data: {
            status: DietPlanStatus.ARCHIVED,
          },
        });
        await this.aiService.completeJobInTransaction(transaction, {
          userId,
          aiJobId,
          jobType: AIJobType.DIET,
          response,
        });

        const dietPlan = await transaction.dietPlan.create({
          data: {
            userId,
            profileId,
            aiJobId,
            title: generatedDiet.title,
            objective,
            dailyCaloriesTarget: this.decimal(
              generatedDiet.dailyCaloriesTarget,
            ),
            proteinTarget: this.decimal(generatedDiet.proteinTarget),
            carbsTarget: this.decimal(generatedDiet.carbsTarget),
            fatTarget: this.decimal(generatedDiet.fatTarget),
            status: DietPlanStatus.ACTIVE,
            generatedAt,
            meals: {
              create: generatedDiet.meals.map((meal) => ({
                name: meal.name,
                order: meal.order,
                caloriesTarget: this.decimal(meal.caloriesTarget),
                notes: meal.notes,
                items: {
                  create: meal.items.map((item) => ({
                    foodName: item.foodName,
                    quantity: item.quantity,
                    calories: this.decimal(item.calories),
                    protein: this.decimal(item.protein),
                    carbs: this.decimal(item.carbs),
                    fat: this.decimal(item.fat),
                    substitutionGroup: item.substitutionGroup,
                  })),
                },
              })),
            },
          },
          include: DIET_PLAN_INCLUDE,
        });

        await this.auditService.recordInTransaction(transaction, {
          userId,
          action: AUDIT_ACTION.DIET_GENERATED,
          entityType: AUDIT_ENTITY.DIET_PLAN,
          entityId: dietPlan.id,
          metadata: {
            profileId,
            aiJobId,
            objective,
            generatedAt: generatedAt.toISOString(),
          },
        });

        return dietPlan;
      },
      {
        maxWait: 5_000,
        timeout: 15_000,
      },
    );
  }

  private parseResponse(outputText: string): GeneratedDietPlan {
    let value: unknown;

    try {
      value = JSON.parse(outputText);
    } catch {
      throw new BadGatewayException('OpenAI retornou JSON de dieta inválido');
    }

    if (!this.isRecord(value)) {
      throw new BadGatewayException(
        'OpenAI retornou estrutura de dieta inválida',
      );
    }

    if (
      !Array.isArray(value.meals) ||
      value.meals.length < 1 ||
      value.meals.length > 10
    ) {
      throw new BadGatewayException(
        'OpenAI retornou quantidade inválida de refeições',
      );
    }

    const meals = value.meals.map((meal) => this.parseMeal(meal));
    const uniqueOrders = new Set(meals.map((meal) => meal.order));

    if (uniqueOrders.size !== meals.length) {
      throw new BadGatewayException(
        'OpenAI retornou ordem de refeições duplicada',
      );
    }

    if (
      !meals.some((meal) =>
        meal.items.some((item) => item.substitutionGroup !== null),
      )
    ) {
      throw new BadGatewayException(
        'OpenAI não retornou substituições alimentares',
      );
    }

    return {
      title: this.requireText(value.title, 'title', 200),
      dailyCaloriesTarget: this.requireNumber(
        value.dailyCaloriesTarget,
        'dailyCaloriesTarget',
        800,
        6000,
      ),
      proteinTarget: this.requireNumber(
        value.proteinTarget,
        'proteinTarget',
        0,
        1000,
      ),
      carbsTarget: this.requireNumber(
        value.carbsTarget,
        'carbsTarget',
        0,
        1500,
      ),
      fatTarget: this.requireNumber(value.fatTarget, 'fatTarget', 0, 500),
      meals: meals.sort((left, right) => left.order - right.order),
    };
  }

  private parseMeal(value: unknown): GeneratedDietMeal {
    if (!this.isRecord(value)) {
      throw new BadGatewayException('OpenAI retornou refeição inválida');
    }

    if (
      !Number.isInteger(value.order) ||
      Number(value.order) < 1 ||
      Number(value.order) > 10 ||
      !Array.isArray(value.items) ||
      value.items.length < 1 ||
      value.items.length > 20
    ) {
      throw new BadGatewayException(
        'OpenAI retornou ordem ou itens de refeição inválidos',
      );
    }

    return {
      name: this.requireText(value.name, 'meal.name', 100),
      order: Number(value.order),
      caloriesTarget: this.requireNumber(
        value.caloriesTarget,
        'meal.caloriesTarget',
        0,
        3000,
      ),
      notes: this.optionalText(value.notes, 'meal.notes', 1000),
      items: value.items.map((item) => this.parseItem(item)),
    };
  }

  private parseItem(value: unknown): GeneratedDietMealItem {
    if (!this.isRecord(value)) {
      throw new BadGatewayException('OpenAI retornou item alimentar inválido');
    }

    return {
      foodName: this.requireText(value.foodName, 'item.foodName', 200),
      quantity: this.requireText(value.quantity, 'item.quantity', 100),
      calories: this.requireNumber(value.calories, 'item.calories', 0, 2000),
      protein: this.requireNumber(value.protein, 'item.protein', 0, 500),
      carbs: this.requireNumber(value.carbs, 'item.carbs', 0, 500),
      fat: this.requireNumber(value.fat, 'item.fat', 0, 300),
      substitutionGroup: this.optionalText(
        value.substitutionGroup,
        'item.substitutionGroup',
        300,
      ),
    };
  }

  private requireText(
    value: unknown,
    field: string,
    maxLength: number,
  ): string {
    const normalized = typeof value === 'string' ? value.trim() : '';

    if (!normalized || normalized.length > maxLength) {
      throw new BadGatewayException(`OpenAI retornou texto inválido: ${field}`);
    }

    return normalized;
  }

  private optionalText(
    value: unknown,
    field: string,
    maxLength: number,
  ): string | null {
    if (value === null) {
      return null;
    }

    return this.requireText(value, field, maxLength);
  }

  private requireNumber(
    value: unknown,
    field: string,
    minimum: number,
    maximum: number,
  ): number {
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      value < minimum ||
      value > maximum
    ) {
      throw new BadGatewayException(`OpenAI retornou valor inválido: ${field}`);
    }

    return value;
  }

  private decimal(value: number): Prisma.Decimal {
    return new Prisma.Decimal(value.toFixed(2));
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
