import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { WorkoutPlanV2 } from './workout-plan-v2.contract';
import { WorkoutPlanV2Parser } from './workout-plan-v2.parser';

@Injectable()
export class WorkoutPlanV2StoredDocumentParser {
  private readonly candidateParser = new WorkoutPlanV2Parser();

  parse(value: Prisma.JsonValue, aiJobId: string): WorkoutPlanV2 | null {
    if (!this.record(value) || value.schemaVersion !== 2) return null;
    const metadata = value.generationMetadata;
    if (
      !this.record(metadata) ||
      metadata.engineVersion !== 2 ||
      metadata.aiJobId !== aiJobId ||
      typeof metadata.promptVersionId !== 'string' ||
      typeof metadata.operationKey !== 'string' ||
      typeof metadata.model !== 'string' ||
      typeof metadata.generatedAt !== 'string' ||
      typeof metadata.reused !== 'boolean'
    ) {
      return null;
    }
    if (
      typeof value.lifecycleReason !== 'string' ||
      ![
        'CREATION',
        'REPLACEMENT',
        'ADAPTATION',
        'REVIEW',
        'REACTIVATION',
      ].includes(value.lifecycleReason) ||
      (value.replacesPlanReference !== null &&
        typeof value.replacesPlanReference !== 'string') ||
      typeof value.referenceDate !== 'string' ||
      !this.record(value.strategy) ||
      !Array.isArray(value.appliedConstraints) ||
      !Array.isArray(value.personalizationFactors) ||
      !this.record(value.validation) ||
      !Array.isArray(value.validation.issues)
    ) {
      return null;
    }
    try {
      const candidate = this.candidateParser.parse(
        JSON.stringify({
          artifactType: value.artifactType,
          modality: value.modality,
          objective: value.objective,
          title: value.title,
          sessions: value.sessions,
          progression: value.progression,
          substitutions: value.substitutions,
          adaptationRules: value.adaptationRules,
          safetyFlags: value.safetyFlags,
        }),
      );
      return Object.freeze({
        ...value,
        ...candidate,
      }) as unknown as WorkoutPlanV2;
    } catch {
      return null;
    }
  }

  private record(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
