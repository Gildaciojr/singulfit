import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import type {
  NutritionConversationalArtifact as PersistedArtifact,
  Prisma,
} from '@prisma/client';
import { NutritionConversationalArtifactValidator } from '../nutrition-conversational-artifact.validator';
import {
  freezeNutritionConversationalArtifact,
  type NutritionConversationalArtifactV1,
} from '../nutrition-conversational-artifact.contract';
import type {
  PersistNutritionConversationalArtifactInput,
  PersistedNutritionConversationalArtifactAggregate,
} from './nutrition-conversational-artifact-persistence.contract';
import type { ConversationalArtifactOwnershipRecord } from './nutrition-conversational-artifact.repository';

@Injectable()
export class NutritionConversationalArtifactPersistenceValidator {
  constructor(
    private readonly documentValidator: NutritionConversationalArtifactValidator,
  ) {}
  validateInput(
    input: PersistNutritionConversationalArtifactInput,
  ): Prisma.InputJsonObject {
    const output = input.generation.output;
    if (
      output.kind !== 'CONVERSATIONAL_ARTIFACT' ||
      output.artifactType !== output.artifact.artifactType
    )
      this.invalid();
    this.identifier(input.userId);
    this.identifier(input.generation.aiJobId);
    this.identifier(input.generation.operationKey);
    this.documentValidator.validate(output.artifact);
    return this.jsonObject(output.artifact);
  }
  assertOwnership(
    record: ConversationalArtifactOwnershipRecord,
    input: PersistNutritionConversationalArtifactInput,
  ): void {
    const artifact = input.generation.output.artifact;
    if (
      !record.userExists ||
      !record.aiJob ||
      record.aiJob.userId !== input.userId ||
      record.aiJob.type !== 'DIET' ||
      record.aiJob.operationKey !== input.generation.operationKey
    )
      throw new BadRequestException(
        'Ownership do artifact nutricional conversacional inválido',
      );
    if (artifact.artifactType === 'PLAN_REVIEW') {
      if (
        !record.reviewedPlan ||
        record.reviewedPlan.userId !== input.userId ||
        record.reviewedPlan.id !== artifact.reviewedPlanId
      )
        throw new BadRequestException('Plano revisado não pertence ao usuário');
    } else if (record.reviewedPlan !== null) this.invalid();
  }
  assertReadyForCompletion(
    record: ConversationalArtifactOwnershipRecord,
  ): void {
    if (record.aiJob?.status !== 'PROCESSING')
      throw new ConflictException(
        'Job de IA não está disponível para persistência conversacional',
      );
  }
  assertIdempotentMatch(
    existing: PersistedArtifact,
    input: PersistNutritionConversationalArtifactInput,
  ): void {
    const artifact = input.generation.output.artifact;
    if (
      existing.userId !== input.userId ||
      existing.aiJobId !== input.generation.aiJobId ||
      existing.operationKey !== input.generation.operationKey ||
      existing.artifactType !== artifact.artifactType ||
      this.canonicalJson(existing.document) !== this.canonicalJson(artifact)
    )
      throw new ConflictException(
        'Tentativa idempotente diverge do artifact persistido',
      );
  }
  reconstruct(
    record: PersistedArtifact,
  ): PersistedNutritionConversationalArtifactAggregate {
    const document =
      record.document as unknown as NutritionConversationalArtifactV1;
    this.documentValidator.validate(document);
    if (
      document.artifactType !== record.artifactType ||
      document.schemaVersion !== record.schemaVersion ||
      (document.artifactType === 'PLAN_REVIEW'
        ? document.reviewedPlanId !== record.reviewedPlanId
        : record.reviewedPlanId !== null)
    )
      this.invalid();
    return Object.freeze({
      ...record,
      document: freezeNutritionConversationalArtifact(document),
    });
  }
  private identifier(value: string): void {
    if (!value.trim() || value.length > 255) this.invalid();
  }
  private jsonObject(value: object): Prisma.InputJsonObject {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonObject;
  }
  private canonicalJson(value: unknown): string {
    if (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'boolean'
    )
      return JSON.stringify(value);
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) this.invalid();
      return JSON.stringify(value);
    }
    if (Array.isArray(value))
      return `[${value.map((item) => this.canonicalJson(item)).join(',')}]`;
    if (typeof value === 'object') {
      const record = value as Readonly<Record<string, unknown>>;
      return `{${Object.keys(record)
        .sort()
        .map(
          (key) => `${JSON.stringify(key)}:${this.canonicalJson(record[key])}`,
        )
        .join(',')}}`;
    }
    return this.invalid();
  }
  private invalid(): never {
    throw new BadRequestException(
      'Persistência do artifact nutricional conversacional inválida',
    );
  }
}
