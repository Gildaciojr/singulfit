import {
  BadGatewayException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AIJobType, Prisma, WorkoutStatus } from '@prisma/client';
import { AIService } from '../ai/ai.service';
import { OpenAIResponseResult } from '../ai/interfaces/openai.interface';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import {
  GeneratedWorkoutDay,
  GeneratedWorkoutExercise,
  GeneratedWorkoutPlan,
} from './interfaces/generated-workout.interface';
import {
  WORKOUT_JSON_SCHEMA,
  WORKOUT_JSON_SCHEMA_NAME,
  WORKOUT_PROMPT_BY_GOAL,
} from './workout.constants';
import { WORKOUT_PLAN_INCLUDE } from './workout.service';
import { AuditService } from '../observability/audit.service';
import {
  AUDIT_ACTION,
  AUDIT_ENTITY,
} from '../observability/observability.constants';

const MAX_MEASUREMENTS_IN_CONTEXT = 12;

@Injectable()
export class WorkoutGeneratorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly aiService: AIService,
    private readonly auditService: AuditService,
  ) {}

  async generate(userId: string) {
    await this.subscriptionsService.getProfileSubscription(userId);
    const profile = await this.prisma.fitnessProfile.findUnique({
      where: {
        userId,
      },
      include: {
        foodRestrictions: {
          orderBy: {
            id: 'asc',
          },
        },
        injuryRestrictions: {
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
    });

    if (!profile) {
      throw new NotFoundException(
        'Complete o perfil fitness antes de gerar um treino',
      );
    }

    const job = await this.aiService.createStandaloneJob({
      userId,
      type: AIJobType.WORKOUT,
      promptName: WORKOUT_PROMPT_BY_GOAL[profile.goal],
    });
    let response: OpenAIResponseResult | undefined;

    try {
      response = await this.aiService.runTextJob(job.id, {
        input: JSON.stringify(this.buildContext(profile)),
        jsonSchema: {
          name: WORKOUT_JSON_SCHEMA_NAME,
          description:
            'Plano semanal de treino personalizado com dias e exercícios.',
          schema: WORKOUT_JSON_SCHEMA,
        },
      });
      const generatedWorkout = this.parseResponse(response.outputText);
      const successfulResponse = response;
      const generatedAt = new Date();

      return await this.prisma.$transaction(
        async (transaction) => {
          await transaction.$queryRaw`
            WITH advisory_lock AS (
              SELECT pg_advisory_xact_lock(hashtext(${`workout:${userId}`}))
            )
            SELECT true AS "locked"
            FROM advisory_lock
          `;

          await transaction.workoutPlan.updateMany({
            where: {
              userId,
              status: WorkoutStatus.ACTIVE,
            },
            data: {
              status: WorkoutStatus.ARCHIVED,
            },
          });
          await this.aiService.completeJobInTransaction(transaction, {
            userId,
            aiJobId: job.id,
            jobType: AIJobType.WORKOUT,
            response: successfulResponse,
          });

          const workoutPlan = await transaction.workoutPlan.create({
            data: {
              userId,
              profileId: profile.id,
              aiJobId: job.id,
              title: generatedWorkout.title,
              objective: profile.goal,
              status: WorkoutStatus.ACTIVE,
              generatedAt,
              days: {
                create: generatedWorkout.days.map((day) => ({
                  dayNumber: day.dayNumber,
                  title: day.title,
                  exercises: {
                    create: day.exercises.map((exercise) => ({
                      exerciseName: exercise.exerciseName,
                      sets: exercise.sets,
                      reps: exercise.reps,
                      restSeconds: exercise.restSeconds,
                      notes: exercise.notes,
                    })),
                  },
                })),
              },
            },
            include: WORKOUT_PLAN_INCLUDE,
          });

          await this.auditService.recordInTransaction(transaction, {
            userId,
            action: AUDIT_ACTION.WORKOUT_GENERATED,
            entityType: AUDIT_ENTITY.WORKOUT_PLAN,
            entityId: workoutPlan.id,
            metadata: {
              profileId: profile.id,
              objective: profile.goal,
              generatedAt: generatedAt.toISOString(),
            },
          });

          return workoutPlan;
        },
        {
          maxWait: 5_000,
          timeout: 15_000,
        },
      );
    } catch (error: unknown) {
      await this.aiService.failJob(job.id, error, response);
      throw error;
    }
  }

  private buildContext(profile: {
    gender: string;
    birthDate: Date;
    heightCm: number;
    currentWeightKg: Prisma.Decimal;
    targetWeightKg: Prisma.Decimal;
    activityLevel: string;
    goal: string;
    foodRestrictions: Array<{ type: string; description: string }>;
    injuryRestrictions: Array<{ description: string }>;
    bodyMeasurements: Array<{
      weightKg: Prisma.Decimal;
      bodyFatPercent: Prisma.Decimal | null;
      muscleMassKg: Prisma.Decimal | null;
      measuredAt: Date;
    }>;
  }) {
    return {
      profile: {
        gender: profile.gender,
        birthDate: profile.birthDate.toISOString().slice(0, 10),
        heightCm: profile.heightCm,
        currentWeightKg: profile.currentWeightKg.toNumber(),
        targetWeightKg: profile.targetWeightKg.toNumber(),
        activityLevel: profile.activityLevel,
        goal: profile.goal,
      },
      restrictions: {
        food: profile.foodRestrictions.map((restriction) => ({
          type: restriction.type,
          description: restriction.description,
        })),
        injuries: profile.injuryRestrictions.map(
          (restriction) => restriction.description,
        ),
      },
      measurements: profile.bodyMeasurements.map((measurement) => ({
        weightKg: measurement.weightKg.toNumber(),
        bodyFatPercent: measurement.bodyFatPercent?.toNumber() ?? null,
        muscleMassKg: measurement.muscleMassKg?.toNumber() ?? null,
        measuredAt: measurement.measuredAt.toISOString(),
      })),
    };
  }

  private parseResponse(outputText: string): GeneratedWorkoutPlan {
    let value: unknown;

    try {
      value = JSON.parse(outputText);
    } catch {
      throw new BadGatewayException('OpenAI retornou JSON de treino inválido');
    }

    if (!this.isRecord(value)) {
      throw new BadGatewayException(
        'OpenAI retornou estrutura de treino inválida',
      );
    }

    const title = this.requireText(value.title, 'title', 200);

    if (
      !Array.isArray(value.days) ||
      value.days.length < 1 ||
      value.days.length > 7
    ) {
      throw new BadGatewayException(
        'OpenAI retornou quantidade inválida de dias de treino',
      );
    }

    const days = value.days.map((day) => this.parseDay(day));
    const uniqueDayNumbers = new Set(days.map((day) => day.dayNumber));

    if (uniqueDayNumbers.size !== days.length) {
      throw new BadGatewayException(
        'OpenAI retornou dias de treino duplicados',
      );
    }

    return {
      title,
      days: days.sort((left, right) => left.dayNumber - right.dayNumber),
    };
  }

  private parseDay(value: unknown): GeneratedWorkoutDay {
    if (!this.isRecord(value)) {
      throw new BadGatewayException('OpenAI retornou dia de treino inválido');
    }

    if (
      !Number.isInteger(value.dayNumber) ||
      Number(value.dayNumber) < 1 ||
      Number(value.dayNumber) > 7
    ) {
      throw new BadGatewayException(
        'OpenAI retornou número de dia de treino inválido',
      );
    }

    if (
      !Array.isArray(value.exercises) ||
      value.exercises.length < 1 ||
      value.exercises.length > 20
    ) {
      throw new BadGatewayException(
        'OpenAI retornou quantidade inválida de exercícios',
      );
    }

    return {
      dayNumber: Number(value.dayNumber),
      title: this.requireText(value.title, 'day.title', 200),
      exercises: value.exercises.map((exercise) =>
        this.parseExercise(exercise),
      ),
    };
  }

  private parseExercise(value: unknown): GeneratedWorkoutExercise {
    if (!this.isRecord(value)) {
      throw new BadGatewayException('OpenAI retornou exercício inválido');
    }

    if (
      !Number.isInteger(value.sets) ||
      Number(value.sets) < 1 ||
      Number(value.sets) > 20 ||
      !Number.isInteger(value.restSeconds) ||
      Number(value.restSeconds) < 0 ||
      Number(value.restSeconds) > 600
    ) {
      throw new BadGatewayException(
        'OpenAI retornou séries ou descanso inválidos',
      );
    }

    let notes: string | null = null;

    if (value.notes !== null) {
      notes = this.requireText(value.notes, 'exercise.notes', 1000);
    }

    return {
      exerciseName: this.requireText(
        value.exerciseName,
        'exercise.exerciseName',
        200,
      ),
      sets: Number(value.sets),
      reps: this.requireText(value.reps, 'exercise.reps', 100),
      restSeconds: Number(value.restSeconds),
      notes,
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

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
