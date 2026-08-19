import { ConflictException, Injectable } from '@nestjs/common';
import { WorkoutWeekday } from '@prisma/client';
import { WorkoutPlanningEngineV2Service } from '../workout-planning-engine-v2.service';
import { WorkoutPlanV2PersistenceService } from '../persistence/workout-plan-v2-persistence.service';
import type {
  WorkoutApplicationExecutionInputV2,
  WorkoutApplicationExecutionResultV2,
} from './workout-application-execution.contract';

@Injectable()
export class WorkoutApplicationExecutorService {
  constructor(
    private readonly engine: WorkoutPlanningEngineV2Service,
    private readonly persistence: WorkoutPlanV2PersistenceService,
  ) {}

  async execute(
    input: WorkoutApplicationExecutionInputV2,
  ): Promise<WorkoutApplicationExecutionResultV2> {
    if (input.ownership.userId !== input.generationInput.userId) {
      throw new ConflictException(
        'Ownership da execução de treino V2 inconsistente',
      );
    }
    const prepared = this.engine.prepare(input.generationInput);
    if (!prepared.context || !prepared.strategy || !prepared.safety) {
      return Object.freeze({
        kind: 'CLARIFICATION' as const,
        resolutionReason: prepared.resolution.reason,
        readiness: prepared.readiness,
        missingFields: Object.freeze([]),
        confirmationRequiredFields: Object.freeze([]),
        safetyFlags: Object.freeze([]),
        aiJobCompleted: false as const,
      });
    }
    const readinessOnlyBlocked =
      prepared.safety.outcome === 'BLOCKED' &&
      prepared.safety.reasonCodes.length === 1 &&
      prepared.safety.reasonCodes[0] === 'READINESS_BLOCKED';
    if (
      prepared.safety.outcome === 'REQUIRES_CONFIRMATION' ||
      prepared.readiness?.status === 'REQUIRES_CONFIRMATION' ||
      (readinessOnlyBlocked &&
        (prepared.readiness?.missingFields.length ?? 0) > 0)
    ) {
      return Object.freeze({
        kind: 'CLARIFICATION' as const,
        resolutionReason: prepared.resolution.reason,
        readiness: prepared.readiness,
        missingFields: prepared.readiness?.missingFields ?? Object.freeze([]),
        confirmationRequiredFields:
          prepared.readiness?.confirmationRequiredFields ?? Object.freeze([]),
        safetyFlags: prepared.readiness?.safetyFlags ?? Object.freeze([]),
        aiJobCompleted: false as const,
      });
    }
    if (
      prepared.safety.outcome === 'BLOCKED' ||
      prepared.safety.outcome === 'PROFESSIONAL_REVIEW_RECOMMENDED'
    ) {
      return Object.freeze({
        kind: 'BLOCKED' as const,
        safetyOutcome: prepared.safety.outcome,
        reasonCodes: prepared.safety.reasonCodes,
        safetyFlags: prepared.readiness?.safetyFlags ?? Object.freeze([]),
        aiJobCompleted: false as const,
      });
    }

    const generation = await this.engine.generateCandidate(
      input.generationInput,
    );
    const persisted = await this.persistence.persist({
      generation,
      ownership: input.ownership,
      executionContext: input.executionContext,
      calendarWeekdays: this.calendarWeekdays(input),
    });
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

  private calendarWeekdays(
    input: WorkoutApplicationExecutionInputV2,
  ): readonly WorkoutWeekday[] | undefined {
    const datum = input.generationInput.snapshot?.routine.availableTrainingDays;
    if (!datum || !('value' in datum)) return undefined;
    const valid = new Set<string>(Object.values(WorkoutWeekday));
    const weekdays = datum.value.filter((value): value is WorkoutWeekday =>
      valid.has(value),
    );
    if (
      weekdays.length !== datum.value.length ||
      new Set(weekdays).size !== weekdays.length
    ) {
      return undefined;
    }
    return Object.freeze([...weekdays]);
  }
}
