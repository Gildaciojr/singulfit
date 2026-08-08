import {
  BadGatewayException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  AIJobStatus,
  AIJobType,
  DietPlanStatus,
  MealAnalysisStatus,
  NutritionPlanImplementation,
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
import type { LegacyDietCandidate } from './interfaces/legacy-diet-candidate.interface';
import { AuditService } from '../observability/audit.service';
import {
  AUDIT_ACTION,
  AUDIT_ENTITY,
} from '../observability/observability.constants';
import { NutritionPlanOwnershipService } from './ownership/nutrition-plan-ownership.service';

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
    private readonly nutritionPlanOwnership: NutritionPlanOwnershipService,
  ) {}

  async generate(userId: string) {
    const candidate = await this.generateCandidate(userId);
    return this.commitCandidate(candidate);
  }

  async generateCandidate(userId: string): Promise<LegacyDietCandidate> {
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
    if (job.status === AIJobStatus.PROCESSING)
      throw new ServiceUnavailableException(
        'Geração legacy de dieta já está em andamento',
      );
    if (job.status === AIJobStatus.COMPLETED)
      throw new ConflictException(
        'AIJob legacy de dieta já concluído sem candidato reutilizável',
      );
    if (job.status === AIJobStatus.FAILED)
      throw new ServiceUnavailableException('AIJob legacy de dieta já falhou');
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
      const output = this.freezeGeneratedDiet(
        this.parseResponse(response.outputText),
      );
      const storedResult = Object.freeze({
        candidateOutput: response.outputText,
        model: response.model,
      });
      return Object.freeze({
        status: 'PENDING_COMPLETION' as const,
        userId,
        profileId: profile.id,
        objective: profile.goal,
        aiJobId: job.id,
        operationKey: job.operationKey ?? null,
        generatedAt: new Date(),
        output,
        storedResult,
        completion: Object.freeze({
          userId,
          aiJobId: job.id,
          jobType: AIJobType.DIET,
          response,
          result: storedResult,
        }),
      });
    } catch (error: unknown) {
      await this.aiService.failJob(job.id, error, response);
      throw error;
    }
  }

  async commitCandidate(candidate: LegacyDietCandidate) {
    try {
      const committed = await this.prisma.$transaction(
        (transaction) =>
          this.commitCandidateInTransaction(transaction, candidate),
        {
          maxWait: 5_000,
          timeout: 15_000,
        },
      );
      return committed.plan;
    } catch (error: unknown) {
      await this.failCandidate(candidate, error);
      throw error;
    }
  }

  async commitCandidateInTransaction(
    transaction: Prisma.TransactionClient,
    candidate: LegacyDietCandidate,
  ) {
    await this.nutritionPlanOwnership.acquireCanonicalLockInTransaction(
      transaction,
      candidate.userId,
    );

    const [profile, job, existing] = await Promise.all([
      transaction.fitnessProfile.findFirst({
        where: {
          id: candidate.profileId,
          userId: candidate.userId,
        },
        select: { goal: true },
      }),
      transaction.aIJob.findUnique({
        where: { id: candidate.aiJobId },
        select: {
          id: true,
          userId: true,
          type: true,
          status: true,
          operationKey: true,
        },
      }),
      transaction.dietPlan.findUnique({
        where: { aiJobId: candidate.aiJobId },
        include: DIET_PLAN_INCLUDE,
      }),
    ]);
    this.assertCandidateApplicability(candidate, profile, job);
    if (existing) {
      if (job?.status !== AIJobStatus.COMPLETED)
        throw new ConflictException(
          'Plano legacy de dieta existe sem AIJob concluído',
        );
      this.assertIdempotentDiet(existing, candidate);
      await this.nutritionPlanOwnership.assertInTransaction(transaction, {
        userId: candidate.userId,
        profileId: candidate.profileId,
        implementation: NutritionPlanImplementation.LEGACY,
        planId: existing.id,
        aiJobId: candidate.aiJobId,
      });
      return Object.freeze({ persistence: 'REUSED' as const, plan: existing });
    }
    if (job?.status === AIJobStatus.COMPLETED)
      throw new ConflictException(
        'AIJob legacy de dieta concluído sem plano persistido',
      );
    if (job?.status !== AIJobStatus.PROCESSING)
      throw new ConflictException(
        'AIJob legacy de dieta não está disponível para commit',
      );

    await transaction.dietPlan.updateMany({
      where: {
        userId: candidate.userId,
        status: DietPlanStatus.ACTIVE,
      },
      data: {
        status: DietPlanStatus.ARCHIVED,
      },
    });
    await this.aiService.completeJobInTransaction(transaction, {
      userId: candidate.completion.userId,
      aiJobId: candidate.completion.aiJobId,
      jobType: candidate.completion.jobType,
      response: candidate.completion.response,
    });

    const dietPlan = await transaction.dietPlan.create({
      data: {
        userId: candidate.userId,
        profileId: candidate.profileId,
        aiJobId: candidate.aiJobId,
        title: candidate.output.title,
        objective: candidate.objective,
        dailyCaloriesTarget: this.decimal(candidate.output.dailyCaloriesTarget),
        proteinTarget: this.decimal(candidate.output.proteinTarget),
        carbsTarget: this.decimal(candidate.output.carbsTarget),
        fatTarget: this.decimal(candidate.output.fatTarget),
        status: DietPlanStatus.ACTIVE,
        generatedAt: candidate.generatedAt,
        meals: {
          create: candidate.output.meals.map((meal) => ({
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

    await this.nutritionPlanOwnership.transitionInTransaction(transaction, {
      userId: candidate.userId,
      profileId: candidate.profileId,
      implementation: NutritionPlanImplementation.LEGACY,
      planId: dietPlan.id,
      aiJobId: candidate.aiJobId,
    });

    await this.auditService.recordInTransaction(transaction, {
      userId: candidate.userId,
      action: AUDIT_ACTION.DIET_GENERATED,
      entityType: AUDIT_ENTITY.DIET_PLAN,
      entityId: dietPlan.id,
      metadata: {
        profileId: candidate.profileId,
        aiJobId: candidate.aiJobId,
        objective: candidate.objective,
        generatedAt: candidate.generatedAt.toISOString(),
      },
    });

    return Object.freeze({ persistence: 'CREATED' as const, plan: dietPlan });
  }

  failCandidate(candidate: LegacyDietCandidate, error: unknown): Promise<void> {
    return this.aiService.failJob(
      candidate.aiJobId,
      error,
      candidate.completion.response,
    );
  }

  private assertCandidateApplicability(
    candidate: LegacyDietCandidate,
    profile: { readonly goal: string } | null,
    job: {
      readonly userId: string;
      readonly type: AIJobType;
      readonly operationKey: string | null;
    } | null,
  ): void {
    if (!profile)
      throw new NotFoundException(
        'Perfil do candidato legacy de dieta não pertence ao usuário',
      );
    if (profile.goal !== candidate.objective)
      throw new ConflictException(
        'Objetivo do candidato legacy de dieta divergiu do perfil',
      );
    if (
      !job ||
      job.userId !== candidate.userId ||
      job.type !== AIJobType.DIET ||
      job.operationKey !== candidate.operationKey ||
      candidate.completion.userId !== candidate.userId ||
      candidate.completion.aiJobId !== candidate.aiJobId ||
      candidate.completion.jobType !== AIJobType.DIET ||
      candidate.completion.result.candidateOutput !==
        candidate.storedResult.candidateOutput ||
      candidate.completion.result.model !== candidate.storedResult.model ||
      candidate.completion.response.model !== candidate.storedResult.model
    )
      throw new ConflictException(
        'Ownership ou lifecycle do candidato legacy de dieta inconsistente',
      );
    if (!Number.isFinite(candidate.generatedAt.getTime()))
      throw new ConflictException(
        'Data de geração do candidato legacy de dieta inválida',
      );
    const parsed = this.parseResponse(candidate.storedResult.candidateOutput);
    if (JSON.stringify(parsed) !== JSON.stringify(candidate.output))
      throw new ConflictException(
        'Conteúdo do candidato legacy de dieta divergiu do resultado validado',
      );
  }

  private assertIdempotentDiet(
    existing: Prisma.DietPlanGetPayload<{ include: typeof DIET_PLAN_INCLUDE }>,
    candidate: LegacyDietCandidate,
  ): void {
    const existingShape = {
      userId: existing.userId,
      profileId: existing.profileId,
      aiJobId: existing.aiJobId,
      title: existing.title,
      objective: existing.objective,
      dailyCaloriesTarget: existing.dailyCaloriesTarget.toNumber(),
      proteinTarget: existing.proteinTarget.toNumber(),
      carbsTarget: existing.carbsTarget.toNumber(),
      fatTarget: existing.fatTarget.toNumber(),
      generatedAt: existing.generatedAt.toISOString(),
      meals: existing.meals.map((meal) => ({
        name: meal.name,
        order: meal.order,
        caloriesTarget: meal.caloriesTarget.toNumber(),
        notes: meal.notes,
        items: meal.items
          .map((item) => ({
            foodName: item.foodName,
            quantity: item.quantity,
            calories: item.calories.toNumber(),
            protein: item.protein.toNumber(),
            carbs: item.carbs.toNumber(),
            fat: item.fat.toNumber(),
            substitutionGroup: item.substitutionGroup,
          }))
          .sort((left, right) =>
            JSON.stringify(left).localeCompare(JSON.stringify(right)),
          ),
      })),
    };
    const candidateShape = {
      userId: candidate.userId,
      profileId: candidate.profileId,
      aiJobId: candidate.aiJobId,
      title: candidate.output.title,
      objective: candidate.objective,
      dailyCaloriesTarget: candidate.output.dailyCaloriesTarget,
      proteinTarget: candidate.output.proteinTarget,
      carbsTarget: candidate.output.carbsTarget,
      fatTarget: candidate.output.fatTarget,
      generatedAt: candidate.generatedAt.toISOString(),
      meals: candidate.output.meals.map((meal) => ({
        name: meal.name,
        order: meal.order,
        caloriesTarget: meal.caloriesTarget,
        notes: meal.notes,
        items: [...meal.items].sort((left, right) =>
          JSON.stringify(left).localeCompare(JSON.stringify(right)),
        ),
      })),
    };
    if (JSON.stringify(existingShape) !== JSON.stringify(candidateShape))
      throw new ConflictException(
        'Retry do candidato legacy de dieta divergiu do plano persistido',
      );
  }

  private freezeGeneratedDiet(diet: GeneratedDietPlan): GeneratedDietPlan {
    return Object.freeze({
      title: diet.title,
      dailyCaloriesTarget: diet.dailyCaloriesTarget,
      proteinTarget: diet.proteinTarget,
      carbsTarget: diet.carbsTarget,
      fatTarget: diet.fatTarget,
      meals: Object.freeze(
        diet.meals.map((meal) =>
          Object.freeze({
            name: meal.name,
            order: meal.order,
            caloriesTarget: meal.caloriesTarget,
            notes: meal.notes,
            items: Object.freeze(meal.items.map((item) => Object.freeze(item))),
          }),
        ),
      ),
    });
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
