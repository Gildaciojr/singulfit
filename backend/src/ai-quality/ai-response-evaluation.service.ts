import { Injectable } from '@nestjs/common';
import {
  AIResponseEvaluationType,
  AIResponseRiskLevel,
  Prisma,
  Severity,
} from '@prisma/client';
import { EventService } from '../observability/event.service';
import { AISafetyClassifierService } from './ai-safety-classifier.service';
import { AIQualityScoringService } from './ai-quality-scoring.service';
import {
  AIQualityContext,
  AIResponseDecision,
  PersistAIResponseEvaluationInput,
} from './interfaces/ai-quality.interface';
import { SafeResponseFallbackService } from './safe-response-fallback.service';

const AI_QUALITY_SOURCE = 'AI_QUALITY';
const MINIMUM_SAFETY_SCORE = 70;

@Injectable()
export class AIResponseEvaluationService {
  constructor(
    private readonly safety: AISafetyClassifierService,
    private readonly quality: AIQualityScoringService,
    private readonly fallback: SafeResponseFallbackService,
    private readonly events: EventService,
  ) {}

  evaluate(
    content: string,
    evaluationType: AIResponseEvaluationType,
    context: AIQualityContext,
  ): AIResponseDecision {
    const safety = this.safety.classify(content);
    const quality = this.quality.score(content, context);
    const fallbackUsed =
      safety.riskLevel === AIResponseRiskLevel.HIGH ||
      safety.riskLevel === AIResponseRiskLevel.BLOCKED ||
      safety.safetyScore < MINIMUM_SAFETY_SCORE;

    return {
      originalContent: content,
      finalContent: fallbackUsed ? this.fallback.build() : content,
      evaluationType,
      quality,
      safety,
      flags: [...new Set([...safety.flags, ...quality.flags])],
      blocked: fallbackUsed,
      fallbackUsed,
    };
  }

  async persistInTransaction(
    transaction: Prisma.TransactionClient,
    input: PersistAIResponseEvaluationInput,
  ) {
    const evaluatedAt = input.evaluatedAt ?? new Date();
    const data = {
      userId: input.userId,
      aiJobId: input.aiJobId,
      messageId: input.messageId,
      promptVersionId: input.promptVersionId,
      evaluationType: input.decision.evaluationType,
      qualityScore: input.decision.quality.qualityScore,
      safetyScore: input.decision.safety.safetyScore,
      personalizationScore: input.decision.quality.personalizationScore,
      usefulnessScore: input.decision.quality.usefulnessScore,
      clarityScore: input.decision.quality.clarityScore,
      riskLevel: input.decision.safety.riskLevel,
      flags: input.decision.flags,
      blocked: input.decision.blocked,
      fallbackUsed: input.decision.fallbackUsed,
      estimatedCost: input.estimatedCost,
    };
    const evaluation = await transaction.aIResponseEvaluation.upsert({
      where: {
        responseId: input.responseId,
      },
      update: data,
      create: {
        ...data,
        responseId: input.responseId,
        evaluatedAt,
      },
    });

    await this.recordEvaluationEvents(transaction, evaluation, input.decision);
    await this.ensureReviewQueue(
      transaction,
      evaluation.id,
      input.userId,
      input.decision,
    );
    await this.recalculateSnapshots(
      transaction,
      this.utcDay(evaluation.evaluatedAt),
      input.promptVersionId,
      input.userId,
    );

    return evaluation;
  }

  private async ensureReviewQueue(
    transaction: Prisma.TransactionClient,
    evaluationId: string,
    userId: string,
    decision: AIResponseDecision,
  ): Promise<void> {
    const requiresReview =
      decision.blocked || decision.safety.criticalFlags.length > 0;

    if (!requiresReview) {
      return;
    }

    const existing = await transaction.aIReviewQueue.findUnique({
      where: {
        aiResponseEvaluationId: evaluationId,
      },
      select: {
        id: true,
      },
    });

    if (existing) {
      return;
    }

    const reason = this.reviewReason(decision);
    const review = await transaction.aIReviewQueue.create({
      data: {
        userId,
        aiResponseEvaluationId: evaluationId,
        reason,
      },
    });

    await this.events.recordInTransaction(transaction, {
      source: AI_QUALITY_SOURCE,
      severity: Severity.WARNING,
      eventType: 'AI_REVIEW_QUEUE_CREATED',
      message: 'Resposta adicionada à fila de revisão humana',
      metadata: {
        userId,
        evaluationId,
        reviewQueueId: review.id,
        riskLevel: decision.safety.riskLevel,
        flags: decision.flags,
      },
    });
  }

