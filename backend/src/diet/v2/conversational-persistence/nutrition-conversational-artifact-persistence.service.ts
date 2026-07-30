import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { AIService } from '../../../ai/ai.service';
import { AuditService } from '../../../observability/audit.service';
import type {
  PersistNutritionConversationalArtifactInput,
  PersistNutritionConversationalArtifactResult,
} from './nutrition-conversational-artifact-persistence.contract';
import { NutritionConversationalArtifactPersistenceValidator } from './nutrition-conversational-artifact-persistence.validator';
import {
  NUTRITION_CONVERSATIONAL_ARTIFACT_REPOSITORY,
  type NutritionConversationalArtifactRepository,
} from './nutrition-conversational-artifact.repository';

const AUDIT_ACTIONS = {
  POINT_GUIDANCE: 'NUTRITION_POINT_GUIDANCE_PERSISTED',
  MEAL_SUGGESTION: 'NUTRITION_MEAL_SUGGESTION_PERSISTED',
  PLAN_REVIEW: 'NUTRITION_PLAN_REVIEW_PERSISTED',
} as const;

@Injectable()
export class NutritionConversationalArtifactPersistenceService {
  constructor(
    @Inject(NUTRITION_CONVERSATIONAL_ARTIFACT_REPOSITORY)
    private readonly repository: NutritionConversationalArtifactRepository,
    private readonly validator: NutritionConversationalArtifactPersistenceValidator,
    private readonly aiService: AIService,
    private readonly auditService: AuditService,
  ) {}
  async persist(
    input: PersistNutritionConversationalArtifactInput,
  ): Promise<PersistNutritionConversationalArtifactResult> {
    const document = this.validator.validateInput(input);
    const artifact = input.generation.output.artifact;
    const reviewedPlanId =
      artifact.artifactType === 'PLAN_REVIEW' ? artifact.reviewedPlanId : null;
    return this.repository.inTransaction(async (transaction) => {
      await this.repository.acquireUserLock(transaction, input.userId);
      const ownership = await this.repository.findOwnership(transaction, {
        userId: input.userId,
        aiJobId: input.generation.aiJobId,
        reviewedPlanId,
      });
      this.validator.assertOwnership(ownership, input);
      const existing = await this.repository.findExisting(
        transaction,
        input.generation.aiJobId,
        input.generation.operationKey,
      );
      if (existing) {
        this.validator.assertIdempotentMatch(existing, input);
        return Object.freeze({
          persistence: 'REUSED' as const,
          aggregate: this.validator.reconstruct(existing),
          aiJobCompleted: true as const,
        });
      }
      if (input.generation.status === 'ALREADY_COMPLETED') {
        throw new ConflictException(
          'AIJob concluído sem artifact conversacional persistido',
        );
      }
      this.validator.assertReadyForCompletion(ownership);
      const persisted = await this.repository.create(transaction, {
        userId: input.userId,
        artifactType: artifact.artifactType,
        schemaVersion: artifact.schemaVersion,
        document,
        aiJobId: input.generation.aiJobId,
        operationKey: input.generation.operationKey,
        reviewedPlanId,
      });
      await this.auditService.recordInTransaction(transaction, {
        userId: input.userId,
        action: AUDIT_ACTIONS[artifact.artifactType],
        entityType: 'NUTRITION_CONVERSATIONAL_ARTIFACT',
        entityId: persisted.id,
        metadata: {
          artifactType: artifact.artifactType,
          aiJobId: input.generation.aiJobId,
          operationKey: input.generation.operationKey,
          reviewedPlanId,
          correlationId: input.executionContext?.correlationId ?? null,
          traceId: input.executionContext?.traceId ?? null,
        },
      });
      await this.aiService.completeJobInTransaction(
        transaction,
        input.generation.completion,
      );
      return Object.freeze({
        persistence: 'CREATED' as const,
        aggregate: this.validator.reconstruct(persisted),
        aiJobCompleted: true as const,
      });
    });
  }
}
