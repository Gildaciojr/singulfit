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
  type NutritionPlanV2 as PersistedNutritionPlanV2,
} from '@prisma/client';
import { freezeNutritionPlanV2 } from '../nutrition-plan-v2.freeze';
import type { NutritionPlanV2 } from '../nutrition-plan-v2.contract';
import type {
  PersistNutritionPlanV2Input,
  PersistedNutritionPlanV2Aggregate,
} from './nutrition-plan-v2-persistence.contract';
import type { NutritionPlanV2OwnershipRecord } from './nutrition-plan-v2.repository';

const ARTIFACT_TYPES = new Set<string>([
  'DAILY_STRUCTURE',
  'WEEKLY_PLAN',
  'PLAN_ADAPTATION',
  'FOOD_SUBSTITUTION',
]);

const LIFECYCLE_REASONS = new Set<string>([
  'CREATION',
  'REPLACEMENT',
  'ADAPTATION',
  'REVIEW',
  'REACTIVATION',
]);

@Injectable()
export class NutritionPlanV2PersistenceValidator {
  validateInput(input: PersistNutritionPlanV2Input): Prisma.InputJsonObject {
    this.requireIdentifier(input.ownership.userId, 'Usuário');
    this.requireIdentifier(input.ownership.profileId, 'Perfil');

    const generation = input.generation;
    if (
      generation.status === 'PENDING_COMPLETION' &&
      (generation.reused || generation.completion === null)
    ) {
      throw new BadRequestException(
        'Resultado nutricional V2 não está pendente de conclusão',
      );
    }

    const plan = generation.output.plan;
    this.assertPlan(plan);
    if (
      plan.generation.aiJobId !== generation.aiJobId ||
      plan.generation.operationKey !== generation.operationKey ||
      plan.generation.reused !== generation.reused
    ) {
      throw new BadRequestException(
        'Metadados de geração nutricional V2 inconsistentes',
      );
    }
    if (
      generation.completion &&
      (generation.completion.aiJobId !== generation.aiJobId ||
        generation.completion.userId !== input.ownership.userId ||
        generation.completion.jobType !== AIJobType.DIET)
    ) {
      throw new BadRequestException(
        'Ownership da conclusão do AIJob nutricional V2 inconsistente',
      );
    }
    if (
      generation.completion &&
      (generation.completion.result.candidateOutput !==
        generation.storedResult.candidateOutput ||
        generation.completion.result.model !== generation.storedResult.model ||
        plan.generation.model !== generation.storedResult.model ||
        generation.completion.response.model !== generation.storedResult.model)
    ) {
      throw new BadRequestException(
        'Resultado armazenável do AIJob nutricional V2 inconsistente',
      );
    }

    return this.toJsonObject(plan);
  }

  assertOwnership(
    ownership: NutritionPlanV2OwnershipRecord,
    input: PersistNutritionPlanV2Input,
  ): void {
    if (!ownership.profileOwned) {
      throw new NotFoundException(
        'Perfil do plano nutricional V2 não pertence ao usuário',
      );
    }
    const aiJob = ownership.aiJob;
    if (!aiJob) {
      throw new NotFoundException(
        'AIJob do plano nutricional V2 não encontrado',
      );
    }
    if (
      aiJob.userId !== input.ownership.userId ||
      aiJob.type !== AIJobType.DIET ||
      aiJob.promptVersionId !==
        input.generation.output.plan.generation.promptVersionId ||
      aiJob.operationKey !== input.generation.operationKey
    ) {
      throw new ConflictException(
        'AIJob do plano nutricional V2 pertence a outro contexto',
      );
    }
    if (
      aiJob.status !== AIJobStatus.PROCESSING &&
      aiJob.status !== AIJobStatus.COMPLETED
    ) {
      throw new ConflictException(
        'AIJob do plano nutricional V2 não está disponível para persistência',
      );
    }
  }

  assertIdempotentMatch(
    persisted: PersistedNutritionPlanV2,
    input: PersistNutritionPlanV2Input,
  ): void {
    const plan = input.generation.output.plan;
    if (
      persisted.userId !== input.ownership.userId ||
      persisted.profileId !== input.ownership.profileId ||
      persisted.aiJobId !== input.generation.aiJobId ||
      persisted.schemaVersion !== plan.schemaVersion ||
      persisted.engineVersion !== plan.generation.engineVersion ||
      persisted.artifactType !== plan.artifactType ||
      persisted.lifecycleReason !== plan.lifecycleReason ||
      persisted.replacesPlanReference !== plan.replacesPlanReference ||
      persisted.generatedAt.getTime() !==
        new Date(plan.generation.generatedAt).getTime() ||
      this.canonicalJson(persisted.document) !== this.canonicalJson(plan)
    ) {
      throw new ConflictException(
        'Persistência idempotente do plano nutricional V2 divergiu do agregado existente',
      );
    }
  }