  private async recordEvaluationEvents(
    transaction: Prisma.TransactionClient,
    evaluation: {
      id: string;
      userId: string;
      riskLevel: AIResponseRiskLevel;
      qualityScore: number;
      safetyScore: number;
      fallbackUsed: boolean;
    },
    decision: AIResponseDecision,
  ): Promise<void> {
    await this.events.recordInTransaction(transaction, {
      source: AI_QUALITY_SOURCE,
      severity:
        evaluation.riskLevel === AIResponseRiskLevel.LOW
          ? Severity.INFO
          : Severity.WARNING,
      eventType: 'AI_RESPONSE_EVALUATED',
      message: 'Resposta de IA avaliada',
      metadata: {
        userId: evaluation.userId,
        evaluationId: evaluation.id,
        evaluationType: decision.evaluationType,
        qualityScore: evaluation.qualityScore,
        safetyScore: evaluation.safetyScore,
        riskLevel: evaluation.riskLevel,
        flags: decision.flags,
      },
    });

    if (!decision.blocked) {
      return;
    }

    await this.events.recordInTransaction(transaction, {
      source: AI_QUALITY_SOURCE,
      severity:
        evaluation.riskLevel === AIResponseRiskLevel.BLOCKED
          ? Severity.CRITICAL
          : Severity.WARNING,
      eventType: 'AI_RESPONSE_BLOCKED',
      message: 'Resposta insegura bloqueada antes do envio',
      metadata: {
        userId: evaluation.userId,
        evaluationId: evaluation.id,
        riskLevel: evaluation.riskLevel,
        flags: decision.flags,
      },
    });
    await this.events.recordInTransaction(transaction, {
      source: AI_QUALITY_SOURCE,
      severity: Severity.WARNING,
      eventType: 'AI_RESPONSE_FALLBACK_USED',
      message: 'Fallback seguro utilizado',
      metadata: {
        userId: evaluation.userId,
        evaluationId: evaluation.id,
        safetyScore: evaluation.safetyScore,
      },
    });
  }

  private async recalculateSnapshots(
    transaction: Prisma.TransactionClient,
    snapshotDate: Date,
    promptVersionId: string | null,
    userId: string,
  ): Promise<void> {
    await transaction.$queryRaw`
      WITH advisory_lock AS (
        SELECT pg_advisory_xact_lock(
          hashtext(${`ai-quality:${snapshotDate.toISOString().slice(0, 10)}`})
        )
      )
      SELECT true AS "locked"
      FROM advisory_lock
    `;
    const nextDay = new Date(snapshotDate.getTime() + 86_400_000);
    const evaluations = await transaction.aIResponseEvaluation.findMany({
      where: {
        evaluatedAt: {
          gte: snapshotDate,
          lt: nextDay,
        },
      },
      select: {
        qualityScore: true,
        safetyScore: true,
        personalizationScore: true,
        usefulnessScore: true,
        clarityScore: true,
        riskLevel: true,
        flags: true,
        fallbackUsed: true,
      },
    });
    const generatedAt = new Date();
    const daily = this.dailyMetrics(evaluations);

    await transaction.aIQualityDailySnapshot.upsert({
      where: {
        snapshotDate,
      },
      update: {
        ...daily,
        generatedAt,
      },
      create: {
        snapshotDate,
        ...daily,
        generatedAt,
      },
    });

    if (!promptVersionId) {
      return;
    }

    const promptEvaluations = await transaction.aIResponseEvaluation.findMany({
      where: {
        promptVersionId,
        evaluatedAt: {
          gte: snapshotDate,
          lt: nextDay,
        },
      },
      select: {
        qualityScore: true,
        safetyScore: true,
        estimatedCost: true,
        riskLevel: true,
        flags: true,
        fallbackUsed: true,
      },
    });
    const prompt = this.promptMetrics(promptEvaluations);

    await transaction.promptQualitySnapshot.upsert({
      where: {
        promptVersionId_snapshotDate: {
          promptVersionId,
          snapshotDate,
        },
      },
      update: {
        ...prompt,
        generatedAt,
      },
      create: {
        promptVersionId,
        snapshotDate,
        ...prompt,
        generatedAt,
      },
    });
    await this.events.recordInTransaction(transaction, {
      source: AI_QUALITY_SOURCE,
      severity: Severity.INFO,
      eventType: 'PROMPT_QUALITY_RECALCULATED',
      message: 'Qualidade do prompt recalculada',
      metadata: {
        userId,
        promptVersionId,
        snapshotDate: snapshotDate.toISOString().slice(0, 10),
        evaluationCount: prompt.evaluationCount,
        averageQualityScore: prompt.averageQualityScore.toFixed(2),
        averageSafetyScore: prompt.averageSafetyScore.toFixed(2),
        averageCost: prompt.averageCost.toFixed(8),
        flagRate: prompt.flagRate.toFixed(2),
      },
    });
  }

