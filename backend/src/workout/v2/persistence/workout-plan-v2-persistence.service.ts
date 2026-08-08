import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { WorkoutStatus } from '@prisma/client';
import { AIService } from '../../../ai/ai.service';
import { AuditService } from '../../../observability/audit.service';
import type {
  PersistWorkoutPlanV2Input,
  PersistWorkoutPlanV2Result,
  PersistedWorkoutPlanV2Aggregate,
} from './workout-plan-v2-persistence.contract';
import {
  WORKOUT_PLAN_V2_REPOSITORY,
  type PersistedWorkoutPlanRecord,
  type WorkoutPlanV2Repository,
} from './workout-plan-v2.repository';
import { WorkoutPlanV2PersistenceValidator } from './workout-plan-v2-persistence.validator';

const AUDIT_ACTION = 'WORKOUT_PLAN_V2_PERSISTED';
const AUDIT_ENTITY = 'WORKOUT_PLAN';

@Injectable()
export class WorkoutPlanV2PersistenceService {
  constructor(
    @Inject(WORKOUT_PLAN_V2_REPOSITORY)
    private readonly repository: WorkoutPlanV2Repository,
    private readonly validator: WorkoutPlanV2PersistenceValidator,
    private readonly auditService: AuditService,
    private readonly aiService: AIService,
  ) {}

  async persist(
    input: PersistWorkoutPlanV2Input,
  ): Promise<PersistWorkoutPlanV2Result> {
    const validated = this.validator.validateInput(input);

    return this.repository.inTransaction(async (transaction) => {
      await this.repository.acquireUserLock(
        transaction,
        input.ownership.userId,
      );
      const ownership = await this.repository.findOwnership(transaction, {
        userId: input.ownership.userId,
        profileId: input.ownership.profileId,
        aiJobId: input.generation.aiJobId,
      });
      const objective = this.validator.assertOwnership(ownership, input);

      const existing = await this.repository.findByAIJobId(
        transaction,
        input.generation.aiJobId,
      );
      if (existing) {
        this.validator.assertReusableState(ownership);
        this.validator.assertIdempotentMatch(
          existing,
          input,
          validated.projection,
        );
        return this.result('REUSED', existing, input);
      }

      this.validator.assertNewPersistenceState(ownership, input);
      if (input.generation.status !== 'PENDING_COMPLETION')
        throw new ConflictException(
          'AIJob concluído sem plano de treino V2 persistido',
        );
      await this.repository.archiveActive(transaction, input.ownership.userId);
      const persisted = await this.repository.create(transaction, {
        userId: input.ownership.userId,
        profileId: input.ownership.profileId,
        aiJobId: input.generation.aiJobId,
        title: validated.projection.title,
        objective,
        status: WorkoutStatus.ACTIVE,
        generatedAt: validated.projection.generatedAt,
        days: validated.projection.days,
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
          schemaVersion: input.generation.output.schemaVersion,
          engineVersion:
            input.generation.output.generationMetadata.engineVersion,
          artifactType: input.generation.output.artifactType,
          lifecycleReason: input.generation.output.lifecycleReason,
          generatedAt: input.generation.output.generationMetadata.generatedAt,
          aiJobCompletionState: 'COMPLETED',
          correlationId: input.executionContext?.correlationId ?? null,
          traceId: input.executionContext?.traceId ?? null,
        },
      });

      await this.aiService.completeJobInTransaction(transaction, {
        ...input.generation.completion,
        result: {
          candidateOutput: input.generation.storedResult.candidateOutput,
          model: input.generation.storedResult.model,
          acceptedOutput: validated.document,
        },
      });

      return this.result('CREATED', persisted, input);
    });
  }

  private result(
    persistence: PersistWorkoutPlanV2Result['persistence'],
    persisted: PersistedWorkoutPlanRecord,
    input: PersistWorkoutPlanV2Input,
  ): PersistWorkoutPlanV2Result {
    const aggregate: PersistedWorkoutPlanV2Aggregate = Object.freeze({
      id: persisted.id,
      userId: persisted.userId,
      profileId: persisted.profileId,
      aiJobId: persisted.aiJobId!,
      title: persisted.title,
      objective: persisted.objective,
      status: persisted.status,
      document: input.generation.output,
      days: Object.freeze(
        persisted.days.map((day) =>
          Object.freeze({
            id: day.id,
            dayNumber: day.dayNumber,
            title: day.title,
            exercises: Object.freeze(
              day.exercises.map((exercise) => Object.freeze(exercise)),
            ),
          }),
        ),
      ),
      generatedAt: new Date(persisted.generatedAt),
      createdAt: new Date(persisted.createdAt),
      updatedAt: new Date(persisted.updatedAt),
    });
    return Object.freeze({ persistence, aggregate, aiJobCompleted: true });
  }
}
