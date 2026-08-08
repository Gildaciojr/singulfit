import { Injectable } from '@nestjs/common';
import { WorkoutPlanV2PersistenceService } from '../persistence/workout-plan-v2-persistence.service';
import type {
  WorkoutApplicationExecutionInputV2,
  WorkoutApplicationExecutionResultV2,
} from './workout-application-execution.contract';

@Injectable()
export class WorkoutApplicationExecutorService {
  constructor(private readonly persistence: WorkoutPlanV2PersistenceService) {}

  async execute(
    input: WorkoutApplicationExecutionInputV2,
  ): Promise<WorkoutApplicationExecutionResultV2> {
    const persisted = await this.persistence.persist(input);
    return Object.freeze({
      kind: 'PLAN' as const,
      aggregateId: persisted.aggregate.id,
      artifactType: persisted.aggregate.document.artifactType,
      document: persisted.aggregate.document,
      projection: persisted.aggregate,
      persistence: persisted.persistence,
      aiJobCompleted: true as const,
    });
  }
}