  private dailyMetrics(
    evaluations: Array<{
      qualityScore: number;
      safetyScore: number;
      personalizationScore: number;
      usefulnessScore: number;
      clarityScore: number;
      riskLevel: AIResponseRiskLevel;
      flags: Prisma.JsonValue;
      fallbackUsed: boolean;
    }>,
  ) {
    return {
      evaluationCount: evaluations.length,
      averageQualityScore: this.averageDecimal(
        evaluations.map((item) => item.qualityScore),
      ),
      averageSafetyScore: this.averageDecimal(
        evaluations.map((item) => item.safetyScore),
      ),
      averagePersonalization: this.averageDecimal(
        evaluations.map((item) => item.personalizationScore),
      ),
      averageUsefulness: this.averageDecimal(
        evaluations.map((item) => item.usefulnessScore),
      ),
      averageClarity: this.averageDecimal(
        evaluations.map((item) => item.clarityScore),
      ),
      lowRiskCount: this.riskCount(evaluations, AIResponseRiskLevel.LOW),
      mediumRiskCount: this.riskCount(evaluations, AIResponseRiskLevel.MEDIUM),
      highRiskCount: this.riskCount(evaluations, AIResponseRiskLevel.HIGH),
      blockedCount: this.riskCount(evaluations, AIResponseRiskLevel.BLOCKED),
      flaggedCount: evaluations.filter((item) => this.hasFlags(item.flags))
        .length,
      fallbackCount: evaluations.filter((item) => item.fallbackUsed).length,
    };
  }

  private promptMetrics(
    evaluations: Array<{
      qualityScore: number;
      safetyScore: number;
      estimatedCost: Prisma.Decimal;
      riskLevel: AIResponseRiskLevel;
      flags: Prisma.JsonValue;
      fallbackUsed: boolean;
    }>,
  ) {
    const flaggedCount = evaluations.filter((item) =>
      this.hasFlags(item.flags),
    ).length;

    return {
      evaluationCount: evaluations.length,
      averageQualityScore: this.averageDecimal(
        evaluations.map((item) => item.qualityScore),
      ),
      averageSafetyScore: this.averageDecimal(
        evaluations.map((item) => item.safetyScore),
      ),
      averageCost: this.averageCost(
        evaluations.map((item) => item.estimatedCost),
      ),
      flaggedCount,
      flagRate: new Prisma.Decimal(
        ((flaggedCount / Math.max(1, evaluations.length)) * 100).toFixed(2),
      ),
      blockedCount: evaluations.filter(
        (item) =>
          item.riskLevel === AIResponseRiskLevel.BLOCKED ||
          item.riskLevel === AIResponseRiskLevel.HIGH,
      ).length,
      fallbackCount: evaluations.filter((item) => item.fallbackUsed).length,
    };
  }

  private riskCount(
    evaluations: Array<{ riskLevel: AIResponseRiskLevel }>,
    riskLevel: AIResponseRiskLevel,
  ): number {
    return evaluations.filter((item) => item.riskLevel === riskLevel).length;
  }

  private averageDecimal(values: number[]): Prisma.Decimal {
    if (values.length === 0) {
      return new Prisma.Decimal(0);
    }

    return new Prisma.Decimal(
      (
        values.reduce((total, value) => total + value, 0) / values.length
      ).toFixed(2),
    );
  }

  private averageCost(values: Prisma.Decimal[]): Prisma.Decimal {
    if (values.length === 0) {
      return new Prisma.Decimal(0);
    }

    return values
      .reduce((total, value) => total.add(value), new Prisma.Decimal(0))
      .div(values.length)
      .toDecimalPlaces(8);
  }

  private hasFlags(flags: Prisma.JsonValue): boolean {
    return Array.isArray(flags) && flags.length > 0;
  }

  private reviewReason(decision: AIResponseDecision): string {
    const flags =
      decision.flags.length > 0 ? decision.flags.join(', ') : 'LOW_SAFETY';

    return `Risco ${decision.safety.riskLevel}; segurança ${decision.safety.safetyScore}/100; flags: ${flags}`.slice(
      0,
      2_000,
    );
  }

  private utcDay(value: Date): Date {
    return new Date(
      Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
    );
  }
}
