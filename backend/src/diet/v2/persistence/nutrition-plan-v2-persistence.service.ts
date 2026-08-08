import { ConflictException, Inject, Injectable } from '@nestjs/common';
import {
  NutritionPlanImplementation,
  NutritionPlanStatus,
  type NutritionPlanV2 as PersistedNutritionPlanV2,
} from '@prisma/client';
import { AuditService } from '../../../observability/audit.service';
import { AIService } from '../../../ai/ai.service';
import type {
  PersistNutritionPlanV2Input,
  PersistNutritionPlanV2Result,
  PersistedNutritionPlanV2Aggregate,
} from './nutrition-plan-v2-persistence.contract';
import {
  NUTRITION_PLAN_V2_PROJECTION_WRITER,
  type NutritionPlanV2ProjectionWriter,
} from './nutrition-plan-v2-projection.writer';
import {
  NUTRITION_PLAN_V2_REPOSITORY,
  type NutritionPlanV2Repository,
} from './nutrition-plan-v2.repository';
import { NutritionPlanV2PersistenceValidator } from './nutrition-plan-v2-persistence.validator';
import { NutritionPlanOwnershipService } from '../../ownership/nutrition-plan-ownership.service';

const AUDIT_ACTION = 'NUTRITION_PLAN_V2_PERSISTED';
const AUDIT_ENTITY = 'NUTRITION_PLAN_V2';

@Injectable()
export class NutritionPlanV2PersistenceService {
  constructor(
    @Inject(NUTRITION_PLAN_V2_REPOSITORY)
    private readonly repository: NutritionPlanV2Repository,
    private readonly validator: NutritionPlanV2PersistenceValidator,
    private readonly auditService: AuditService,
    @Inject(NUTRITION_PLAN_V2_PROJECTION_WRITER)
    private readonly projectionWriter: NutritionPlanV2ProjectionWriter,
    private readonly aiService: AIService,
    private readonly nutritionPlanOwnership: NutritionPlanOwnershipService,
  ) {}

  async persist(
    input: PersistNutritionPlanV2Input,
  ): Promise<PersistNutritionPlanV2Result> {
    const document = this.validator.validateInput(input);

    return this.repository.inTransaction(async (transaction) => {
      await this.nutritionPlanOwnership.acquireCanonicalLockInTransaction(
        transaction,
        input.ownership.userId,
      );
      await this.repository.acquireUserLock(
        transaction,
        input.ownership.userId,
      );
      const ownership = await this.repository.findOwnership(transaction, {
        userId: input.ownership.userId,
        profileId: input.ownership.profileId,
        aiJobId: input.generation.aiJobId,
      });
      this.validator.assertOwnership(ownership, input);

      const existing = await this.repository.findByAIJobId(
        transaction,
        input.generation.aiJobId,
      );
      if (existing) {
        this.validator.assertIdempotentMatch(existing, input);
        await this.nutritionPlanOwnership.assertInTransaction(transaction, {
          userId: input.ownership.userId,
          profileId: input.ownership.profileId,
          implementation: NutritionPlanImplementation.V2,
          planId: existing.id,
          aiJobId: input.generation.aiJobId,
        });
        return this.result('REUSED', existing, input);
      }
      if (input.generation.status === 'ALREADY_COMPLETED') {
        throw new ConflictException(
          'AIJob concluído sem plano nutricional V2 persistido',
        );
      }

      await this.repository.archiveActive(transaction, input.ownership.userId);
      const plan = input.generation.output.plan;
      const persisted = await this.repository.create(transaction, {
        userId: input.ownership.userId,
        profileId: input.ownership.profileId,
        aiJobId: input.generation.aiJobId,
        schemaVersion: plan.schemaVersion,
        engineVersion: plan.generation.engineVersion,
        artifactType: plan.artifactType,
        lifecycleReason: plan.lifecycleReason,
        replacesPlanReference: plan.replacesPlanReference,
        status: NutritionPlanStatus.ACTIVE,
        document,
        generatedAt: new Date(plan.generation.generatedAt),
      });
      const aggregate = this.validator.reconstruct(persisted);

      await this.projectionWriter.prepareInTransaction(transaction, aggregate);
      await this.nutritionPlanOwnership.transitionInTransaction(transaction, {
        userId: input.ownership.userId,
        profileId: input.ownership.profileId,
        implementation: NutritionPlanImplementation.V2,
        planId: persisted.id,
        aiJobId: input.generation.aiJobId,
      });
      await this.auditService.recordInTransaction(transaction, {
        userId: input.ownership.userId,
        action: AUDIT_ACTION,
        entityType: AUDIT_ENTITY,
        entityId: persisted.id,
        metadata: {
          profileId: input.ownership.profileId,
          aiJobId: input.generation.aiJobId,
          operationKey: input.generation.operationKey,
          schemaVersion: plan.schemaVersion,
          engineVersion: plan.generation.engineVersion,
          artifactType: plan.artifactType,
          lifecycleReason: plan.lifecycleReason,
          replacesPlanReference: plan.replacesPlanReference,
          generatedAt: plan.generation.generatedAt,
          aiJobCompletionState: 'COMPLETED',
          correlationId: input.executionContext?.correlationId ?? null,
          traceId: input.executionContext?.traceId ?? null,
        },
      });
      await this.aiService.completeJobInTransaction(
        transaction,
        input.generation.completion,
      );

      return this.result('CREATED', persisted, input, aggregate);
    });
  }

  private result(
    persistence: PersistNutritionPlanV2Result['persistence'],
    persisted: PersistedNutritionPlanV2,
    input: PersistNutritionPlanV2Input,
    aggregate?: PersistedNutritionPlanV2Aggregate,
  ): PersistNutritionPlanV2Result {
    return Object.freeze({
      persistence,
      aggregate: aggregate ?? this.validator.reconstruct(persisted),
      aiJobCompleted: true,
    });
  }
}