  reconstruct(
    persisted: PersistedNutritionPlanV2,
  ): PersistedNutritionPlanV2Aggregate {
    this.assertPlan(persisted.document);
    return Object.freeze({
      id: persisted.id,
      userId: persisted.userId,
      profileId: persisted.profileId,
      aiJobId: persisted.aiJobId,
      schemaVersion: persisted.schemaVersion,
      engineVersion: persisted.engineVersion,
      artifactType: persisted.artifactType,
      lifecycleReason: persisted.lifecycleReason,
      replacesPlanReference: persisted.replacesPlanReference,
      status: persisted.status,
      document: freezeNutritionPlanV2(persisted.document),
      generatedAt: new Date(persisted.generatedAt),
      createdAt: new Date(persisted.createdAt),
      updatedAt: new Date(persisted.updatedAt),
    });
  }

  private assertPlan(value: unknown): asserts value is NutritionPlanV2 {
    if (!this.isRecord(value)) {
      throw new BadRequestException('Documento nutricional V2 inválido');
    }
    if (
      value.schemaVersion !== 2 ||
      !ARTIFACT_TYPES.has(this.string(value.artifactType)) ||
      !LIFECYCLE_REASONS.has(this.string(value.lifecycleReason)) ||
      !(
        value.replacesPlanReference === null ||
        typeof value.replacesPlanReference === 'string'
      ) ||
      !this.nonEmptyString(value.title) ||
      typeof value.objectiveSummary !== 'string' ||
      !this.isRecord(value.strategy) ||
      !Array.isArray(value.guidance) ||
      !Array.isArray(value.days) ||
      !Array.isArray(value.substitutions) ||
      !Array.isArray(value.adaptationRules) ||
      !Array.isArray(value.hydrationGuidance) ||
      !Array.isArray(value.safetyNotes) ||
      !this.isRecord(value.validation) ||
      !this.isRecord(value.generation)
    ) {
      throw new BadRequestException(
        'Estrutura do documento nutricional V2 inválida',
      );
    }
    const generation = value.generation;
    if (
      generation.engineVersion !== 2 ||
      !this.nonEmptyString(generation.promptVersionId) ||
      !this.nonEmptyString(generation.aiJobId) ||
      !this.nonEmptyString(generation.operationKey) ||
      !this.nonEmptyString(generation.model) ||
      !this.validDate(generation.generatedAt) ||
      typeof generation.reused !== 'boolean'
    ) {
      throw new BadRequestException(
        'Metadados do documento nutricional V2 inválidos',
      );
    }
    this.toJsonValue(value);
  }

  private toJsonObject(value: NutritionPlanV2): Prisma.InputJsonObject {
    return this.toJsonRecord(value);
  }

  private toJsonValue(value: unknown): Prisma.InputJsonValue | null {
    if (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'boolean'
    ) {
      return value;
    }
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        throw new BadRequestException(
          'Documento nutricional V2 contém número não finito',
        );
      }
      return value;
    }
    if (Array.isArray(value)) {
      return value.map((item) => this.toJsonValue(item));
    }
    if (this.isRecord(value)) {
      return this.toJsonRecord(value);
    }
    throw new BadRequestException(
      'Documento nutricional V2 contém valor não serializável',
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
    ) {
      return JSON.stringify(value);
    }
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        throw new BadRequestException(
          'Documento nutricional V2 contém número não finito',
        );
      }
      return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
      return `[${value.map((item) => this.canonicalJson(item)).join(',')}]`;
    }
    if (this.isRecord(value)) {
      return `{${Object.keys(value)
        .sort()
        .map(
          (key) => `${JSON.stringify(key)}:${this.canonicalJson(value[key])}`,
        )
        .join(',')}}`;
    }
    throw new BadRequestException(
      'Documento nutricional V2 contém valor não serializável',
    );
  }

  private requireIdentifier(value: string, label: string): void {
    if (!value.trim() || value.length > 255) {
      throw new BadRequestException(
        `${label} do plano nutricional V2 inválido`,
      );
    }
  }

  private validDate(value: unknown): value is string {
    return (
      typeof value === 'string' &&
      value.trim().length > 0 &&
      Number.isFinite(new Date(value).getTime())
    );
  }

  private nonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
  }

  private string(value: unknown): string {
    return typeof value === 'string' ? value : '';
  }

  private isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
