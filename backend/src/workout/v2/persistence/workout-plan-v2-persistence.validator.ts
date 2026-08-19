import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AIJobStatus,
  AIJobType,
  Prisma,
  type FitnessGoal,
} from '@prisma/client';
import type {
  WorkoutActivityV2,
  WorkoutPlanV2,
} from '../workout-plan-v2.contract';
import type { PersistWorkoutPlanV2Input } from './workout-plan-v2-persistence.contract';
import type {
  PersistedWorkoutPlanRecord,
  WorkoutPlanV2OwnershipRecord,
  WorkoutPlanV2Projection,
} from './workout-plan-v2.repository';

const CANONICAL_PLAN_ARTIFACTS = new Set<string>([
  'WEEKLY_PLAN',
  'PLAN_ADAPTATION',
]);

export interface ValidatedWorkoutPlanV2Persistence {
  readonly document: Prisma.InputJsonObject;
  readonly projection: WorkoutPlanV2Projection;
}

@Injectable()
export class WorkoutPlanV2PersistenceValidator {
  validateInput(
    input: PersistWorkoutPlanV2Input,
  ): ValidatedWorkoutPlanV2Persistence {
    this.requireIdentifier(input.ownership.userId, 'Usuário');
    this.requireIdentifier(input.ownership.profileId, 'Perfil');
    if (input.executionContext) {
      this.requireIdentifier(
        input.executionContext.correlationId,
        'Correlation ID',
      );
      if (input.executionContext.traceId !== undefined)
        this.requireIdentifier(input.executionContext.traceId, 'Trace ID');
    }

    const generation = input.generation;
    const plan = generation.output;
    if (!CANONICAL_PLAN_ARTIFACTS.has(plan.artifactType))
      throw new BadRequestException(
        `Artefato de treino V2 não aplicável como plano canônico: ${plan.artifactType}`,
      );
    if (plan.validation.status === 'INVALID')
      throw new BadRequestException(
        'Plano de treino V2 inválido não pode ser persistido',
      );
    if (plan.sessions.length === 0)
      throw new BadRequestException(
        'Plano de treino V2 canônico deve possuir sessões',
      );
    if (
      plan.generationMetadata.aiJobId !== generation.aiJobId ||
      plan.generationMetadata.operationKey !== generation.operationKey ||
      plan.generationMetadata.model !== generation.storedResult.model ||
      plan.generationMetadata.reused !== generation.reused
    )
      throw new BadRequestException(
        'Metadados de geração do treino V2 inconsistentes',
      );
    if (
      generation.status === 'PENDING_COMPLETION' &&
      (generation.reused || generation.completion === null)
    )
      throw new BadRequestException(
        'Resultado de treino V2 não está pendente de conclusão',
      );
    if (
      generation.completion &&
      (generation.completion.userId !== input.ownership.userId ||
        generation.completion.aiJobId !== generation.aiJobId ||
        generation.completion.jobType !== AIJobType.WORKOUT ||
        generation.completion.result.candidateOutput !==
          generation.storedResult.candidateOutput ||
        generation.completion.result.model !== generation.storedResult.model ||
        generation.completion.response.model !== generation.storedResult.model)
    )
      throw new BadRequestException(
        'Conclusão do AIJob de treino V2 inconsistente',
      );

    const document = this.toJsonRecord(plan);
    return Object.freeze({
      document,
      projection: this.project(plan, input.calendarWeekdays),
    });
  }

  assertOwnership(
    ownership: WorkoutPlanV2OwnershipRecord,
    input: PersistWorkoutPlanV2Input,
  ): FitnessGoal {
    if (!ownership.profile)
      throw new NotFoundException(
        'Perfil do plano de treino V2 não pertence ao usuário',
      );
    const aiJob = ownership.aiJob;
    if (!aiJob)
      throw new NotFoundException('AIJob do plano de treino V2 não encontrado');
    if (
      aiJob.userId !== input.ownership.userId ||
      aiJob.type !== AIJobType.WORKOUT ||
      aiJob.promptVersionId !==
        input.generation.output.generationMetadata.promptVersionId ||
      aiJob.operationKey !== input.generation.operationKey
    )
      throw new ConflictException(
        'AIJob do plano de treino V2 pertence a outro contexto',
      );
    if (
      aiJob.status !== AIJobStatus.PROCESSING &&
      aiJob.status !== AIJobStatus.COMPLETED
    )
      throw new ConflictException(
        'AIJob do plano de treino V2 não está disponível para persistência',
      );
    return ownership.profile.goal;
  }

  assertNewPersistenceState(
    ownership: WorkoutPlanV2OwnershipRecord,
    input: PersistWorkoutPlanV2Input,
  ): void {
    if (input.generation.status === 'ALREADY_COMPLETED')
      throw new ConflictException(
        'AIJob concluído sem plano de treino V2 persistido',
      );
    if (ownership.aiJob?.status !== AIJobStatus.PROCESSING)
      throw new ConflictException(
        'AIJob de treino V2 não está em processamento para efetivação',
      );
  }

  assertReusableState(ownership: WorkoutPlanV2OwnershipRecord): void {
    if (ownership.aiJob?.status !== AIJobStatus.COMPLETED)
      throw new ConflictException(
        'Plano de treino V2 existente possui AIJob ainda não concluído',
      );
  }

