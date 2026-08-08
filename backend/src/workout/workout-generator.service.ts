import {
  BadGatewayException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AIJobStatus, AIJobType, Prisma, WorkoutStatus } from '@prisma/client';
import { AIService } from '../ai/ai.service';
import { OpenAIResponseResult } from '../ai/interfaces/openai.interface';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import {
  GeneratedWorkoutDay,
  GeneratedWorkoutExercise,
  GeneratedWorkoutPlan,
} from './interfaces/generated-workout.interface';
import type { LegacyWorkoutCandidate } from './interfaces/legacy-workout-candidate.interface';
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
    const candidate = await this.generateCandidate(userId);
    return this.commitCandidate(candidate);
  }

  async generateCandidate(userId: string): Promise<LegacyWorkoutCandidate> {
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
    if (job.status === AIJobStatus.PROCESSING)
      throw new ServiceUnavailableException(
        'Geração legacy de treino já está em andamento',
      );
    if (job.status === AIJobStatus.COMPLETED)
      throw new ConflictException(
        'AIJob legacy de treino já concluído sem candidato reutilizável',
      );
    if (job.status === AIJobStatus.FAILED)
      throw new ServiceUnavailableException('AIJob legacy de treino já falhou');
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
      const output = this.freezeGeneratedWorkout(
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
          jobType: AIJobType.WORKOUT,
          response,
          result: storedResult,
        }),
      });
    } catch (error: unknown) {
      await this.aiService.failJob(job.id, error, response);
      throw error;
    }
  }

  async commitCandidate(candidate: LegacyWorkoutCandidate) {
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
    candidate: LegacyWorkoutCandidate,
  ) {
    await transaction.$queryRaw`
            WITH advisory_lock AS (
              SELECT pg_advisory_xact_lock(hashtext(${`workout:${candidate.userId}`}))
            )
            SELECT true AS "locked"
            FROM advisory_lock
          `;

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
      transaction.workoutPlan.findUnique({
        where: { aiJobId: candidate.aiJobId },
        include: WORKOUT_PLAN_INCLUDE,
      }),
    ]);
    this.assertCandidateApplicability(candidate, profile, job);
    if (existing) {
      if (job?.status !== AIJobStatus.COMPLETED)
        throw new ConflictException(
          'Plano legacy de treino existe sem AIJob concluído',
        );
      this.assertIdempotentWorkout(existing, candidate);
      return Object.freeze({ persistence: 'REUSED' as const, plan: existing });
    }
    if (job?.status === AIJobStatus.COMPLETED)
      throw new ConflictException(
        'AIJob legacy de treino concluído sem plano persistido',
      );
    if (job?.status !== AIJobStatus.PROCESSING)
      throw new ConflictException(
        'AIJob legacy de treino não está disponível para commit',
      );

    await transaction.workoutPlan.updateMany({
      where: {
        userId: candidate.userId,
        status: WorkoutStatus.ACTIVE,
      },
      data: {
        status: WorkoutStatus.ARCHIVED,
      },
    });
    await this.aiService.completeJobInTransaction(transaction, {
      userId: candidate.completion.userId,
      aiJobId: candidate.completion.aiJobId,
      jobType: candidate.completion.jobType,
      response: candidate.completion.response,
    });

    const workoutPlan = await transaction.workoutPlan.create({
      data: {
        userId: candidate.userId,
        profileId: candidate.profileId,
        aiJobId: candidate.aiJobId,
        title: candidate.output.title,
        objective: candidate.objective,
        status: WorkoutStatus.ACTIVE,
        generatedAt: candidate.generatedAt,
        days: {
          create: candidate.output.days.map((day) => ({
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
      userId: candidate.userId,
      action: AUDIT_ACTION.WORKOUT_GENERATED,
      entityType: AUDIT_ENTITY.WORKOUT_PLAN,
      entityId: workoutPlan.id,
      metadata: {
        profileId: candidate.profileId,
        objective: candidate.objective,
        generatedAt: candidate.generatedAt.toISOString(),
      },
    });

    return Object.freeze({
      persistence: 'CREATED' as const,
      plan: workoutPlan,
    });
  }

  failCandidate(
    candidate: LegacyWorkoutCandidate,
    error: unknown,
  ): Promise<void> {
    return this.aiService.failJob(
      candidate.aiJobId,
      error,
      candidate.completion.response,
    );
  }

  private assertCandidateApplicability(
    candidate: LegacyWorkoutCandidate,
    profile: { readonly goal: string } | null,
    job: {
      readonly userId: string;
      readonly type: AIJobType;
      readonly operationKey: string | null;
    } | null,
  ): void {
    if (!profile)
      throw new NotFoundException(
        'Perfil do candidato legacy de treino não pertence ao usuário',
      );
    if (profile.goal !== candidate.objective)
      throw new ConflictException(
        'Objetivo do candidato legacy de treino divergiu do perfil',
      );
    if (
      !job ||
      job.userId !== candidate.userId ||
      job.type !== AIJobType.WORKOUT ||
      job.operationKey !== candidate.operationKey ||
      candidate.completion.userId !== candidate.userId ||
      candidate.completion.aiJobId !== candidate.aiJobId ||
      candidate.completion.jobType !== AIJobType.WORKOUT ||
      candidate.completion.result.candidateOutput !==
        candidate.storedResult.candidateOutput ||
      candidate.completion.result.model !== candidate.storedResult.model ||
      candidate.completion.response.model !== candidate.storedResult.model
    )
      throw new ConflictException(
        'Ownership ou lifecycle do candidato legacy de treino inconsistente',
      );
    if (!Number.isFinite(candidate.generatedAt.getTime()))
      throw new ConflictException(
        'Data de geração do candidato legacy de treino inválida',
      );
    const parsed = this.parseResponse(candidate.storedResult.candidateOutput);
    if (JSON.stringify(parsed) !== JSON.stringify(candidate.output))
      throw new ConflictException(
        'Conteúdo do candidato legacy de treino divergiu do resultado validado',
      );
  }

  private assertIdempotentWorkout(
    existing: Prisma.WorkoutPlanGetPayload<{
      include: typeof WORKOUT_PLAN_INCLUDE;
    }>,
    candidate: LegacyWorkoutCandidate,
  ): void {
    const existingShape = {
      userId: existing.userId,
      profileId: existing.profileId,
      aiJobId: existing.aiJobId,
      title: existing.title,
      objective: existing.objective,
      generatedAt: existing.generatedAt.toISOString(),
      days: existing.days.map((day) => ({
        dayNumber: day.dayNumber,
        title: day.title,
        exercises: day.exercises
          .map((exercise) => ({
            exerciseName: exercise.exerciseName,
            sets: exercise.sets,
            reps: exercise.reps,
            restSeconds: exercise.restSeconds,
            notes: exercise.notes,
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
      generatedAt: candidate.generatedAt.toISOString(),
      days: candidate.output.days.map((day) => ({
        dayNumber: day.dayNumber,
        title: day.title,
        exercises: [...day.exercises].sort((left, right) =>
          JSON.stringify(left).localeCompare(JSON.stringify(right)),
        ),
      })),
    };
    if (JSON.stringify(existingShape) !== JSON.stringify(candidateShape))
      throw new ConflictException(
        'Retry do candidato legacy de treino divergiu do plano persistido',
      );
  }

  private freezeGeneratedWorkout(
    workout: GeneratedWorkoutPlan,
  ): GeneratedWorkoutPlan {
    return Object.freeze({
      title: workout.title,
      days: Object.freeze(
        workout.days.map((day) =>
          Object.freeze({
            dayNumber: day.dayNumber,
            title: day.title,
            exercises: Object.freeze(
              day.exercises.map((exercise) => Object.freeze(exercise)),
            ),
          }),
        ),
      ),
    });
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
