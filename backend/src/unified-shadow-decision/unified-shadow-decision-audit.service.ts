import { Injectable } from '@nestjs/common';
import { AuditService } from '../observability/audit.service';
import type {
  UnifiedShadowAuditMetadata,
  UnifiedShadowFailureMetadata,
} from './unified-shadow-decision.contract';

const AUDIT_ENTITY_TYPE = 'UNIFIED_SHADOW_DECISION';

@Injectable()
export class UnifiedShadowDecisionAuditService {
  constructor(private readonly audit: AuditService) {}

  async recordCompleted(input: {
    readonly userId: string;
    readonly entityId: string;
    readonly metadata: UnifiedShadowAuditMetadata;
  }): Promise<void> {
    const metadata = input.metadata;
    await this.audit.record({
      userId: input.userId,
      action: 'UNIFIED_SHADOW_DECISION_COMPLETED',
      entityType: AUDIT_ENTITY_TYPE,
      entityId: input.entityId,
      metadata: {
        status: metadata.status,
        plannerGoal: metadata.plannerGoal,
        collectorShouldAsk: metadata.collectorShouldAsk,
        overallCategory: metadata.overallCategory,
        nutritionCategory: metadata.nutritionCategory,
        workoutCategory: metadata.workoutCategory,
        longitudinalCategory: metadata.longitudinalCategory,
        nutritionIntensity: metadata.nutritionIntensity,
        nutritionComplexity: metadata.nutritionComplexity,
        workoutIntensity: metadata.workoutIntensity,
        workoutComplexity: metadata.workoutComplexity,
        workoutProgression: metadata.workoutProgression,
        longitudinalDecision: metadata.longitudinalDecision,
        differenceDimensions: [...metadata.differenceDimensions],
        differences: metadata.differences.map((difference) => ({
          domain: difference.domain,
          dimension: difference.dimension,
          legacyValue: difference.legacyValue,
          shadowValue: difference.shadowValue,
        })),
        nutritionStrategyCodes: [...metadata.nutritionStrategyCodes],
        workoutStrategyCodes: [...metadata.workoutStrategyCodes],
        latency: { ...metadata.latency },
        versions: { ...metadata.versions },
      },
    });
  }

  async recordFailed(input: {
    readonly userId: string;
    readonly entityId: string;
    readonly metadata: UnifiedShadowFailureMetadata;
  }): Promise<void> {
    await this.audit.record({
      userId: input.userId,
      action: 'UNIFIED_SHADOW_DECISION_FAILED',
      entityType: AUDIT_ENTITY_TYPE,
      entityId: input.entityId,
      metadata: {
        status: input.metadata.status,
        failureCode: input.metadata.failureCode,
        pipelineVersion: input.metadata.pipelineVersion,
        totalMs: input.metadata.totalMs,
      },
    });
  }
}