  assertIdempotentMatch(
    persisted: PersistedWorkoutPlanRecord,
    input: PersistWorkoutPlanV2Input,
    projection: WorkoutPlanV2Projection,
  ): void {
    const persistedProjection = {
      title: persisted.title,
      generatedAt: persisted.generatedAt.toISOString(),
      days: persisted.days.map((day) => ({
        dayNumber: day.dayNumber,
        weekday: day.weekday ?? null,
        title: day.title,
        exercises: day.exercises.map((exercise) => ({
          exerciseName: exercise.exerciseName,
          sets: exercise.sets,
          reps: exercise.reps,
          restSeconds: exercise.restSeconds,
          notes: exercise.notes,
        })),
      })),
    };
    const expectedProjection = {
      title: projection.title,
      generatedAt: projection.generatedAt.toISOString(),
      days: projection.days,
    };
    if (
      persisted.userId !== input.ownership.userId ||
      persisted.profileId !== input.ownership.profileId ||
      persisted.aiJobId !== input.generation.aiJobId ||
      this.canonicalJson(persistedProjection) !==
        this.canonicalJson(expectedProjection)
    )
      throw new ConflictException(
        'Persistência idempotente do treino V2 divergiu do plano existente',
      );
  }

  private project(
    plan: WorkoutPlanV2,
    calendarWeekdays: PersistWorkoutPlanV2Input['calendarWeekdays'],
  ): WorkoutPlanV2Projection {
    const calendar =
      calendarWeekdays && calendarWeekdays.length >= plan.sessions.length
        ? calendarWeekdays
        : null;
    const sequences = new Set<number>();
    const days = plan.sessions.map((session, index) => {
      if (!Number.isInteger(session.sequence) || session.sequence < 1)
        throw new BadRequestException(
          'Sequência de sessão do treino V2 inválida',
        );
      if (sequences.has(session.sequence))
        throw new BadRequestException(
          'Sequência de sessão duplicada no treino V2',
        );
      sequences.add(session.sequence);
      const exercises = session.blocks.flatMap((block) =>
        block.activities.map((activity) => ({
          exerciseName: activity.name,
          ...this.exercisePrescription(activity),
          notes: JSON.stringify({
            schemaVersion: 2,
            sessionKey: session.sessionKey,
            blockKey: block.blockKey,
            blockType: block.type,
            blockTitle: block.title,
            activity,
          }),
        })),
      );
      if (exercises.length === 0)
        throw new BadRequestException(
          'Sessão do treino V2 não possui atividades persistíveis',
        );
      return Object.freeze({
        dayNumber: session.sequence,
        weekday: calendar?.[index] ?? null,
        title: session.label,
        exercises: Object.freeze(exercises),
      });
    });
    return Object.freeze({
      title: plan.title,
      generatedAt: new Date(plan.generationMetadata.generatedAt),
      days: Object.freeze(days),
    });
  }

  private exercisePrescription(activity: WorkoutActivityV2): {
    readonly sets: number;
    readonly reps: string;
    readonly restSeconds: number;
  } {
    if (activity.kind === 'STRENGTH')
      return {
        sets: activity.sets,
        reps: activity.repetitions,
        restSeconds: activity.restSeconds,
      };
    if (activity.kind === 'TIMED')
      return {
        sets: activity.rounds,
        reps:
          activity.workSeconds === null
            ? `${activity.durationSeconds}s`
            : `${activity.workSeconds}s de trabalho`,
        restSeconds: activity.recoverySeconds ?? 0,
      };
    if (activity.kind === 'ENDURANCE')
      return {
        sets: 1,
        reps:
          activity.distanceKm === null
            ? `${activity.durationMinutes} min`
            : `${activity.distanceKm} km / ${activity.durationMinutes} min`,
        restSeconds: 0,
      };
    return {
      sets: 1,
      reps:
        activity.repetitions ??
        (activity.holdSeconds !== null
          ? `${activity.holdSeconds}s de sustentação`
          : `${activity.durationSeconds ?? 0}s`),
      restSeconds: 0,
    };
  }

  private toJsonValue(value: unknown): Prisma.InputJsonValue | null {
    if (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'boolean'
    )
      return value;
    if (typeof value === 'number') {
      if (!Number.isFinite(value))
        throw new BadRequestException(
          'Documento de treino V2 contém número não finito',
        );
      return value;
    }
    if (Array.isArray(value))
      return value.map((item) => this.toJsonValue(item));
    if (this.isRecord(value)) return this.toJsonRecord(value);
    throw new BadRequestException(
      'Documento de treino V2 contém valor não serializável',
    );
  }

  private toJsonRecord(value: object): Prisma.InputJsonObject {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, this.toJsonValue(item)]),
    );
  }

  private canonicalJson(value: unknown): string {
    if (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'boolean'
    )
      return JSON.stringify(value);
    if (typeof value === 'number') {
      if (!Number.isFinite(value))
        throw new BadRequestException(
          'Projeção de treino V2 contém número não finito',
        );
      return JSON.stringify(value);
    }
    if (Array.isArray(value))
      return `[${value.map((item) => this.canonicalJson(item)).join(',')}]`;
    if (this.isRecord(value))
      return `{${Object.keys(value)
        .sort()
        .map(
          (key) => `${JSON.stringify(key)}:${this.canonicalJson(value[key])}`,
        )
        .join(',')}}`;
    throw new BadRequestException('Projeção de treino V2 não serializável');
  }

  private requireIdentifier(value: string, label: string): void {
    if (!value.trim() || value.length > 255)
      throw new BadRequestException(`${label} do treino V2 inválido`);
  }

  private isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
