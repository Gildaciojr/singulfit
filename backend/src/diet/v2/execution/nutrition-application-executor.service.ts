import { ConflictException, Injectable } from '@nestjs/common';
import { NutritionPlanningEngineV2Service } from '../nutrition-planning-engine-v2.service';
import { NutritionPlanV2PersistenceService } from '../persistence/nutrition-plan-v2-persistence.service';
import { NutritionConversationalArtifactPersistenceService } from '../conversational-persistence/nutrition-conversational-artifact-persistence.service';
import type { PersistNutritionPlanV2Input } from '../persistence/nutrition-plan-v2-persistence.contract';
import type { PersistNutritionConversationalArtifactInput } from '../conversational-persistence/nutrition-conversational-artifact-persistence.contract';
import type {
  NutritionApplicationExecutionInputV2,
  NutritionExecutionResultV2,
} from './nutrition-application-execution.contract';

@Injectable()
export class NutritionApplicationExecutorService {
  constructor(
    private readonly engine: NutritionPlanningEngineV2Service,
    private readonly planPersistence: NutritionPlanV2PersistenceService,
    private readonly conversationalPersistence: NutritionConversationalArtifactPersistenceService,
  ) {}

  async execute(
    input: NutritionApplicationExecutionInputV2,
  ): Promise<NutritionExecutionResultV2> {
    this.requireIdentifier(input.correlationId, 'correlationId');
    if (input.traceId !== undefined)
      this.requireIdentifier(input.traceId, 'traceId');
    if (input.ownership.userId !== input.generationInput.userId)
      throw new ConflictException(
        'Ownership da execução nutricional V2 inconsistente',
      );
    const generation = await this.engine.generateCandidate(
      input.generationInput,
    );
    if (generation.status === 'NO_GENERATION') {
      return Object.freeze({
        kind: 'CURRENT_PLAN_PRESENTATION',
        aggregateId: null,
        artifactType: generation.output.artifactType,
        document: null,
        aiJobCompleted: false,
        requiresFormatting: false,
        requiresPersistence: false,
      });
    }
    if (generation.output.kind === 'PLAN') {
      const persisted = await this.planPersistence.persist({
        generation: generation as PersistNutritionPlanV2Input['generation'],
        ownership: input.ownership,
        executionContext: {
          correlationId: input.correlationId,
          traceId: input.traceId,
        },
      });
      return Object.freeze({
        kind: 'PLAN',
        aggregateId: persisted.aggregate.id,
        artifactType: generation.output.artifactType,
        document: persisted.aggregate.document,
        aiJobCompleted: persisted.aiJobCompleted,
        requiresFormatting: true,
        requiresPersistence: true,
      });
    }
    const persisted = await this.conversationalPersistence.persist({
      generation:
        generation as PersistNutritionConversationalArtifactInput['generation'],
      userId: input.ownership.userId,
      executionContext: {
        correlationId: input.correlationId,
        traceId: input.traceId,
      },
    });
    return Object.freeze({
      kind: 'CONVERSATIONAL_ARTIFACT',
      aggregateId: persisted.aggregate.id,
      artifactType: generation.output.artifactType,
      document: persisted.aggregate.document,
      aiJobCompleted: persisted.aiJobCompleted,
      requiresFormatting: true,
      requiresPersistence: true,
    });
  }

  private requireIdentifier(value: string, label: string): void {
    if (!value.trim() || value.length > 255)
      throw new ConflictException(
        `${label} da execução nutricional V2 inválido`,
      );
  }
}
